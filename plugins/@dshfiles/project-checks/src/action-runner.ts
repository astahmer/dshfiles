import { Cause, Clock, Context, Effect, Exit, FileSystem, Layer, Option, Path, Ref } from 'effect'
import { randomUUID } from 'node:crypto'
import type { ProjectActionView } from './api.js'
import { ProjectChecksModel, type ProjectAction, type RemoteHost } from './core.js'
import type { DurableTask } from './durable-tasks.js'
import { ProfileConfigUnavailable, ReceiptStoreUnavailable, SessionPathUnavailable, TaskStoreUnavailable } from './errors.js'
import { ExecutionModel, LOCAL_ENDPOINT_KEY, type RemoteEndpointState } from './execution.js'
import { ChecksHost } from './host-promise.js'
import { ProcessRunner, type ProcessResult } from './managed-process.js'
import { ReceiptStore } from './receipt-store.js'
import { PeerSnapshotModel, type PeerRunOutcome, type StepResult } from './remote.js'
import type { StoredReceipt } from './store.js'

const REVISION_TIMEOUT_MS = 10_000
const REVISION_PATTERN = /^[a-f0-9]{40,64}$/

export interface ProjectPaths {
  readonly root: string
  readonly cwd: string
}

type Progress = DurableTask['attempts'][number]['progress']

export interface RunOptions {
  readonly automatic: boolean
  readonly attempt: number
  readonly verificationTurn: number | null
  readonly verificationStage?: 'completion' | 'rebase'
  readonly expectedRevision?: string
  readonly requireRevision: boolean
  readonly durableTaskId?: string
  readonly durableTaskAttemptId?: string
  readonly onProgress?: (progress: Progress) => Effect.Effect<void>
}

interface AttemptRun {
  readonly status: StoredReceipt['status']
  readonly failure: StoredReceipt['failure']
  readonly exitCode: number | null
  readonly executor: NonNullable<StoredReceipt['executor']> | undefined
  readonly remoteFailure: NonNullable<StoredReceipt['remoteFailure']> | null
}

type RunError = SessionPathUnavailable | ProfileConfigUnavailable | ReceiptStoreUnavailable | TaskStoreUnavailable

const attemptStatusOf = (result: ProcessResult): StoredReceipt['status'] => {
  if (result.failure === 'timed-out') return 'timed-out'
  return result.exitCode === 0 ? 'passed' : 'failed'
}

const toStepResult = (result: ProcessResult): StepResult => ({
  code: result.exitCode,
  stdout: result.stdout,
  stderr: result.stderr,
  failure: result.failure === null ? null : result.failure === 'timed-out' ? 'timed-out' : 'spawn-failed',
})

const localAttempt = (result: ProcessResult): AttemptRun => ({
  status: attemptStatusOf(result),
  failure: result.failure === 'process-group-failed' || result.failure === 'spawn-failed' ? result.failure : null,
  exitCode: result.exitCode,
  executor: { kind: 'local' },
  remoteFailure: null,
})

const remoteExecutor = (remote: RemoteHost): NonNullable<StoredReceipt['executor']> => ({
  kind: 'remote',
  remoteId: remote.id,
  sshTarget: remote.sshTarget,
  workspace: remote.workspace,
})

/** Free plus reclaimable memory: the signal that says the laptop has headroom to join `auto`. */
const availableMemoryMb = (): number => Math.floor(process.availableMemory() / 1_048_576)

const actionView = (action: ProjectAction): ProjectActionView => ({
  id: action.id,
  label: action.label,
  description: action.description,
  timeoutMs: action.timeoutMs,
  verifyBeforeComplete: action.verifyBeforeComplete,
  replayPolicy: action.replayPolicy,
  execution: { target: action.execution.target, remoteId: action.execution.remote ?? null, onRemoteFailure: action.execution.onRemoteFailure },
})

/**
 * Runs one configured action for a session, locally or on a peer, and records its receipt. An interrupted run still
 * records a `cancelled` receipt once its process is gone (`process-group-failed` when that could not be confirmed).
 */
export class ActionRunner extends Context.Service<
  ActionRunner,
  {
    readonly paths: (sessionId: string, action: ProjectAction) => Effect.Effect<ProjectPaths, SessionPathUnavailable>
    readonly visibleActions: (sessionId: string) => Effect.Effect<ReadonlyArray<ProjectActionView>, ProfileConfigUnavailable>
    readonly sourceRevision: (cwd: string) => Effect.Effect<string | null>
    readonly run: (input: {
      readonly sessionId: string
      readonly action: ProjectAction
      readonly options: RunOptions
    }) => Effect.Effect<StoredReceipt, RunError>
  }
>()('@dshfiles/project-checks/ActionRunner') {
  static readonly layer = Layer.effect(
    ActionRunner,
    Effect.gen(function* () {
      const host = yield* ChecksHost
      const processes = yield* ProcessRunner
      const receipts = yield* ReceiptStore
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const budgets = yield* Ref.make<ReadonlyMap<string, RemoteEndpointState>>(new Map())

      const paths = Effect.fn('project-checks session paths')(function* (sessionId: string, action: ProjectAction) {
        const selected = yield* host.sessionDirectory(sessionId)
        if (!path.isAbsolute(selected)) return yield* new SessionPathUnavailable({ reason: 'no-directory' })
        const unreadable = (cause: unknown) => new SessionPathUnavailable({ reason: 'unreadable', cause })
        const [root, cwd] = yield* Effect.all([fs.realPath(action.root), fs.realPath(selected)], { concurrency: 2 }).pipe(Effect.mapError(unreadable))
        if (root !== path.normalize(action.root)) return yield* new SessionPathUnavailable({ reason: 'root-not-canonical' })
        if (!ProjectChecksModel.isWithinRoot(root, cwd)) return yield* new SessionPathUnavailable({ reason: 'outside-root' })
        return { root, cwd }
      })

      const visibleActions = Effect.fn('project-checks actions visible')(function* (sessionId: string) {
        const config = yield* host.config
        const visible = yield* Effect.filter(config.actions, action => Effect.isSuccess(paths(sessionId, action)), { concurrency: 4 })
        return visible.map(actionView)
      })

      const jj = (cwd: string, template: 'commit_id' | 'change_id') =>
        processes.run({ command: 'jj', args: ['log', '--no-graph', '-r', '@', '--template', template], cwd, timeoutMs: REVISION_TIMEOUT_MS })

      const sourceRevision = Effect.fn('project-checks revision read')(function* (cwd: string) {
        const result = yield* jj(cwd, 'commit_id')
        if (result.failure !== null || result.exitCode !== 0) return null
        const revision = result.stdout.trim()
        return REVISION_PATTERN.test(revision) ? revision : null
      })

      const withEndpoint = <A, E, R>(key: string, work: Effect.Effect<A, E, R>) =>
        Effect.acquireUseRelease(
          Ref.update(budgets, current => {
            const budget = current.get(key) ?? { inFlight: 0, coolingDownUntil: 0 }
            return new Map(current).set(key, { coolingDownUntil: budget.coolingDownUntil, inFlight: budget.inFlight + 1 })
          }),
          () => work,
          () =>
            Ref.update(budgets, current => {
              const budget = current.get(key) ?? { inFlight: 1, coolingDownUntil: 0 }
              return new Map(current).set(key, { coolingDownUntil: budget.coolingDownUntil, inFlight: Math.max(0, budget.inFlight - 1) })
            }),
        )

      const coolDown = Effect.fnUntraced(function* (key: string, durationMs: number) {
        const now = yield* Clock.currentTimeMillis
        yield* Ref.update(budgets, current => {
          const budget = current.get(key) ?? { inFlight: 0, coolingDownUntil: 0 }
          return new Map(current).set(key, { coolingDownUntil: now + durationMs, inFlight: budget.inFlight })
        })
      })

      const runLocal = (action: ProjectAction, cwd: string): Effect.Effect<AttemptRun> =>
        withEndpoint(
          LOCAL_ENDPOINT_KEY,
          processes.run({ command: action.command, args: action.args, cwd, timeoutMs: action.timeoutMs }).pipe(Effect.map(localAttempt)),
        )

      const runRemote = Effect.fnUntraced(function* (input: {
        readonly remote: RemoteHost
        readonly action: ProjectAction
        readonly cwd: string
        readonly revision: string
      }) {
        const changeId = PeerSnapshotModel.changeId((yield* jj(input.cwd, 'change_id')).stdout)
        const unavailable: PeerRunOutcome = { ok: false, code: 'peer-snapshot-unavailable', message: 'The working-copy change id is unavailable.' }
        if (changeId === null) return unavailable
        return yield* PeerSnapshotModel.run({
          remote: input.remote,
          revision: input.revision,
          changeId,
          action: { command: input.action.command, args: input.action.args, timeoutMs: input.action.timeoutMs },
          runLocalGit: step => processes.run({ command: 'jj', args: step.args, cwd: input.cwd, timeoutMs: step.timeoutMs }).pipe(Effect.map(toStepResult)),
          runPeerShell: step =>
            processes
              .run({ command: 'ssh', args: [...PeerSnapshotModel.sshOptions, input.remote.sshTarget, step.command], cwd: input.cwd, timeoutMs: step.timeoutMs })
              .pipe(Effect.map(toStepResult)),
        })
      })

      const execute = Effect.fnUntraced(function* (action: ProjectAction, cwd: string, beforeRevision: string | null) {
        const config = yield* host.config
        const now = yield* Clock.currentTimeMillis
        const choice = ExecutionModel.choose({
          policy: action.execution,
          remotes: config.remotes,
          localMemoryFloorMb: config.load.localMemoryFloorMb,
          freeMemoryMb: availableMemoryMb(),
          now,
          states: yield* Ref.get(budgets),
        })
        const remote = choice.endpoint.kind === 'remote' ? choice.endpoint.remote : undefined
        if (remote !== undefined && beforeRevision !== null) {
          const outcome = yield* withEndpoint(remote.id, runRemote({ remote, action, cwd, revision: beforeRevision }))
          if (outcome.ok)
            return {
              status: outcome.exitCode === 0 ? 'passed' : 'failed',
              failure: null,
              exitCode: outcome.exitCode,
              executor: remoteExecutor(remote),
              remoteFailure: null,
            } satisfies AttemptRun
          const plan = ExecutionModel.planRemoteFailure({ policy: action.execution, remoteId: remote.id, code: outcome.code, message: outcome.message })
          if (plan.decision !== 'cancelled') yield* coolDown(remote.id, config.load.remoteCooldownMs)
          if (plan.decision === 'cancelled')
            return { status: 'cancelled', failure: null, exitCode: null, executor: undefined, remoteFailure: plan.remoteFailure } satisfies AttemptRun
          if (plan.decision === 'fail')
            return {
              status: 'failed',
              failure: plan.failure,
              exitCode: null,
              executor: remoteExecutor(remote),
              remoteFailure: plan.remoteFailure,
            } satisfies AttemptRun
          const local = yield* runLocal(action, cwd)
          return { ...local, remoteFailure: plan.remoteFailure }
        }
        if (choice.reason === 'remote-unavailable' && action.execution.onRemoteFailure === 'fail')
          return {
            status: 'failed',
            failure: 'remote-unavailable',
            exitCode: null,
            executor: undefined,
            remoteFailure: { remoteId: action.execution.remote ?? 'remote', code: 'peer-unavailable', message: 'No configured remote can run this action.' },
          } satisfies AttemptRun
        return yield* runLocal(action, cwd)
      })

      const receiptOf = (input: {
        readonly id: string
        readonly sessionId: string
        readonly action: ProjectAction
        readonly options: RunOptions
        readonly startedAt: number
        readonly finishedAt: number
        readonly beforeRevision: string | null
        readonly afterRevision: string | null
        readonly run: AttemptRun
      }): StoredReceipt => ({
        id: input.id,
        sessionId: input.sessionId,
        actionId: input.action.id,
        label: input.action.label,
        status: input.run.status,
        failure: input.run.failure,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        durationMs: Math.max(0, input.finishedAt - input.startedAt),
        exitCode: input.run.exitCode,
        sourceRevision: input.afterRevision,
        sourceRevisionBefore: input.beforeRevision,
        sourceRevisionAfter: input.afterRevision,
        verificationTurn: input.options.verificationTurn,
        automatic: input.options.automatic,
        attempt: input.options.attempt,
        ...(input.options.durableTaskId !== undefined && { taskId: input.options.durableTaskId }),
        ...(input.options.durableTaskAttemptId !== undefined && { taskAttemptId: input.options.durableTaskAttemptId }),
        ...(input.run.executor !== undefined && { executor: input.run.executor }),
        ...(input.run.remoteFailure !== null && { remoteFailure: input.run.remoteFailure }),
        ...(input.options.verificationStage !== undefined && { verificationStage: input.options.verificationStage }),
      })

      const run = Effect.fn('project-checks action run')(function* (input: {
        readonly sessionId: string
        readonly action: ProjectAction
        readonly options: RunOptions
      }) {
        const { sessionId, action, options } = input
        const progress = (value: Progress) => options.onProgress?.(value) ?? Effect.void
        const id = randomUUID()
        yield* progress('resolving-workspace')
        const projectPaths = yield* paths(sessionId, action)
        const startedAt = yield* Clock.currentTimeMillis
        const beforeRevision = yield* sourceRevision(projectPaths.cwd)
        const unrun = (failure: StoredReceipt['failure']): AttemptRun => ({
          status: 'failed',
          failure,
          exitCode: null,
          executor: undefined,
          remoteFailure: null,
        })

        const recordCancelled = (cause: Cause.Cause<unknown>) =>
          Effect.gen(function* () {
            const finishedAt = yield* Clock.currentTimeMillis
            const run: AttemptRun = { ...unrun(Cause.hasDies(cause) ? 'process-group-failed' : null), status: 'cancelled' }
            yield* receipts.persist(receiptOf({ id, sessionId, action, options, startedAt, finishedAt, beforeRevision, afterRevision: beforeRevision, run }))
          }).pipe(Effect.ignore({ log: 'Warn' }))

        const measured = Effect.gen(function* () {
          if (options.requireRevision && beforeRevision === null) return { run: unrun('revision-unavailable'), afterRevision: beforeRevision }
          if (options.expectedRevision !== undefined && beforeRevision !== options.expectedRevision)
            return { run: unrun('source-changed'), afterRevision: beforeRevision }
          yield* progress('starting-process')
          const executed = yield* execute(action, projectPaths.cwd, beforeRevision)
          const afterRevision = yield* sourceRevision(projectPaths.cwd)
          if (executed.status === 'passed' && beforeRevision !== null && afterRevision !== beforeRevision)
            return {
              run: { ...executed, ...unrun('source-changed'), exitCode: executed.exitCode, executor: executed.executor, remoteFailure: executed.remoteFailure },
              afterRevision,
            }
          return { run: executed, afterRevision }
        }).pipe(Effect.onExit(exit => (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause) ? recordCancelled(exit.cause) : Effect.void)))

        const outcome = yield* measured
        yield* progress('recording-result')
        const finishedAt = yield* Clock.currentTimeMillis
        const receipt = receiptOf({
          id,
          sessionId,
          action,
          options,
          startedAt,
          finishedAt,
          beforeRevision,
          afterRevision: outcome.afterRevision,
          run: outcome.run,
        })
        yield* receipts.persist(receipt)
        return receipt
      })

      return ActionRunner.of({ paths, visibleActions, sourceRevision, run })
    }),
  )
}

export const actionFor = (actions: ReadonlyArray<ProjectAction>, actionId: string): Option.Option<ProjectAction> =>
  Option.fromUndefinedOr(actions.find(action => action.id === actionId))
