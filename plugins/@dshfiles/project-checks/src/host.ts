import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-hook-protocol'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-subprocess'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { waitForManagedExit } from '@dshfiles/dshx/host'
import { defineHost } from '@dshfiles/dshx/host'
import { randomUUID } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isAbsolute, normalize } from 'node:path'
import { projectChecksApi, type ProjectHookEvent } from './api.js'
import { isWithinRoot, projectChecksConfigSchema, receiptFreshness, verificationPrompt, type ProjectAction } from './core.js'
import { projectChecksDomain, receiptKey, trimReceiptRows, type StoredReceipt } from './store.js'

const ENTRY_ID = 'dshfiles-project-checks'
const PACKAGE_NAME = '@dshfiles/project-checks'
const MAX_RECEIPTS_PER_SESSION = 30
const MAX_RECEIPTS_TOTAL = 2_000
const MAX_HOOK_EVENTS = 12
const REVISION_TIMEOUT_MS = 10_000
const REVISION_PATTERN = /^[a-f0-9]{40,64}$/

export const Config = projectChecksConfigSchema

type ProcessFailure = 'spawn-failed' | 'process-group-failed' | 'cancelled' | 'timed-out'
type ReceiptStage =
  | 'resolve-session-paths'
  | 'capture-source-revision-before'
  | 'run-command'
  | 'capture-source-revision-after'
  | 'persist-receipt'
  | 'list-receipts'
  | 'materialize-receipts'
type ApiDiagnosticOperation = 'manual-run' | 'verification-run' | 'list-receipts'

const safeErrorCode = (cause: unknown): string | null => {
  if (!(cause instanceof Error) || !('code' in cause)) return null
  const code = cause.code
  if (typeof code !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(code)) return null
  return code
}

const reportApiFailure = (
  operation: ApiDiagnosticOperation,
  diagnosticId: string,
  stage: ReceiptStage,
  cause: unknown,
): void => {
  console.error('Project Checks API operation failed', {
    api: 'project-checks',
    operation,
    diagnosticId,
    stage,
    errorType: cause instanceof Error ? cause.name.slice(0, 64) : typeof cause,
    errorCode: safeErrorCode(cause),
  })
}

interface ProcessResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly failure: ProcessFailure | null
}

interface ProjectPaths {
  readonly root: string
  readonly cwd: string
}

interface ReceiptOptions {
  readonly automatic: boolean
  readonly attempt: number
  readonly verificationTurn: number | null
  readonly signal?: AbortSignal
  readonly requireRevision: boolean
}

function entryFor(ctx: Context) {
  const matches = ctx.configEditor.entries().filter(entry => entry.options.id === ENTRY_ID && entry.options.name === PACKAGE_NAME)
  if (matches.length !== 1 || matches[0]?.fiber === undefined) throw new Error('Project checks profile row is unavailable.')
  return matches[0]
}

const configFor = (ctx: Context) => {
  const parsed = Config.safeParse(entryFor(ctx).options.config ?? {})
  if (!parsed.success) throw new Error('Project checks profile configuration is invalid.')
  return parsed.data
}

const sessionPaths = async (ctx: Context, sessionId: string, action: ProjectAction): Promise<ProjectPaths> => {
  const observed = await ctx.sessionQuery.readTitleSnapshot(SessionId(sessionId))
  const selectedCwd = observed.session.cwd
  if (selectedCwd === undefined || !isAbsolute(selectedCwd)) throw new Error('This session has no absolute project directory.')

  const [root, cwd] = await Promise.all([realpath(action.root), realpath(selectedCwd)])
  if (root !== normalize(action.root)) throw new Error('Configured project root must be a canonical path.')
  if (!isWithinRoot(root, cwd)) throw new Error('This session is outside the action’s trusted project root.')
  return { root, cwd }
}

const openProjectChecksDomain = (ctx: Context) => {
  const storage = ctx.get('storageDomain')
  if (storage === undefined) throw new Error('Project checks storage is unavailable.')
  return storage.open(projectChecksDomain)
}

type ProjectChecksDomain = Awaited<ReturnType<typeof openProjectChecksDomain>>

const storageDomains = new WeakMap<Context, Promise<ProjectChecksDomain>>()

const storageFor = (ctx: Context): Promise<ProjectChecksDomain> => {
  const existing = storageDomains.get(ctx)
  if (existing !== undefined) return existing
  const opening = Promise.resolve().then(() => openProjectChecksDomain(ctx))
  storageDomains.set(ctx, opening)
  void opening.catch(() => {
    if (storageDomains.get(ctx) === opening) storageDomains.delete(ctx)
  })
  return opening
}

const closeProjectChecksDomain = async (ctx: Context): Promise<void> => {
  const opening = storageDomains.get(ctx)
  if (opening === undefined) return
  try {
    await opening.then(domain => domain.close(), () => undefined)
  } finally {
    if (storageDomains.get(ctx) === opening) storageDomains.delete(ctx)
  }
}

const readStoredReceipts = async (ctx: Context, sessionId: string): Promise<StoredReceipt[]> => {
  const domain = await storageFor(ctx)
  return Array.from(domain.table('receipts').entries())
    .map(([, receipt]) => receipt)
    .filter(receipt => receipt.sessionId === sessionId)
    .sort((left, right) => right.finishedAt - left.finishedAt)
    .slice(0, MAX_RECEIPTS_PER_SESSION)
}

const persistReceipt = async (ctx: Context, receipt: StoredReceipt): Promise<void> => {
  const table = (await storageFor(ctx)).table('receipts')
  await table.put(receiptKey(receipt), receipt)
  const removals = trimReceiptRows(Array.from(table.entries()), receipt.sessionId, MAX_RECEIPTS_PER_SESSION, MAX_RECEIPTS_TOTAL)
  await Promise.all(removals.map(key => table.delete(key)))
}

const runManaged = async (
  ctx: Context,
  command: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<ProcessResult> => {
  const controller = new AbortController()
  let timedOut = false
  let managedExit = false
  let handle: ReturnType<typeof ctx.subprocess.spawn> | undefined
  const abortFromCaller = (): void => controller.abort(signal?.reason)
  const timeout = setTimeout(() => {
    timedOut = true
    controller.abort(new Error('Project action timed out.'))
  }, timeoutMs)

  signal?.addEventListener('abort', abortFromCaller, { once: true })
  if (signal?.aborted === true) abortFromCaller()

  try {
    if (controller.signal.aborted) return { exitCode: null, stdout: '', failure: 'cancelled' }
    const executable = await ctx.subprocess.resolveExecutable(command, undefined, controller.signal)
    if (!isAbsolute(executable) || executable.includes('\0')) return { exitCode: null, stdout: '', failure: 'spawn-failed' }

    handle = ctx.subprocess.spawn({
      argv: [executable, ...args],
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: 16_384 },
        stderr: { maxBytes: 4_096 },
      },
      graceMs: 1_000,
      signal: controller.signal,
    })
    const outcome = await handle.done
    if (controller.signal.aborted) {
      handle.terminate()
      if (timedOut) return { exitCode: null, stdout: '', failure: 'timed-out' }
      return { exitCode: null, stdout: '', failure: 'cancelled' }
    }

    managedExit = await waitForManagedExit({ handle, timeoutMs, signal: controller.signal })
    if (!managedExit) {
      handle.terminate()
      return { exitCode: outcome.exitCode, stdout: '', failure: 'process-group-failed' }
    }

    const stdout = handle.collected.stdout?.readFrom(0)
    return { exitCode: outcome.exitCode, stdout: stdout?.text ?? '', failure: null }
  } catch {
    if (controller.signal.aborted) {
      return { exitCode: null, stdout: '', failure: timedOut ? 'timed-out' : 'cancelled' }
    }
    return { exitCode: null, stdout: '', failure: 'spawn-failed' }
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abortFromCaller)
    if (handle !== undefined && !managedExit) {
      handle.terminate()
      await waitForManagedExit({ handle, timeoutMs: 10_000 }).catch(() => false)
    }
  }
}

const sourceRevision = async (ctx: Context, cwd: string, signal?: AbortSignal): Promise<string | null> => {
  const result = await runManaged(ctx, 'jj', ['log', '--no-graph', '-r', '@', '--template', 'commit_id'], cwd, REVISION_TIMEOUT_MS, signal)
  if (result.failure !== null || result.exitCode !== 0) return null
  const revision = result.stdout.trim()
  return REVISION_PATTERN.test(revision) ? revision : null
}

const runAction = async (ctx: Context, sessionId: string, action: ProjectAction, options: ReceiptOptions): Promise<StoredReceipt> => {
  const diagnosticId = randomUUID()
  let stage: ReceiptStage = 'resolve-session-paths'
  try {
    const paths = await sessionPaths(ctx, sessionId, action)
    const startedAt = Date.now()
    stage = 'capture-source-revision-before'
    const beforeRevision = await sourceRevision(ctx, paths.cwd, options.signal)
    let status: StoredReceipt['status'] = 'failed'
    let failure: StoredReceipt['failure'] = null
    let exitCode: number | null = null
    let afterRevision: string | null = beforeRevision

    if (options.requireRevision && beforeRevision === null) {
      failure = 'revision-unavailable'
    } else {
      stage = 'run-command'
      const result = await runManaged(ctx, action.command, action.args, paths.cwd, action.timeoutMs, options.signal)
      exitCode = result.exitCode
      if (result.failure === 'cancelled') status = 'cancelled'
      else if (result.failure === 'timed-out') status = 'timed-out'
      else if (result.failure === 'process-group-failed') failure = 'process-group-failed'
      else if (result.failure === 'spawn-failed') failure = 'spawn-failed'
      else status = result.exitCode === 0 ? 'passed' : 'failed'

      stage = 'capture-source-revision-after'
      afterRevision = await sourceRevision(ctx, paths.cwd, options.signal)
      if (status === 'passed' && beforeRevision !== null && afterRevision !== beforeRevision) {
        status = 'failed'
        failure = 'source-changed'
      }
    }

    const finishedAt = Date.now()
    const receipt: StoredReceipt = {
      id: diagnosticId,
      sessionId,
      actionId: action.id,
      label: action.label,
      status,
      failure,
      startedAt,
      finishedAt,
      durationMs: Math.max(0, finishedAt - startedAt),
      exitCode,
      sourceRevision: afterRevision,
      verificationTurn: options.verificationTurn,
      automatic: options.automatic,
      attempt: options.attempt,
    }
    stage = 'persist-receipt'
    await persistReceipt(ctx, receipt)
    return receipt
  } catch (cause) {
    reportApiFailure(options.automatic ? 'verification-run' : 'manual-run', diagnosticId, stage, cause)
    throw cause
  }
}

const apiActions = async (ctx: Context, sessionId: string) => {
  const config = configFor(ctx)
  const visible: Array<{ id: string; label: string; description: string; timeoutMs: number; verifyBeforeComplete: boolean }> = []
  for (const action of config.actions) {
    try {
      await sessionPaths(ctx, sessionId, action)
      visible.push({
        id: action.id,
        label: action.label,
        description: action.description,
        timeoutMs: action.timeoutMs,
        verifyBeforeComplete: action.verifyBeforeComplete,
      })
    } catch {
      continue
    }
  }
  return visible
}

const apiReceipts = async (ctx: Context, sessionId: string) => {
  const diagnosticId = randomUUID()
  let stage: ReceiptStage = 'list-receipts'
  try {
    const receipts = await readStoredReceipts(ctx, sessionId)
    const actions = configFor(ctx).actions
    const revisions = new Map<string, Promise<string | null>>()
    stage = 'materialize-receipts'
    return await Promise.all(
      receipts.map(async receipt => {
        const action = actions.find(candidate => candidate.id === receipt.actionId)
        if (action === undefined) return { ...receipt, freshness: 'unknown' as const }
        let revision = revisions.get(action.root)
        if (revision === undefined) {
          revision = (async () => {
            try {
              return await sourceRevision(ctx, (await sessionPaths(ctx, sessionId, action)).cwd)
            } catch {
              return null
            }
          })()
          revisions.set(action.root, revision)
        }
        return { ...receipt, freshness: receiptFreshness(receipt.sourceRevision, await revision) }
      }),
    )
  } catch (cause) {
    reportApiFailure('list-receipts', diagnosticId, stage, cause)
    throw cause
  }
}

const hookEvents = async (ctx: Context, sessionId: string): Promise<ProjectHookEvent[]> => {
  const id = SessionId(sessionId)
  const listed = await ctx.sessionQuery.listEvents(id)
  const selected = listed.filter(event => event.type === 'hook/invoked' || event.type === 'hook/result').slice(-MAX_HOOK_EVENTS)
  const read = await Promise.all(selected.map(event => ctx.sessionQuery.readEvent({ sessionId: id, seq: event.seq })))
  const summaries: ProjectHookEvent[] = []

  for (const observation of read) {
    const event = observation.target
    if (event.type === 'hook/invoked') {
      summaries.push({
        seq: event.seq,
        time: event.time,
        kind: 'invoked',
        turn: event.data.turn,
        point: event.data.point,
        dialect: event.data.dialect,
        decision: null,
        exitCode: null,
        durationMs: null,
        stderrPresent: false,
      })
    }
    if (event.type === 'hook/result') {
      summaries.push({
        seq: event.seq,
        time: event.time,
        kind: 'result',
        turn: event.data.turn,
        point: event.data.point,
        dialect: null,
        decision: event.data.decision,
        exitCode: event.data.exitCode ?? null,
        durationMs: event.data.durationMs,
        stderrPresent: event.data.stderrSummary !== undefined && event.data.stderrSummary.length > 0,
      })
    }
  }
  return summaries.sort((left, right) => left.seq - right.seq).slice(-MAX_HOOK_EVENTS)
}

const hostApi = projectChecksApi.host({
  actions: async ({ input, ctx }) => apiActions(ctx, input.sessionId),
  receipts: async ({ input, ctx }) => apiReceipts(ctx, input.sessionId),
  hookEvents: async ({ input, ctx }) => hookEvents(ctx, input.sessionId),
  run: async ({ input, ctx, signal }) => {
    const action = configFor(ctx).actions.find(candidate => candidate.id === input.actionId)
    if (action === undefined) throw new Error('Project action is not configured.')
    const isVisible = (await apiActions(ctx, input.sessionId)).some(candidate => candidate.id === action.id)
    if (!isVisible) throw new Error('Project action is not available in this session directory.')
    const receipt = await runAction(ctx, input.sessionId, action, {
      automatic: false,
      attempt: 0,
      verificationTurn: null,
      signal,
      requireRevision: false,
    })
    const freshness = receiptFreshness(
      receipt.sourceRevision,
      await (async () => {
        try {
          return await sourceRevision(ctx, (await sessionPaths(ctx, input.sessionId, action)).cwd)
        } catch {
          return null
        }
      })(),
    )
    return { ...receipt, freshness }
  },
})

export default defineHost({
  name: PACKAGE_NAME,
  Config,
  inject: ['agents', 'configEditor', 'sessionQuery', 'storageDomain', 'subprocess'],
  apis: [hostApi],
  setup: ctx => {
    const config = configFor(ctx)
    ctx.effect(() => async () => closeProjectChecksDomain(ctx), 'Project Checks receipt domain')
    if (!config.actions.some(action => action.verifyBeforeComplete)) return

    ctx.on('agent/turn-stopping', async ({ agent, turn, signal }) => {
      const sessionId = String(agent.session.id)
      const actions = config.actions.filter(action => action.verifyBeforeComplete)
      const available: ProjectAction[] = []
      for (const action of actions) {
        try {
          await sessionPaths(ctx, sessionId, action)
          available.push(action)
        } catch {
          continue
        }
      }
      if (available.length === 0 || signal.aborted) return

      const previous = await readStoredReceipts(ctx, sessionId)
      const previousAttempts = previous.filter(receipt => receipt.automatic && receipt.verificationTurn === turn).map(receipt => receipt.attempt)
      const attempt = Math.max(0, ...previousAttempts) + 1
      if (attempt > config.maxVerificationAttempts) throw new Error('Project verification attempt limit was exceeded.')

      const results: StoredReceipt[] = []
      for (const action of available) {
        if (signal.aborted) return
        results.push(
          await runAction(ctx, sessionId, action, {
            automatic: true,
            attempt,
            verificationTurn: turn,
            signal,
            requireRevision: true,
          }),
        )
      }

      if (signal.aborted) return
      const failed = results.filter(
        (receipt): receipt is StoredReceipt & { readonly status: 'failed' | 'cancelled' | 'timed-out' } => receipt.status !== 'passed',
      )
      if (failed.length === 0) return
      if (attempt < config.maxVerificationAttempts) {
        agent.steer({
          id: MessageId(randomUUID()),
          role: 'user',
          content: [
            {
              type: 'text',
              text: verificationPrompt(
                failed.map(receipt => ({
                  label: receipt.label,
                  status: receipt.status,
                  exitCode: receipt.exitCode,
                  failure: receipt.failure,
                })),
                attempt,
                config.maxVerificationAttempts,
              ),
            },
          ],
          source: { kind: 'dshfiles-project-checks' },
        })
        return
      }
      throw new Error('Configured project checks failed; this turn cannot be marked complete.')
    })
  },
})
