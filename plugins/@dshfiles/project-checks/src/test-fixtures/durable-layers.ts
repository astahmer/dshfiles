import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { layer as nodePathLayer } from '@effect/platform-node/NodePath'
import { Effect, Layer, Option, Schema } from 'effect'
import { DurableTaskHandler, DurableTasks, type DurableTaskResult } from '../durable-task-runner.ts'
import { DurableTaskStore, TaskStoreRoot } from '../durable-task-store.ts'
import { durableTaskSchema, type DurableTask } from '../durable-tasks.ts'

type Handler = DurableTaskHandler['Service']

/** The real SQLite task store under `root`, as every Host opens it. */
const storeLayer = (root: string) =>
  DurableTaskStore.layer.pipe(Layer.provide(TaskStoreRoot.layer(root)), Layer.provide(Layer.mergeAll(nodeFileSystemLayer, nodePathLayer)))

const succeeded: DurableTaskResult = { status: 'succeeded', exitCode: 0 }

const handlerLayer = (handler: Partial<Handler> & { readonly attemptIds?: () => string }) =>
  Layer.succeed(
    DurableTaskHandler,
    DurableTaskHandler.of({
      newAttemptId: handler.newAttemptId ?? Effect.sync(handler.attemptIds ?? (() => crypto.randomUUID())),
      validate: handler.validate ?? (() => Effect.succeed({ runnable: true, safeReplay: false })),
      findReceipt: handler.findReceipt ?? (() => Effect.succeedNone),
      run: handler.run ?? (() => Effect.succeed(succeeded)),
    }),
  )

/** A durable queue over the real store under `root`, running `handler`. */
const tasksLayer = (root: string, handler: Partial<Handler> & { readonly attemptIds?: () => string } = {}) =>
  DurableTasks.layer.pipe(Layer.provide(handlerLayer(handler)), Layer.provideMerge(storeLayer(root)))

const queuedTask = (input: { readonly id: string; readonly idempotencyKey: string; readonly sessionId: string; readonly createdAt: number }): DurableTask =>
  Schema.decodeUnknownSync(durableTaskSchema)({
    id: input.id,
    idempotencyKey: input.idempotencyKey,
    sessionId: input.sessionId,
    actionId: 'test',
    handlerVersion: 1,
    actionFingerprint: 'b'.repeat(64),
    cwd: '/tmp/project',
    status: 'queued',
    attempts: [],
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    errorCode: null,
  })

const taskStatus = (taskId: string) =>
  DurableTaskStore.use(store => store.get(taskId)).pipe(Effect.map(task => Option.getOrUndefined(Option.map(task, current => current.status))))

/** Real-store layers and seeds the durable queue tests share, including the cross-process worker fixture. */
export class DurableTestLayers {
  static readonly store = storeLayer
  static readonly handler = handlerLayer
  static readonly tasks = tasksLayer
  static readonly queuedTask = queuedTask
  static readonly taskStatus = taskStatus
}
