import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from '@effect/vitest'
import { Context, Deferred, Effect, Exit, Layer, Ref, Scope } from 'effect'
import { DurableTasks, type DurableTaskResult } from './durable-task-runner.js'
import { DurableTaskStore } from './durable-task-store.js'
import { DurableTaskModel, type DurableTask } from './durable-tasks.js'
import { DurableTestLayers } from './test-fixtures/durable-layers.js'

const { queuedTask, store: storeLayer, tasks: tasksLayer } = DurableTestLayers

const taskId = 'a'.repeat(64)
const firstAttemptId = '00000000-0000-4000-8000-000000000002'
const nextAttemptId = '00000000-0000-4000-8000-000000000003'

const task = () => queuedTask({ id: taskId, idempotencyKey: '00000000-0000-4000-8000-000000000001', sessionId: 'session-a', createdAt: 1 })
const interruptedTask = (): DurableTask => DurableTaskModel.begin(task(), { attemptId: firstAttemptId, now: 2 })
const succeeded: DurableTaskResult = { status: 'succeeded', exitCode: 0 }

const scratchRoot = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), 'project-checks-runner-'))),
  root => Effect.promise(() => rm(root, { recursive: true, force: true })),
)

/** Writes `rows` straight into a fresh store, the way a crashed Host would have left them. */
const seed = Effect.fnUntraced(function* (root: string, rows: ReadonlyArray<DurableTask>) {
  const scope = yield* Scope.make()
  const store = Context.get(yield* Layer.buildWithScope(storeLayer(root), scope), DurableTaskStore)
  for (const row of rows) {
    yield* store.createIfAbsent({ task: { ...row, status: 'queued', attempts: [] } })
    yield* store.update(row.id, () => row)
  }
  yield* Scope.close(scope, Exit.void)
})

const attemptIds = () => {
  let issued = 0
  return () => (issued++ === 0 ? firstAttemptId : nextAttemptId)
}

const queue = (root: string, handler: Parameters<typeof tasksLayer>[1]) =>
  Effect.map(Layer.build(tasksLayer(root, handler)), services => Context.get(services, DurableTasks))

describe('durable Project Checks task runner', () => {
  it.live('deduplicates concurrent dispatches in the owning Host process', () =>
    Effect.gen(function* () {
      const root = yield* scratchRoot
      const release = yield* Deferred.make<void>()
      const executions = yield* Ref.make(0)
      const tasks = yield* queue(root, {
        attemptIds: attemptIds(),
        run: () => Ref.update(executions, count => count + 1).pipe(Effect.andThen(Deferred.await(release)), Effect.as(succeeded)),
      })
      const [first, duplicate] = yield* Effect.all([tasks.enqueue(task()), tasks.enqueue(task())], { concurrency: 2 })
      expect(first.id).toBe(duplicate.id)
      yield* Deferred.succeed(release, undefined)
      yield* tasks.awaitIdle
      expect(yield* Ref.get(executions)).toBe(1)
      expect(yield* tasks.get(taskId)).toMatchObject({ value: { status: 'succeeded', attempts: [{ number: 1, status: 'succeeded' }] } })
    }).pipe(Effect.scoped),
  )

  it.live('leaves an interrupted side effect unknown and does not replay it by default', () =>
    Effect.gen(function* () {
      const root = yield* scratchRoot
      yield* seed(root, [interruptedTask()])
      const executions = yield* Ref.make(0)
      const tasks = yield* queue(root, { attemptIds: attemptIds(), run: () => Ref.update(executions, count => count + 1).pipe(Effect.as(succeeded)) })
      yield* tasks.awaitIdle
      expect(yield* tasks.get(taskId)).toMatchObject({ value: { status: 'unknown', attempts: [{ status: 'unknown' }] } })
      expect(yield* Ref.get(executions)).toBe(0)
    }).pipe(Effect.scoped),
  )

  it.live('does not replay a crash-interrupted task after cancellation was requested', () =>
    Effect.gen(function* () {
      const root = yield* scratchRoot
      yield* seed(root, [DurableTaskModel.cancel(interruptedTask(), 3)])
      const executions = yield* Ref.make(0)
      const tasks = yield* queue(root, {
        attemptIds: attemptIds(),
        validate: () => Effect.succeed({ runnable: true, safeReplay: true }),
        run: () => Ref.update(executions, count => count + 1).pipe(Effect.as(succeeded)),
      })
      yield* tasks.awaitIdle
      expect(yield* tasks.get(taskId)).toMatchObject({ value: { status: 'unknown', attempts: [{ status: 'unknown' }] } })
      expect(yield* Ref.get(executions)).toBe(0)
    }).pipe(Effect.scoped),
  )

  it.live('retries an interrupted action only when its profile policy declares read-only', () =>
    Effect.gen(function* () {
      const root = yield* scratchRoot
      yield* seed(root, [interruptedTask()])
      const tasks = yield* queue(root, { attemptIds: () => nextAttemptId, validate: () => Effect.succeed({ runnable: true, safeReplay: true }) })
      yield* tasks.awaitIdle
      expect(yield* tasks.get(taskId)).toMatchObject({
        value: { status: 'succeeded', attempts: [{ id: firstAttemptId }, { id: nextAttemptId, status: 'succeeded' }] },
      })
    }).pipe(Effect.scoped),
  )

  it.live('requires explicit duplicate-effect acknowledgement and records a new attempt identity', () =>
    Effect.gen(function* () {
      const root = yield* scratchRoot
      yield* seed(root, [DurableTaskModel.unknown(interruptedTask(), 3)])
      const tasks = yield* queue(root, { attemptIds: () => nextAttemptId })
      yield* tasks.awaitIdle
      const refused = yield* Effect.flip(tasks.retry({ taskId, confirmPossibleDuplicate: false }))
      expect(refused.message).toMatch(/Confirm possible duplicate effects/u)
      yield* tasks.retry({ taskId, confirmPossibleDuplicate: true })
      yield* tasks.awaitIdle
      const retried = yield* tasks.get(taskId)
      expect(retried._tag === 'Some' ? retried.value.attempts.map(attempt => attempt.id) : []).toEqual([firstAttemptId, nextAttemptId])
    }).pipe(Effect.scoped),
  )

  it.live('cancels a running attempt by interrupting it and records the cancellation', () =>
    Effect.gen(function* () {
      const root = yield* scratchRoot
      const started = yield* Deferred.make<void>()
      const tasks = yield* queue(root, { attemptIds: attemptIds(), run: () => Deferred.succeed(started, undefined).pipe(Effect.andThen(Effect.never)) })
      yield* tasks.enqueue(task())
      yield* Deferred.await(started)
      const cancel = yield* tasks.cancel(taskId)
      yield* tasks.awaitIdle
      expect(cancel.status).toBe('cancel-requested')
      expect(yield* tasks.get(taskId)).toMatchObject({ value: { status: 'cancelled' } })
    }).pipe(Effect.scoped),
  )
})
