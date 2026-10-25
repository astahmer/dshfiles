import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-config-editor'
import type {} from '@deepseek-ai/dsh-hook-protocol'
import type {} from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-subprocess'
import { MessageId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineHost } from '@dshfiles/dshx/host'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { realpath } from 'node:fs/promises'
import { isAbsolute, normalize } from 'node:path'
import { PluginApiError, type ApiCaller } from '@dshfiles/dshx/api'
import { mayVerifyCandidate, projectChecksApi, type CandidateVerificationInput, type ProjectChecksTaskView, type ProjectHookEvent } from './api.js'
import type { ProjectChecksVerifiedTurn } from './completion-event.js'
import { projectChecksConfigSchema, ProjectChecksModel, type ProjectAction, type RemoteHost } from './core.js'
import { ExecutionModel, LOCAL_ENDPOINT_KEY, type RemoteEndpointState } from './execution.js'
import { ProjectChecksActivityModel, type ProjectChecksActivityEvent } from './receipt-activity.js'
import { runManagedProcess, type ProcessResult } from './managed-process.js'
import { PeerSnapshotModel, type PeerFailureCode, type StepResult } from './remote.js'
import { MAX_RECEIPTS_TOTAL, ProjectChecksReceiptModel, projectChecksDomain, storedReceiptSchema, type StoredReceipt } from './store.js'
import { DurableTaskRunner } from './durable-task-runner.js'
import { DurableTaskStore } from './durable-task-store.js'
import { durableTaskDomain } from './durable-task-domain.js'
import { durableTaskSchema, type DurableTask } from './durable-tasks.js'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'dshfiles/activity/event'(payload: ProjectChecksActivityEvent): void
    'dshfiles/activity/backfill'(payload: { readonly since?: number }): void
    'dshfiles/activity/source-ready'(payload: { readonly source: 'project-checks-receipts'; readonly version: 1 }): void
  }
}

const ENTRY_ID = 'dshfiles-project-checks'
const PACKAGE_NAME = '@dshfiles/project-checks'
const MAX_RECEIPTS_PER_SESSION = 30
const MAX_HOOK_EVENTS = 12
const REVISION_TIMEOUT_MS = 10_000
const REVISION_PATTERN = /^[a-f0-9]{40,64}$/

export const Config = projectChecksConfigSchema

type ReceiptStage =
  | 'resolve-session-paths'
  | 'capture-source-revision-before'
  | 'run-command'
  | 'capture-source-revision-after'
  | 'persist-receipt'
  | 'list-receipts'
  | 'materialize-receipts'
  | 'recover-tasks'
type ApiDiagnosticOperation = 'manual-run' | 'verification-run' | 'list-receipts' | 'durable-task'

const safeErrorCode = (cause: unknown): string | null => {
  if (!(cause instanceof Error) || !('code' in cause)) return null
  const code = cause.code
  if (typeof code !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(code)) return null
  return code
}

const reportApiFailure = (operation: ApiDiagnosticOperation, diagnosticId: string, stage: ReceiptStage, cause: unknown): void => {
  console.error('Project Checks API operation failed', {
    api: 'project-checks',
    operation,
    diagnosticId,
    stage,
    errorType: cause instanceof Error ? cause.name.slice(0, 64) : typeof cause,
    errorCode: safeErrorCode(cause),
  })
}

interface ProjectPaths {
  readonly root: string
  readonly cwd: string
}

interface ReceiptOptions {
  readonly automatic: boolean
  readonly attempt: number
  readonly verificationTurn: number | null
  readonly verificationStage?: 'completion' | 'rebase'
  readonly expectedRevision?: string
  readonly signal?: AbortSignal
  readonly requireRevision: boolean
  readonly durableTaskId?: string
  readonly durableTaskAttemptId?: string
  readonly onProgress?: (progress: DurableTask['attempts'][number]['progress']) => Promise<void>
}

interface CompletionVerificationPermit {
  readonly turn: number
  readonly sourceRevision: string
  readonly signal: AbortSignal
  readonly actionIds: readonly string[]
}

const completionPermits = new WeakMap<Context, Map<string, CompletionVerificationPermit>>()

const completionPermitsFor = (ctx: Context): Map<string, CompletionVerificationPermit> => {
  const existing = completionPermits.get(ctx)
  if (existing !== undefined) return existing
  const permits = new Map<string, CompletionVerificationPermit>()
  completionPermits.set(ctx, permits)
  return permits
}

const hasVerifiedCompletion = (
  ctx: Context,
  input: { readonly sessionId: string; readonly turn: number; readonly sourceRevision: string },
  signal: AbortSignal,
): boolean => {
  const permit = completionPermits.get(ctx)?.get(input.sessionId)
  return (
    permit !== undefined &&
    !signal.aborted &&
    permit.signal === signal &&
    permit.turn === input.turn &&
    permit.sourceRevision === input.sourceRevision &&
    permit.actionIds.length > 0
  )
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
  if (!ProjectChecksModel.isWithinRoot(root, cwd)) throw new Error('This session is outside the action’s trusted project root.')
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

const openDurableTaskDomain = (ctx: Context) => {
  const storage = ctx.get('storageDomain')
  if (storage === undefined) throw new Error('Durable Project Checks storage is unavailable.')
  return storage.open(durableTaskDomain)
}

type DurableTaskDomain = Awaited<ReturnType<typeof openDurableTaskDomain>>
const durableTaskDomains = new WeakMap<Context, Promise<DurableTaskDomain>>()
const durableTaskStores = new WeakMap<Context, Promise<DurableTaskStore>>()
const durableTaskRunners = new WeakMap<Context, Promise<DurableTaskRunner>>()

const durableTaskDomainFor = (ctx: Context): Promise<DurableTaskDomain> => {
  const existing = durableTaskDomains.get(ctx)
  if (existing !== undefined) return existing
  const opening = Promise.resolve().then(() => openDurableTaskDomain(ctx))
  durableTaskDomains.set(ctx, opening)
  void opening.catch(() => {
    if (durableTaskDomains.get(ctx) === opening) durableTaskDomains.delete(ctx)
  })
  return opening
}

const durableTaskStoreFor = (ctx: Context): Promise<DurableTaskStore> => {
  const existing = durableTaskStores.get(ctx)
  if (existing !== undefined) return existing
  const opening = Promise.resolve().then(async () => {
    const store = await DurableTaskStore.open()
    try {
      const [domain, receipts] = await Promise.all([durableTaskDomainFor(ctx), storageFor(ctx)])
      await store.importLegacy({
        tasks: Array.from(domain.table('tasks').entries()).map(([, task]) => task),
        receipts: Array.from(receipts.table('receipts').entries()).map(([, receipt]) => receipt),
      })
      return store
    } catch (error) {
      store.close()
      throw error
    }
  })
  durableTaskStores.set(ctx, opening)
  void opening.catch(() => {
    if (durableTaskStores.get(ctx) === opening) durableTaskStores.delete(ctx)
  })
  return opening
}

const taskFingerprint = (action: ProjectAction): string =>
  createHash('sha256')
    .update(
      JSON.stringify({
        id: action.id,
        command: action.command,
        args: action.args,
        root: action.root,
        timeoutMs: action.timeoutMs,
        replayPolicy: action.replayPolicy,
      }),
    )
    .digest('hex')

const closeProjectChecksDomain = async (ctx: Context): Promise<void> => {
  const opening = storageDomains.get(ctx)
  if (opening === undefined) return
  try {
    await opening.then(
      domain => domain.close(),
      () => undefined,
    )
  } finally {
    if (storageDomains.get(ctx) === opening) storageDomains.delete(ctx)
  }
}

const durableTaskRunnerFor = async (ctx: Context): Promise<DurableTaskRunner> => {
  const existing = durableTaskRunners.get(ctx)
  if (existing !== undefined) return existing
  const opening = Promise.resolve().then(async () => {
    const store = await durableTaskStoreFor(ctx)
    const runner = new DurableTaskRunner({
      table: store,
      newAttemptId: randomUUID,
      validate: async task => {
        const action = configFor(ctx).actions.find(candidate => candidate.id === task.actionId)
        if (action === undefined || action.execution.target !== 'local' || task.handlerVersion !== 1) return { runnable: false, safeReplay: false }
        if (task.actionFingerprint !== taskFingerprint(action)) return { runnable: false, safeReplay: false }
        try {
          const paths = await sessionPaths(ctx, task.sessionId, action)
          return { runnable: paths.cwd === task.cwd, safeReplay: action.replayPolicy === 'read-only' }
        } catch {
          return { runnable: false, safeReplay: false }
        }
      },
      findReceipt: async (taskId, attemptId) => {
        const saved = store.findAttemptReceipt(taskId, attemptId)
        if (saved === undefined) return null
        const receipt = storedReceiptSchema.parse(saved)
        if (receipt.taskId !== taskId || receipt.taskAttemptId !== attemptId)
          throw new Error('A stored receipt does not match the requested durable task attempt.')
        if (receipt.failure === 'process-group-failed') return { status: 'unknown', exitCode: receipt.exitCode }
        return {
          status: receipt.status === 'passed' ? 'succeeded' : receipt.status,
          exitCode: receipt.exitCode,
        }
      },
      run: async ({ task, attemptId, signal, progress }) => {
        const action = configFor(ctx).actions.find(candidate => candidate.id === task.actionId)
        if (action === undefined) return { status: 'unknown', exitCode: null }
        const receipt = await runAction(ctx, task.sessionId, action, {
          automatic: false,
          attempt: task.attempts[task.attempts.length - 1]?.number ?? 1,
          verificationTurn: null,
          signal,
          requireRevision: false,
          durableTaskId: task.id,
          durableTaskAttemptId: attemptId,
          onProgress: progress,
        })
        if (receipt.failure === 'process-group-failed') return { status: 'unknown', exitCode: receipt.exitCode }
        return {
          status: receipt.status === 'passed' ? 'succeeded' : receipt.status,
          exitCode: receipt.exitCode,
        }
      },
      onFailure: error => reportApiFailure('durable-task', randomUUID(), 'run-command', error),
    })
    await runner.recover()
    return runner
  })
  durableTaskRunners.set(ctx, opening)
  void opening.catch(() => {
    if (durableTaskRunners.get(ctx) === opening) durableTaskRunners.delete(ctx)
  })
  return opening
}

const closeDurableProjectChecksTasks = async (ctx: Context): Promise<void> => {
  const runnerOpening = durableTaskRunners.get(ctx)
  if (runnerOpening !== undefined) {
    await runnerOpening.then(
      runner => runner.close(),
      () => undefined,
    )
    if (durableTaskRunners.get(ctx) === runnerOpening) durableTaskRunners.delete(ctx)
  }
  const storeOpening = durableTaskStores.get(ctx)
  if (storeOpening !== undefined) {
    await storeOpening.then(
      store => store.close(),
      () => undefined,
    )
    if (durableTaskStores.get(ctx) === storeOpening) durableTaskStores.delete(ctx)
  }
  const domainOpening = durableTaskDomains.get(ctx)
  if (domainOpening !== undefined) {
    await domainOpening.then(
      domain => domain.close(),
      () => undefined,
    )
    if (durableTaskDomains.get(ctx) === domainOpening) durableTaskDomains.delete(ctx)
  }
}

const readStoredReceipts = async (ctx: Context, sessionId: string): Promise<StoredReceipt[]> => {
  const [domain, taskStore] = await Promise.all([storageFor(ctx), durableTaskStoreFor(ctx)])
  const receipts = new Map<string, StoredReceipt>()
  for (const [, receipt] of domain.table('receipts').entries()) receipts.set(receipt.id, receipt)
  for (const saved of taskStore.listAttemptReceipts({ sessionId, limit: MAX_RECEIPTS_PER_SESSION })) {
    const receipt = storedReceiptSchema.parse(saved)
    receipts.set(receipt.id, receipt)
  }
  return [...receipts.values()]
    .filter(receipt => receipt.sessionId === sessionId)
    .sort((left, right) => right.finishedAt - left.finishedAt || right.id.localeCompare(left.id))
    .slice(0, MAX_RECEIPTS_PER_SESSION)
}

const readStoredReceiptsAfter = async (ctx: Context, since: number): Promise<readonly StoredReceipt[]> => {
  const [domain, taskStore] = await Promise.all([storageFor(ctx), durableTaskStoreFor(ctx)])
  const receipts = new Map<string, StoredReceipt>()
  for (const [, receipt] of domain.table('receipts').entries()) receipts.set(receipt.id, receipt)
  for (const saved of taskStore.listAttemptReceipts({ since, limit: MAX_RECEIPTS_TOTAL })) {
    const receipt = storedReceiptSchema.parse(saved)
    receipts.set(receipt.id, receipt)
  }
  return ProjectChecksReceiptModel.after(
    [...receipts].map(([key, receipt]) => [key, receipt]),
    since,
    MAX_RECEIPTS_TOTAL,
  )
}

const emitReceiptActivity = (ctx: Context, receipt: StoredReceipt): void =>
  ProjectChecksActivityModel.emit(receipt, event => ctx.emit('dshfiles/activity/event', event))

const persistReceipt = async (ctx: Context, receipt: StoredReceipt): Promise<void> => {
  if (receipt.taskId !== undefined || receipt.taskAttemptId !== undefined) {
    if (receipt.taskId === undefined || receipt.taskAttemptId === undefined) throw new Error('A durable task receipt is missing its task identity.')
    await (await durableTaskStoreFor(ctx)).saveAttemptReceipt(storedReceiptSchema.parse(receipt))
    return
  }
  const table = (await storageFor(ctx)).table('receipts')
  await table.put(ProjectChecksReceiptModel.key(receipt), receipt)
  const removals = ProjectChecksReceiptModel.trimRows(Array.from(table.entries()), receipt.sessionId, MAX_RECEIPTS_PER_SESSION, MAX_RECEIPTS_TOTAL)
  await Promise.all(removals.map(key => table.delete(key)))
}

const runManaged = (ctx: Context, command: string, args: readonly string[], cwd: string, timeoutMs: number, signal: AbortSignal | undefined) =>
  runManagedProcess({ subprocess: ctx.subprocess, command, args, cwd, timeoutMs, signal })

/** Free plus reclaimable memory: the signal that says the laptop has headroom to join `auto`. */
const availableMemoryMb = (): number => Math.floor(process.availableMemory() / 1_048_576)

const sourceRevision = async (ctx: Context, cwd: string, signal?: AbortSignal): Promise<string | null> => {
  const result = await runManaged(ctx, 'jj', ['log', '--no-graph', '-r', '@', '--template', 'commit_id'], cwd, REVISION_TIMEOUT_MS, signal)
  if (result.failure !== null || result.exitCode !== 0) return null
  const revision = result.stdout.trim()
  return REVISION_PATTERN.test(revision) ? revision : null
}

const sourceChangeId = async (ctx: Context, cwd: string, signal?: AbortSignal): Promise<string | null> => {
  const result = await runManaged(ctx, 'jj', ['log', '--no-graph', '-r', '@', '--template', 'change_id'], cwd, REVISION_TIMEOUT_MS, signal)
  if (result.failure !== null || result.exitCode !== 0) return null
  return PeerSnapshotModel.changeId(result.stdout)
}

interface EndpointBudget {
  readonly inFlight: number
  readonly coolingDownUntil: number
}

const endpointBudgets = new WeakMap<Context, Map<string, EndpointBudget>>()

const budgetsFor = (ctx: Context): Map<string, EndpointBudget> => {
  const existing = endpointBudgets.get(ctx)
  if (existing !== undefined) return existing
  const budgets = new Map<string, EndpointBudget>()
  endpointBudgets.set(ctx, budgets)
  return budgets
}

const budgetSnapshot = (ctx: Context): ReadonlyMap<string, RemoteEndpointState> => new Map(budgetsFor(ctx))

const withEndpoint = async <Result>(ctx: Context, key: string, work: () => Promise<Result>): Promise<Result> => {
  const budgets = budgetsFor(ctx)
  const current = budgets.get(key) ?? { inFlight: 0, coolingDownUntil: 0 }
  budgets.set(key, { coolingDownUntil: current.coolingDownUntil, inFlight: current.inFlight + 1 })
  try {
    return await work()
  } finally {
    const settled = budgets.get(key) ?? { inFlight: 1, coolingDownUntil: 0 }
    budgets.set(key, { coolingDownUntil: settled.coolingDownUntil, inFlight: Math.max(0, settled.inFlight - 1) })
  }
}

const coolDownEndpoint = (ctx: Context, key: string, durationMs: number): void => {
  const budgets = budgetsFor(ctx)
  const current = budgets.get(key) ?? { inFlight: 0, coolingDownUntil: 0 }
  budgets.set(key, { coolingDownUntil: Date.now() + durationMs, inFlight: current.inFlight })
}

const toStepResult = (result: ProcessResult): StepResult => ({
  code: result.exitCode,
  stdout: result.stdout,
  stderr: result.stderr,
  failure: result.failure === 'cancelled' ? 'cancelled' : result.failure === 'timed-out' ? 'timed-out' : result.failure === null ? null : 'spawn-failed',
})

const localGitRunner =
  (ctx: Context, cwd: string, signal: AbortSignal | undefined) =>
  async ({ args, timeoutMs }: { readonly args: readonly string[]; readonly timeoutMs: number }): Promise<StepResult> =>
    toStepResult(await runManaged(ctx, 'jj', args, cwd, timeoutMs, signal))

const peerShellRunner =
  (ctx: Context, sshTarget: string, cwd: string, signal: AbortSignal | undefined) =>
  async ({ command, timeoutMs }: { readonly command: string; readonly timeoutMs: number }): Promise<StepResult> =>
    toStepResult(await runManaged(ctx, 'ssh', [...PeerSnapshotModel.sshOptions, sshTarget, command], cwd, timeoutMs, signal))

interface AttemptRun {
  readonly status: StoredReceipt['status']
  readonly failure: StoredReceipt['failure']
  readonly exitCode: number | null
  readonly executor: NonNullable<StoredReceipt['executor']>
  readonly remoteFailure: StoredReceipt['remoteFailure']
}

const runLocalAction = async ({
  ctx,
  action,
  cwd,
  signal,
}: {
  readonly ctx: Context
  readonly action: ProjectAction
  readonly cwd: string
  readonly signal: AbortSignal | undefined
}): Promise<AttemptRun> => {
  const result = await runManaged(ctx, action.command, action.args, cwd, action.timeoutMs, signal)
  return {
    status: result.failure === 'cancelled' ? 'cancelled' : result.failure === 'timed-out' ? 'timed-out' : result.exitCode === 0 ? 'passed' : 'failed',
    failure: result.failure === 'process-group-failed' ? 'process-group-failed' : result.failure === 'spawn-failed' ? 'spawn-failed' : null,
    exitCode: result.exitCode,
    executor: { kind: 'local' },
    remoteFailure: null,
  }
}

const remoteExecutor = (remote: RemoteHost): NonNullable<StoredReceipt['executor']> => ({
  kind: 'remote',
  remoteId: remote.id,
  sshTarget: remote.sshTarget,
  workspace: remote.workspace,
})

const runRemoteAttempt = async ({
  ctx,
  remote,
  action,
  paths,
  revision,
  signal,
}: {
  readonly ctx: Context
  readonly remote: RemoteHost
  readonly action: ProjectAction
  readonly paths: ProjectPaths
  readonly revision: string
  readonly signal: AbortSignal | undefined
}): Promise<{ readonly ok: true; readonly run: AttemptRun } | { readonly ok: false; readonly code: PeerFailureCode; readonly message: string }> => {
  const changeId = await sourceChangeId(ctx, paths.cwd, signal)
  if (changeId === null) return { ok: false, code: 'peer-snapshot-unavailable', message: 'The working-copy change id is unavailable.' }
  const outcome = await PeerSnapshotModel.run({
    remote,
    revision,
    changeId,
    action: { command: action.command, args: action.args, timeoutMs: action.timeoutMs },
    signal,
    runLocalGit: localGitRunner(ctx, paths.cwd, signal),
    runPeerShell: peerShellRunner(ctx, remote.sshTarget, paths.cwd, signal),
  })
  if (!outcome.ok) return outcome
  return {
    ok: true,
    run: {
      status: outcome.exitCode === 0 ? 'passed' : 'failed',
      failure: null,
      exitCode: outcome.exitCode,
      executor: remoteExecutor(remote),
      remoteFailure: null,
    },
  }
}

const runAction = async (ctx: Context, sessionId: string, action: ProjectAction, options: ReceiptOptions): Promise<StoredReceipt> => {
  const diagnosticId = randomUUID()
  let stage: ReceiptStage = 'resolve-session-paths'
  try {
    await options.onProgress?.('resolving-workspace')
    const paths = await sessionPaths(ctx, sessionId, action)
    const startedAt = Date.now()
    stage = 'capture-source-revision-before'
    const beforeRevision = await sourceRevision(ctx, paths.cwd, options.signal)
    let status: StoredReceipt['status'] = 'failed'
    let failure: StoredReceipt['failure'] = null
    let exitCode: number | null = null
    let afterRevision: string | null = beforeRevision
    let executor: NonNullable<StoredReceipt['executor']> | undefined
    let remoteFailure: StoredReceipt['remoteFailure'] = null

    if (options.requireRevision && beforeRevision === null) {
      failure = 'revision-unavailable'
    } else if (options.expectedRevision !== undefined && beforeRevision !== options.expectedRevision) {
      failure = 'source-changed'
    } else {
      stage = 'run-command'
      await options.onProgress?.('starting-process')
      const config = configFor(ctx)
      const choice = ExecutionModel.choose({
        policy: action.execution,
        remotes: config.remotes,
        localMemoryFloorMb: config.load.localMemoryFloorMb,
        freeMemoryMb: availableMemoryMb(),
        now: Date.now(),
        states: budgetSnapshot(ctx),
      })
      const remote = choice.endpoint.kind === 'remote' && beforeRevision !== null ? choice.endpoint.remote : undefined

      if (remote !== undefined && beforeRevision !== null) {
        const outcome = await withEndpoint(ctx, remote.id, () =>
          runRemoteAttempt({ ctx, remote, action, paths, revision: beforeRevision, signal: options.signal }),
        )
        if (outcome.ok) {
          status = outcome.run.status
          failure = outcome.run.failure
          exitCode = outcome.run.exitCode
          executor = outcome.run.executor
        } else {
          const plan = ExecutionModel.planRemoteFailure({
            policy: action.execution,
            remoteId: remote.id,
            code: outcome.code,
            message: outcome.message,
          })
          if (plan.decision !== 'cancelled') coolDownEndpoint(ctx, remote.id, config.load.remoteCooldownMs)
          remoteFailure = plan.remoteFailure
          if (plan.decision === 'cancelled') {
            status = 'cancelled'
          } else if (plan.decision === 'fail') {
            status = 'failed'
            failure = plan.failure
            executor = remoteExecutor(remote)
          } else {
            const local = await withEndpoint(ctx, LOCAL_ENDPOINT_KEY, () => runLocalAction({ ctx, action, cwd: paths.cwd, signal: options.signal }))
            status = local.status
            failure = local.failure
            exitCode = local.exitCode
            executor = local.executor
          }
        }
      } else if (choice.reason === 'remote-unavailable' && action.execution.onRemoteFailure === 'fail') {
        status = 'failed'
        failure = 'remote-unavailable'
        remoteFailure = {
          remoteId: action.execution.remote ?? 'remote',
          code: 'peer-unavailable',
          message: 'No configured remote can run this action.',
        }
      } else {
        const local = await withEndpoint(ctx, LOCAL_ENDPOINT_KEY, () => runLocalAction({ ctx, action, cwd: paths.cwd, signal: options.signal }))
        status = local.status
        failure = local.failure
        exitCode = local.exitCode
        executor = local.executor
      }

      stage = 'capture-source-revision-after'
      afterRevision = await sourceRevision(ctx, paths.cwd, options.signal)
      if (status === 'passed' && beforeRevision !== null && afterRevision !== beforeRevision) {
        status = 'failed'
        failure = 'source-changed'
      }
    }

    await options.onProgress?.('recording-result')
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
      sourceRevisionBefore: beforeRevision,
      sourceRevisionAfter: afterRevision,
      verificationTurn: options.verificationTurn,
      automatic: options.automatic,
      attempt: options.attempt,
    }
    if (options.durableTaskId !== undefined) receipt.taskId = options.durableTaskId
    if (options.durableTaskAttemptId !== undefined) receipt.taskAttemptId = options.durableTaskAttemptId
    if (executor !== undefined) receipt.executor = executor
    if (remoteFailure !== null) receipt.remoteFailure = remoteFailure
    if (options.verificationStage !== undefined) receipt.verificationStage = options.verificationStage
    stage = 'persist-receipt'
    await ProjectChecksActivityModel.persistAndEmit({
      receipt,
      persist: () => persistReceipt(ctx, receipt),
      emit: event => ctx.emit('dshfiles/activity/event', event),
    })
    return receipt
  } catch (cause) {
    reportApiFailure(options.automatic ? 'verification-run' : 'manual-run', diagnosticId, stage, cause)
    throw cause
  }
}

const verifyRebasedCandidate = async (ctx: Context, input: CandidateVerificationInput, signal: AbortSignal) => {
  if (signal.aborted) return { status: 'cancelled' as const, prompt: null }
  if (!hasVerifiedCompletion(ctx, input, signal)) return { status: 'unavailable' as const, prompt: null }

  const config = configFor(ctx)
  const available: Array<{ readonly action: ProjectAction; readonly cwd: string }> = []
  for (const action of config.actions.filter(candidate => candidate.verifyBeforeComplete)) {
    try {
      available.push({ action, cwd: (await sessionPaths(ctx, input.sessionId, action)).cwd })
    } catch {
      continue
    }
  }

  const permit = completionPermits.get(ctx)?.get(input.sessionId)
  if (permit === undefined || permit.actionIds.some(actionId => !available.some(candidate => candidate.action.id === actionId))) {
    return { status: 'unavailable' as const, prompt: 'A completion check is no longer available for this thread directory.' }
  }
  const firstAvailable = available[0]
  if (firstAvailable === undefined) return { status: 'unavailable' as const, prompt: 'No configured Project Checks are available for this thread directory.' }

  const currentRevision = await sourceRevision(ctx, firstAvailable.cwd, signal)
  if (currentRevision === null || currentRevision !== input.expectedRevision) {
    return {
      status: 'stale' as const,
      prompt: 'The rebased working copy changed before Project Checks could verify it. The bookmark was not advanced; stop again for verification.',
    }
  }

  const previous = await readStoredReceipts(ctx, input.sessionId)
  const previousAttempts = previous
    .filter(receipt => receipt.automatic && receipt.verificationTurn === input.turn && receipt.verificationStage === 'rebase')
    .map(receipt => receipt.attempt)
  const attempt = Math.max(0, ...previousAttempts) + 1
  if (attempt > config.maxVerificationAttempts) {
    return {
      status: 'attempt-limit' as const,
      prompt: `Automatic integration stopped after ${config.maxVerificationAttempts} post-rebase verification attempts for this turn. The bookmark was not advanced; review the receipts or retry in a new turn.`,
    }
  }

  const results: StoredReceipt[] = []
  for (const { action } of available) {
    if (signal.aborted) return { status: 'cancelled' as const, prompt: null }
    results.push(
      await runAction(ctx, input.sessionId, action, {
        automatic: true,
        attempt,
        verificationTurn: input.turn,
        verificationStage: 'rebase',
        expectedRevision: input.expectedRevision,
        signal,
        requireRevision: true,
      }),
    )
  }
  if (signal.aborted) return { status: 'cancelled' as const, prompt: null }

  const failed = results.filter((receipt): receipt is StoredReceipt & { readonly status: 'failed' | 'cancelled' | 'timed-out' } => receipt.status !== 'passed')
  if (failed.length > 0) {
    return {
      status: 'failed' as const,
      prompt: ProjectChecksModel.verificationPrompt(
        failed.map(receipt => ({
          label: receipt.label,
          status: receipt.status,
          exitCode: receipt.exitCode,
          failure: receipt.failure,
        })),
        attempt,
        config.maxVerificationAttempts,
      ),
    }
  }

  const finalRevision = await sourceRevision(ctx, firstAvailable.cwd, signal)
  if (signal.aborted) return { status: 'cancelled' as const, prompt: null }
  if (finalRevision !== input.expectedRevision) {
    return {
      status: 'stale' as const,
      prompt: 'The rebased working copy changed while Project Checks were running. The bookmark was not advanced; stop again for verification.',
    }
  }
  return { status: 'passed' as const, prompt: null }
}

const apiActions = async (ctx: Context, sessionId: string) => {
  const config = configFor(ctx)
  const visible: Array<{
    id: string
    label: string
    description: string
    timeoutMs: number
    verifyBeforeComplete: boolean
    replayPolicy: 'manual' | 'read-only'
    execution: { target: 'local' | 'remote' | 'auto'; remoteId: string | null; onRemoteFailure: 'local' | 'fail' }
  }> = []
  for (const action of config.actions) {
    try {
      await sessionPaths(ctx, sessionId, action)
      visible.push({
        id: action.id,
        label: action.label,
        description: action.description,
        timeoutMs: action.timeoutMs,
        verifyBeforeComplete: action.verifyBeforeComplete,
        replayPolicy: action.replayPolicy,
        execution: {
          target: action.execution.target,
          remoteId: action.execution.remote ?? null,
          onRemoteFailure: action.execution.onRemoteFailure,
        },
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
        if (action === undefined) return { ...receipt, configurationFreshness: 'unknown' as const, freshness: 'unknown' as const }
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
        const receiptRevision = receipt.sourceRevisionAfter === undefined ? receipt.sourceRevision : receipt.sourceRevisionAfter
        return { ...receipt, configurationFreshness: 'unknown' as const, freshness: ProjectChecksModel.receiptFreshness(receiptRevision, await revision) }
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

/** The session a check request targets: the named one, else the calling Agent's own session. */
const targetSessionId = (requested: string | undefined, caller: ApiCaller): string => {
  if (requested !== undefined) return requested
  if (caller.kind === 'agent' && caller.sessionId !== undefined) return caller.sessionId
  throw new PluginApiError('Pass sessionId: this tool cannot tell which thread to check.', { code: 'checks-target-unknown' })
}

const durableTaskView = (task: DurableTask, action: ProjectAction | undefined): ProjectChecksTaskView => {
  const attempt = task.attempts[task.attempts.length - 1]
  return {
    id: task.id,
    sessionId: task.sessionId,
    actionId: task.actionId,
    label: action?.label ?? task.actionId,
    status: task.status,
    progress: attempt?.progress ?? 'queued',
    attemptCount: task.attempts.length,
    attempts: task.attempts.map(current => ({
      id: current.id,
      number: current.number,
      status: current.status,
      progress: current.progress,
      startedAt: current.startedAt,
      finishedAt: current.finishedAt,
      exitCode: current.exitCode,
    })),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    exitCode: attempt?.exitCode ?? null,
    errorCode: task.errorCode,
  }
}

const actionForDurableTask = (ctx: Context, actionId: string): ProjectAction => {
  const action = configFor(ctx).actions.find(candidate => candidate.id === actionId)
  if (action === undefined || action.execution.target !== 'local') {
    throw new Error('Durable Project Checks currently supports configured local actions only.')
  }
  return action
}

const dispatchDurableTask = async (ctx: Context, sessionId: string, actionId: string, idempotencyKey: string): Promise<ProjectChecksTaskView> => {
  const action = actionForDurableTask(ctx, actionId)
  const paths = await sessionPaths(ctx, sessionId, action)
  const taskId = createHash('sha256').update(`${sessionId}\0${idempotencyKey}`).digest('hex')
  const now = Date.now()
  const task = durableTaskSchema.parse({
    id: taskId,
    idempotencyKey,
    sessionId,
    actionId,
    handlerVersion: 1,
    actionFingerprint: taskFingerprint(action),
    cwd: paths.cwd,
    status: 'queued',
    attempts: [],
    createdAt: now,
    updatedAt: now,
    errorCode: null,
  })
  const stored = await (await durableTaskRunnerFor(ctx)).enqueue(task)
  return durableTaskView(stored, action)
}

const hostApi = projectChecksApi.host({
  actions: async ({ input, ctx, caller }) => apiActions(ctx, targetSessionId(input.sessionId, caller)),
  receipts: async ({ input, ctx, caller }) => apiReceipts(ctx, targetSessionId(input.sessionId, caller)),
  hookEvents: async ({ input, ctx, caller }) => hookEvents(ctx, targetSessionId(input.sessionId, caller)),
  run: async ({ input, ctx, caller, signal }) => {
    const sessionId = targetSessionId(input.sessionId, caller)
    const action = configFor(ctx).actions.find(candidate => candidate.id === input.actionId)
    if (action === undefined) throw new Error('Project action is not configured.')
    const isVisible = (await apiActions(ctx, sessionId)).some(candidate => candidate.id === action.id)
    if (!isVisible) throw new Error('Project action is not available in this session directory.')
    const receipt = await runAction(ctx, sessionId, action, {
      automatic: false,
      attempt: 0,
      verificationTurn: null,
      signal,
      requireRevision: false,
    })
    const receiptRevision = receipt.sourceRevisionAfter === undefined ? receipt.sourceRevision : receipt.sourceRevisionAfter
    const freshness = ProjectChecksModel.receiptFreshness(
      receiptRevision,
      await (async () => {
        try {
          return await sourceRevision(ctx, (await sessionPaths(ctx, sessionId, action)).cwd)
        } catch {
          return null
        }
      })(),
    )
    return { ...receipt, configurationFreshness: 'unknown' as const, freshness }
  },
  dispatch: async ({ input, ctx, caller }) => dispatchDurableTask(ctx, targetSessionId(input.sessionId, caller), input.actionId, input.idempotencyKey),
  tasks: async ({ input, ctx, caller }) => {
    const sessionId = targetSessionId(input.sessionId, caller)
    const runner = await durableTaskRunnerFor(ctx)
    return (await runner.list(sessionId)).map(task =>
      durableTaskView(
        task,
        configFor(ctx).actions.find(action => action.id === task.actionId),
      ),
    )
  },
  cancelTask: async ({ input, ctx, caller }) => {
    const sessionId = targetSessionId(input.sessionId, caller)
    const runner = await durableTaskRunnerFor(ctx)
    const existing = runner.get(input.taskId)
    if (existing === undefined || existing.sessionId !== sessionId) throw new Error('No durable task belongs to this session.')
    const task = await runner.cancel(input.taskId)
    return durableTaskView(
      task,
      configFor(ctx).actions.find(action => action.id === task.actionId),
    )
  },
  retryTask: async ({ input, ctx, caller }) => {
    const sessionId = targetSessionId(input.sessionId, caller)
    const runner = await durableTaskRunnerFor(ctx)
    const existing = runner.get(input.taskId)
    if (existing === undefined || existing.sessionId !== sessionId) throw new Error('No durable task belongs to this session.')
    const task = await runner.retry(input.taskId, input.confirmPossibleDuplicate)
    return durableTaskView(
      task,
      configFor(ctx).actions.find(action => action.id === task.actionId),
    )
  },
  assertVerifiedCompletion: async ({ input, ctx, signal, caller }) => {
    if (!mayVerifyCandidate(caller)) throw new Error('Only jj-integration may verify a completed turn.')
    return { status: hasVerifiedCompletion(ctx, input, signal) ? 'authorized' : 'unavailable' }
  },
  verifyCandidate: async ({ input, ctx, signal, caller }) => {
    if (!mayVerifyCandidate(caller)) throw new Error('Only jj-integration may verify a rebased candidate.')
    return verifyRebasedCandidate(ctx, input, signal)
  },
})

export default defineHost({
  name: PACKAGE_NAME,
  Config,
  inject: ['agents', 'configEditor', 'sessionQuery', 'storageDomain', 'subprocess'],
  apis: [hostApi],
  setup: ctx => {
    const config = configFor(ctx)
    ctx.effect(() => {
      void durableTaskRunnerFor(ctx).catch(error => reportApiFailure('durable-task', randomUUID(), 'recover-tasks', error))
      return async () => {
        try {
          await closeDurableProjectChecksTasks(ctx)
        } finally {
          await closeProjectChecksDomain(ctx)
        }
      }
    }, 'Project Checks durable task and receipt domains')
    ctx.on('dshfiles/activity/backfill', payload => {
      const parsed = z.object({ since: z.number().int().nonnegative().optional() }).strict().safeParse(payload)
      if (!parsed.success) return undefined
      void readStoredReceiptsAfter(ctx, parsed.data.since ?? 0)
        .then(receipts => {
          for (const receipt of receipts) emitReceiptActivity(ctx, receipt)
        })
        .catch(() => undefined)
      return undefined
    })
    ctx.emit('dshfiles/activity/source-ready', { source: 'project-checks-receipts', version: 1 })
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
      const previousAttempts = previous
        .filter(
          receipt =>
            receipt.automatic && receipt.verificationTurn === turn && (receipt.verificationStage === undefined || receipt.verificationStage === 'completion'),
        )
        .map(receipt => receipt.attempt)
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
            verificationStage: 'completion',
            signal,
            requireRevision: true,
          }),
        )
      }

      if (signal.aborted) return
      const failed = results.filter(
        (receipt): receipt is StoredReceipt & { readonly status: 'failed' | 'cancelled' | 'timed-out' } => receipt.status !== 'passed',
      )
      const verifiedRevision = results[0]?.sourceRevision
      const allChecksShareRevision =
        verifiedRevision !== undefined && verifiedRevision !== null && results.every(receipt => receipt.sourceRevision === verifiedRevision)
      const requestAgentFix = (message: string): void => {
        agent.steer({
          id: MessageId(randomUUID()),
          role: 'user',
          content: [{ type: 'text', text: message.slice(0, 4_000) }],
          source: { kind: 'dshfiles-project-checks' },
        })
      }

      if (failed.length === 0 && verifiedRevision !== undefined && verifiedRevision !== null && allChecksShareRevision) {
        const permit: CompletionVerificationPermit = {
          turn,
          sourceRevision: verifiedRevision,
          signal,
          actionIds: results.map(receipt => receipt.actionId),
        }
        const permits = completionPermitsFor(ctx)
        permits.set(sessionId, permit)
        const verifiedTurn: ProjectChecksVerifiedTurn = {
          sessionId: SessionId(sessionId),
          turn,
          sourceRevision: verifiedRevision,
          signal,
          requestAgentFix,
        }
        try {
          await ctx.serial('dshfiles/project-checks/verified', verifiedTurn)
        } finally {
          if (permits.get(sessionId) === permit) permits.delete(sessionId)
        }
        return
      }

      const failurePrompt =
        failed.length === 0
          ? 'Project checks did not verify one exact working-copy revision. Inspect the work and stop again so every check runs against the same revision.'
          : ProjectChecksModel.verificationPrompt(
              failed.map(receipt => ({
                label: receipt.label,
                status: receipt.status,
                exitCode: receipt.exitCode,
                failure: receipt.failure,
              })),
              attempt,
              config.maxVerificationAttempts,
            )
      if (attempt < config.maxVerificationAttempts) {
        requestAgentFix(failurePrompt)
        return
      }
      throw new Error(
        failed.length === 0
          ? 'Project checks did not verify one exact working-copy revision; this turn cannot be marked complete.'
          : 'Configured project checks failed; this turn cannot be marked complete.',
      )
    })
  },
})
