import type {} from '@deepseek-ai/dsh-hook-protocol'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { ApiCaller } from '@dshfiles/dshx/api'
import { Api, DshxPlugin } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node/NodePath'
import { Clock, Effect, Layer, Option, Schema } from 'effect'
import { createHash, randomUUID } from 'node:crypto'
import { actionFor, ActionRunner } from './action-runner.js'
import { mayVerifyCandidate, projectChecksApi, type ProjectChecksTaskView } from './api.js'
import { CompletionChecks } from './completion-checks.js'
import { projectChecksConfigSchema, ProjectChecksModel, type ProjectAction, type ProjectChecksConfig } from './core.js'
import { DurableTaskHandler, DurableTasks, type DurableTaskResult } from './durable-task-runner.js'
import { DurableTaskStore, TaskStoreRoot } from './durable-task-store.js'
import { durableTaskSchema, type DurableTask } from './durable-tasks.js'
import { ActionNotConfigured, ActionNotVisible, CallerRefused, ChecksTargetUnknown, DurableActionUnsupported, TaskNotFound } from './errors.js'
import { ChecksHost, Executables } from './host-promise.js'
import { ProcessRunner } from './managed-process.js'
import { ProjectChecksActivityModel } from './receipt-activity.js'
import { ReceiptStore } from './receipt-store.js'
import { ReceiptViewModel } from './receipt-view.js'
import { storedReceiptSchema, type StoredReceipt } from './store.js'

const PACKAGE_NAME = '@dshfiles/project-checks'

const decodeTask = Schema.decodeUnknownEffect(durableTaskSchema)
const decodeReceipt = Schema.decodeUnknownEffect(storedReceiptSchema)

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

const durableResultOf = (receipt: StoredReceipt): DurableTaskResult => {
  if (receipt.failure === 'process-group-failed') return { status: 'unknown', exitCode: receipt.exitCode }
  return { status: receipt.status === 'passed' ? 'succeeded' : receipt.status, exitCode: receipt.exitCode }
}

const unknownResult: DurableTaskResult = { status: 'unknown', exitCode: null }

/** Durable tasks run configured local actions; a task whose action changed since dispatch is no longer runnable. */
const durableTaskHandler = Layer.effect(
  DurableTaskHandler,
  Effect.gen(function* () {
    const host = yield* ChecksHost
    const runner = yield* ActionRunner
    const store = yield* DurableTaskStore
    const unrunnable = { runnable: false, safeReplay: false }

    const validate = Effect.fn('project-checks task validate')(
      function* (task: DurableTask) {
        const action = actionFor((yield* host.config).actions, task.actionId)
        if (Option.isNone(action) || action.value.execution.target !== 'local' || task.handlerVersion !== 1) return unrunnable
        if (task.actionFingerprint !== taskFingerprint(action.value)) return unrunnable
        const paths = yield* runner.paths(task.sessionId, action.value)
        return { runnable: paths.cwd === task.cwd, safeReplay: action.value.replayPolicy === 'read-only' }
      },
      Effect.catch(() => Effect.succeed(unrunnable)),
    )

    const run = Effect.fn('project-checks task attempt')(
      function* (input: Parameters<DurableTaskHandler['Service']['run']>[0]) {
        const action = actionFor((yield* host.config).actions, input.task.actionId)
        if (Option.isNone(action)) return unknownResult
        const receipt = yield* runner.run({
          sessionId: input.task.sessionId,
          action: action.value,
          options: {
            automatic: false,
            attempt: input.task.attempts.at(-1)?.number ?? 1,
            verificationTurn: null,
            verificationStage: 'manual',
            requireRevision: false,
            durableTaskId: input.task.id,
            durableTaskAttemptId: input.attemptId,
            onProgress: input.progress,
          },
        })
        return durableResultOf(receipt)
      },
      Effect.catch(error => Effect.logWarning('Project Checks task attempt failed', error).pipe(Effect.as(unknownResult))),
    )

    return DurableTaskHandler.of({
      newAttemptId: Effect.sync(randomUUID),
      validate,
      findReceipt: (taskId, attemptId) =>
        store.findAttemptReceipt(taskId, attemptId).pipe(
          Effect.flatMap(found => Effect.transposeOption(Option.map(found, decodeReceipt))),
          Effect.map(Option.map(durableResultOf)),
          Effect.orDie,
        ),
      run,
    })
  }),
)

/** The activity timeline backfill and, when any action verifies completion, the turn-stopping gate. */
const listeners = (config: ProjectChecksConfig) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const host = yield* ChecksHost
      const receipts = yield* ReceiptStore
      const completion = yield* CompletionChecks
      yield* host.onBackfill(since =>
        receipts.listAfter(since).pipe(
          Effect.flatMap(found =>
            Effect.forEach(found, receipt => ProjectChecksActivityModel.publish({ receipt, emit: host.emitActivity }), { discard: true }),
          ),
          Effect.ignore,
        ),
      )
      if (config.actions.some(action => action.verifyBeforeComplete)) yield* host.onTurnStopping(completion.verifyTurn)
    }),
  )

const pluginLayer = (config: ProjectChecksConfig) => {
  const edge = Layer.mergeAll(
    ChecksHost.layer,
    Executables.layer,
    DshChildProcessSpawner.layer,
    StorageDomain.layer,
    nodeFileSystemLayer,
    nodePathLayer,
    TaskStoreRoot.fromDshHome.pipe(Layer.provide(nodePathLayer)),
  )
  return listeners(config).pipe(
    Layer.provideMerge(Layer.mergeAll(DurableTasks.layer, CompletionChecks.layer(config))),
    Layer.provideMerge(durableTaskHandler),
    Layer.provideMerge(ActionRunner.layer),
    Layer.provideMerge(ReceiptStore.layer),
    Layer.provideMerge(Layer.mergeAll(ProcessRunner.layer, DurableTaskStore.layer)),
    Layer.provideMerge(edge),
  )
}

/** The session a check request targets: the named one, else the calling Agent's own session. */
const targetSessionId = (requested: string | undefined, caller: ApiCaller) => {
  if (requested !== undefined) return Effect.succeed(requested)
  if (caller.kind === 'agent' && caller.sessionId !== undefined) return Effect.succeed(caller.sessionId)
  return Effect.fail(new ChecksTargetUnknown())
}

const durableTaskView = (task: DurableTask, actions: ReadonlyArray<ProjectAction>): ProjectChecksTaskView => {
  const attempt = task.attempts.at(-1)
  return {
    id: task.id,
    sessionId: task.sessionId,
    actionId: task.actionId,
    label: Option.match(actionFor(actions, task.actionId), { onNone: () => task.actionId, onSome: action => action.label }),
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

const viewed = (task: DurableTask) => ChecksHost.use(host => host.config).pipe(Effect.map(config => durableTaskView(task, config.actions)))

const ownedTask = Effect.fnUntraced(function* (taskId: string, sessionId: string) {
  const tasks = yield* DurableTasks
  const existing = yield* tasks.get(taskId)
  if (Option.isNone(existing) || existing.value.sessionId !== sessionId) return yield* new TaskNotFound({ taskId })
})

const currentRevision = (sessionId: string, action: ProjectAction) =>
  ActionRunner.use(runner =>
    runner.paths(sessionId, action).pipe(
      Effect.flatMap(paths => runner.sourceRevision(paths.cwd)),
      Effect.catch(() => Effect.succeed(null)),
    ),
  )

const receiptView = ReceiptViewModel.of

const receiptRevision = (receipt: StoredReceipt): string | null =>
  receipt.sourceRevisionAfter === undefined ? receipt.sourceRevision : receipt.sourceRevisionAfter

const handlers = Api.handlers(projectChecksApi, {
  actions: Effect.fn('project-checks actions')(function* (input, call) {
    const sessionId = yield* targetSessionId(input.sessionId, call.caller)
    return yield* ActionRunner.use(runner => runner.visibleActions(sessionId))
  }),
  receipts: Effect.fn('project-checks receipts')(function* (input, call) {
    const sessionId = yield* targetSessionId(input.sessionId, call.caller)
    const stored = yield* ReceiptStore.use(store => store.list(sessionId))
    const config = yield* ChecksHost.use(host => host.config)
    const roots = new Map<string, ProjectAction>()
    for (const receipt of stored)
      Option.map(actionFor(config.actions, receipt.actionId), action => (roots.has(action.root) ? undefined : roots.set(action.root, action)))
    const revisions = new Map(
      yield* Effect.forEach(
        [...roots],
        ([root, action]) => Effect.map(currentRevision(sessionId, action), (revision): readonly [string, string | null] => [root, revision]),
        { concurrency: 4 },
      ),
    )
    return stored.map(receipt => {
      const action = actionFor(config.actions, receipt.actionId)
      return receiptView(
        receipt,
        Option.match(action, {
          onNone: () => 'unknown',
          onSome: current => ProjectChecksModel.receiptFreshness(receiptRevision(receipt), revisions.get(current.root) ?? null),
        }),
      )
    })
  }),
  hookEvents: Effect.fn('project-checks hook events')(function* (input, call) {
    const sessionId = yield* targetSessionId(input.sessionId, call.caller)
    return yield* ChecksHost.use(host => host.hookEvents(sessionId))
  }),
  run: Effect.fn('project-checks manual run')(function* (input, call) {
    const sessionId = yield* targetSessionId(input.sessionId, call.caller)
    const runner = yield* ActionRunner
    const config = yield* ChecksHost.use(host => host.config)
    const action = actionFor(config.actions, input.actionId)
    if (Option.isNone(action)) return yield* new ActionNotConfigured({ actionId: input.actionId })
    const visible = yield* runner.visibleActions(sessionId)
    if (!visible.some(candidate => candidate.id === action.value.id)) return yield* new ActionNotVisible({ actionId: input.actionId })
    const receipt = yield* runner.run({
      sessionId,
      action: action.value,
      options: { automatic: false, attempt: 0, verificationTurn: null, verificationStage: 'manual', requireRevision: false },
    })
    return receiptView(receipt, ProjectChecksModel.receiptFreshness(receiptRevision(receipt), yield* currentRevision(sessionId, action.value)))
  }),
  dispatch: Effect.fn('project-checks dispatch')(function* (input, call) {
    const sessionId = yield* targetSessionId(input.sessionId, call.caller)
    const config = yield* ChecksHost.use(host => host.config)
    const action = actionFor(config.actions, input.actionId)
    if (Option.isNone(action) || action.value.execution.target !== 'local') return yield* new DurableActionUnsupported({ actionId: input.actionId })
    const paths = yield* ActionRunner.use(runner => runner.paths(sessionId, action.value))
    const now = yield* Clock.currentTimeMillis
    const task = yield* decodeTask({
      id: createHash('sha256').update(`${sessionId}\0${input.idempotencyKey}`).digest('hex'),
      idempotencyKey: input.idempotencyKey,
      sessionId,
      actionId: input.actionId,
      handlerVersion: 1,
      actionFingerprint: taskFingerprint(action.value),
      cwd: paths.cwd,
      status: 'queued',
      attempts: [],
      createdAt: now,
      updatedAt: now,
      errorCode: null,
    }).pipe(Effect.orDie)
    const stored = yield* DurableTasks.use(tasks => tasks.enqueue(task))
    return durableTaskView(stored, config.actions)
  }),
  tasks: Effect.fn('project-checks tasks')(function* (input, call) {
    const sessionId = yield* targetSessionId(input.sessionId, call.caller)
    const config = yield* ChecksHost.use(host => host.config)
    const listed = yield* DurableTasks.use(tasks => tasks.list(sessionId))
    return listed.map(task => durableTaskView(task, config.actions))
  }),
  cancelTask: Effect.fn('project-checks cancel task')(function* (input, call) {
    const sessionId = yield* targetSessionId(input.sessionId, call.caller)
    yield* ownedTask(input.taskId, sessionId)
    return yield* viewed(yield* DurableTasks.use(tasks => tasks.cancel(input.taskId)))
  }),
  retryTask: Effect.fn('project-checks retry task')(function* (input, call) {
    const sessionId = yield* targetSessionId(input.sessionId, call.caller)
    yield* ownedTask(input.taskId, sessionId)
    return yield* viewed(yield* DurableTasks.use(tasks => tasks.retry({ taskId: input.taskId, confirmPossibleDuplicate: input.confirmPossibleDuplicate })))
  }),
  assertVerifiedCompletion: Effect.fn('project-checks assert verified completion')(function* (input, call) {
    if (!mayVerifyCandidate(call.caller)) return yield* new CallerRefused({ method: 'assertVerifiedCompletion' })
    const authorized = yield* CompletionChecks.use(checks => checks.isAuthorized(input))
    const status: 'authorized' | 'unavailable' = authorized ? 'authorized' : 'unavailable'
    return { status }
  }),
  verifyCandidate: Effect.fn('project-checks verify candidate')(function* (input, call) {
    if (!mayVerifyCandidate(call.caller)) return yield* new CallerRefused({ method: 'verifyCandidate' })
    return yield* CompletionChecks.use(checks => checks.verifyCandidate(input))
  }),
})

export default DshxPlugin.make({
  name: PACKAGE_NAME,
  Config: projectChecksConfigSchema,
  inject: ['agents', 'configEditor', 'sessionQuery', 'storageDomain', 'subprocess'],
  layer: pluginLayer,
  apis: [Api.bind(projectChecksApi, handlers)],
})
