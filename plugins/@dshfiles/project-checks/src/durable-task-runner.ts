import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Cause, Clock, Context, Effect, Exit, Fiber, FiberMap, Layer, Option, Queue, Ref, Schedule, Semaphore, Stream, SubscriptionRef } from 'effect'
import { DurableTaskStore } from './durable-task-store.ts'
import { DurableTaskModel, type DurableTask } from './durable-tasks.ts'
import {
  HandlerUnavailable,
  IdempotencyKeyConflict,
  RetryNotAllowed,
  RetryNotConfirmed,
  TaskHistoryFull,
  TaskNotFound,
  TasksStopping,
  TaskStoreUnavailable,
} from './errors.ts'

export type DurableTaskResult = { readonly status: 'succeeded' | 'failed' | 'cancelled' | 'timed-out' | 'unknown'; readonly exitCode: number | null }

export interface TaskValidation {
  readonly runnable: boolean
  readonly safeReplay: boolean
}

type Progress = DurableTask['attempts'][number]['progress']

const CANCEL_POLL = Schedule.spaced('200 millis')
const MAX_LISTED_TASKS = 100
const RECOVERABLE = new Set<DurableTask['status']>(['queued', 'running', 'cancel-requested', 'unknown'])

/** What a durable task does: the plugin runs a configured action; tests run a plain effect. Interruption cancels `run`. */
export class DurableTaskHandler extends Context.Service<
  DurableTaskHandler,
  {
    readonly newAttemptId: Effect.Effect<string>
    readonly validate: (task: DurableTask) => Effect.Effect<TaskValidation>
    readonly findReceipt: (taskId: string, attemptId: string) => Effect.Effect<Option.Option<DurableTaskResult>>
    readonly run: (input: {
      readonly task: DurableTask
      readonly attemptId: string
      readonly progress: (progress: Progress) => Effect.Effect<void>
    }) => Effect.Effect<DurableTaskResult>
  }
>()('@dshfiles/project-checks/DurableTaskHandler') {}

/**
 * The durable Project Checks queue: one worker fiber takes task ids from a `Queue` and runs one at a time under the
 * cross-process worker claim. Each running attempt lives in a `FiberMap`, so a cancel interrupts it (and its scoped
 * process); a cancel written by another Host reaches it through a 200 ms poll of the store.
 */
export class DurableTasks extends Context.Service<
  DurableTasks,
  {
    readonly enqueue: (task: DurableTask) => Effect.Effect<DurableTask, TasksStopping | IdempotencyKeyConflict | TaskHistoryFull | TaskStoreUnavailable>
    readonly get: (taskId: string) => Effect.Effect<Option.Option<DurableTask>, TaskStoreUnavailable>
    readonly list: (sessionId: string) => Effect.Effect<ReadonlyArray<DurableTask>, TaskStoreUnavailable>
    readonly cancel: (taskId: string) => Effect.Effect<DurableTask, TaskNotFound | TaskStoreUnavailable>
    readonly retry: (input: {
      readonly taskId: string
      readonly confirmPossibleDuplicate: boolean
    }) => Effect.Effect<DurableTask, TasksStopping | RetryNotConfirmed | HandlerUnavailable | RetryNotAllowed | TaskNotFound | TaskStoreUnavailable>
    /** Completes once every admitted task has settled. */
    readonly awaitIdle: Effect.Effect<void>
  }
>()('@dshfiles/project-checks/DurableTasks') {
  static readonly layer = Layer.effect(
    DurableTasks,
    Effect.gen(function* () {
      const store = yield* DurableTaskStore
      const handler = yield* DurableTaskHandler
      const queue = yield* Queue.unbounded<string>()
      const running = yield* FiberMap.make<string, DurableTaskResult>()
      const admission = yield* Semaphore.make(1)
      const outstanding = yield* SubscriptionRef.make(0)
      const stopping = yield* Ref.make(false)

      const updateNow = (taskId: string, change: (current: DurableTask, now: number) => DurableTask) =>
        Effect.flatMap(Clock.currentTimeMillis, now => store.update(taskId, current => change(current, now)))

      const launch = Effect.fnUntraced(function* (taskId: string) {
        if (yield* Ref.get(stopping)) return
        yield* SubscriptionRef.update(outstanding, count => count + 1)
        yield* Queue.offer(queue, taskId)
      })

      const failIfStopping = Effect.flatMap(Ref.get(stopping), isStopping => (isStopping ? Effect.fail(new TasksStopping()) : Effect.void))

      const watchCancellation = (taskId: string) =>
        store.get(taskId).pipe(
          Effect.map(task => Option.exists(task, current => current.status === 'cancel-requested')),
          Effect.repeat({ schedule: CANCEL_POLL, until: requested => requested }),
          Effect.catchCause(cause => Effect.logWarning('Project Checks cancellation state became unavailable', cause)),
          Effect.andThen(FiberMap.remove(running, taskId)),
        )

      const settleAttempt = Effect.fnUntraced(function* (taskId: string, attemptId: string, exit: Exit.Exit<DurableTaskResult>) {
        if (Exit.isSuccess(exit)) {
          const result = exit.value
          yield* updateNow(taskId, (current, now) =>
            result.status === 'unknown'
              ? DurableTaskModel.unknown(current, now)
              : DurableTaskModel.finish(current, { attemptId, status: result.status, exitCode: result.exitCode, now }),
          )
          return
        }
        if (!Cause.hasInterruptsOnly(exit.cause)) {
          yield* Effect.logError('Project Checks task attempt failed', exit.cause)
          yield* updateNow(taskId, DurableTaskModel.unknown)
          return
        }
        yield* updateNow(taskId, (current, now) =>
          current.status === 'cancel-requested'
            ? DurableTaskModel.finish(current, { attemptId, status: 'cancelled', exitCode: null, now })
            : DurableTaskModel.unknown(current, now),
        )
      })

      const runAttempt = Effect.fnUntraced(function* (task: DurableTask, attemptId: string) {
        const progress = (value: Progress) =>
          updateNow(task.id, (current, now) => DurableTaskModel.progress(current, { attemptId, progress: value, now })).pipe(Effect.orDie, Effect.asVoid)
        const attempt = yield* FiberMap.run(running, task.id, handler.run({ task, attemptId, progress }))
        yield* Effect.forkScoped(watchCancellation(task.id))
        const exit = yield* Fiber.await(attempt)
        yield* settleAttempt(task.id, attemptId, exit)
      }, Effect.scoped)

      const recordInterruptedOwner = Effect.fnUntraced(function* (task: DurableTask) {
        const cancellationWasRequested = task.status === 'cancel-requested'
        const interrupted = yield* updateNow(task.id, DurableTaskModel.unknown)
        const attempt = interrupted.attempts.at(-1)
        if (attempt === undefined) return { task: interrupted, cancellationWasRequested }
        const receipt = yield* handler.findReceipt(task.id, attempt.id)
        if (Option.isNone(receipt) || receipt.value.status === 'unknown') return { task: interrupted, cancellationWasRequested }
        const status = receipt.value.status
        const reconciled = yield* updateNow(task.id, (current, now) =>
          DurableTaskModel.reconcile(current, { attemptId: attempt.id, status, exitCode: receipt.value.exitCode, now }),
        )
        return { task: reconciled, cancellationWasRequested }
      })

      const runClaimedTask = Effect.fn('project-checks task run')(function* (taskId: string) {
        const stored = yield* store.get(taskId)
        if (Option.isNone(stored) || DurableTaskModel.isTerminal(stored.value.status)) return
        let task = stored.value
        let cancellationWasRequested = false
        if (task.status === 'running' || task.status === 'cancel-requested') {
          const recovered = yield* recordInterruptedOwner(task)
          task = recovered.task
          cancellationWasRequested = recovered.cancellationWasRequested
        }
        if (task.status === 'unknown') {
          const validation = yield* handler.validate(task)
          if (!validation.runnable) {
            yield* updateNow(taskId, (current, now) => DurableTaskModel.block(current, { errorCode: 'handler-unavailable', now }))
            return
          }
          if (!validation.safeReplay || cancellationWasRequested) return
          task = yield* updateNow(taskId, DurableTaskModel.retry)
        }
        if (task.status !== 'queued') return
        const validation = yield* handler.validate(task)
        if (!validation.runnable) {
          yield* updateNow(taskId, (current, now) => DurableTaskModel.block(current, { errorCode: 'handler-unavailable', now }))
          return
        }
        const attemptId = yield* handler.newAttemptId
        task = yield* updateNow(taskId, (current, now) => DurableTaskModel.begin(current, { attemptId, now }))
        if (task.status !== 'running') return
        if (yield* Ref.get(stopping)) {
          yield* updateNow(taskId, DurableTaskModel.unknown)
          return
        }
        yield* runAttempt(task, attemptId).pipe(
          Effect.onInterrupt(() =>
            updateNow(taskId, DurableTaskModel.unknown).pipe(Effect.andThen(FiberMap.remove(running, taskId)), Effect.ignore({ log: 'Warn' })),
          ),
        )
      })

      const runTask = (taskId: string) =>
        Effect.scoped(Effect.andThen(store.claimWorker, runClaimedTask(taskId))).pipe(
          Effect.catchCause(cause => (Cause.hasInterruptsOnly(cause) ? Effect.interrupt : Effect.logError('Project Checks task failed', cause))),
          Effect.ensuring(SubscriptionRef.update(outstanding, count => Math.max(0, count - 1))),
        )

      yield* DshxPlugin.worker(Effect.forever(Effect.flatMap(Queue.take(queue), runTask)))
      yield* Effect.addFinalizer(() => Ref.set(stopping, true))

      for (const task of yield* store.all) if (RECOVERABLE.has(task.status)) yield* launch(task.id)

      const enqueue = Effect.fn('project-checks task enqueue')(function* (task: DurableTask) {
        return yield* admission.withPermit(
          Effect.gen(function* () {
            yield* failIfStopping
            const stored = yield* store.createIfAbsent({ task })
            if (stored.sessionId !== task.sessionId || stored.actionId !== task.actionId || stored.actionFingerprint !== task.actionFingerprint)
              return yield* new IdempotencyKeyConflict({ reason: 'other-action' })
            yield* launch(task.id)
            return stored
          }),
        )
      })

      const list = Effect.fn('project-checks tasks list')(function* (sessionId: string) {
        const tasks = yield* store.listForSession({ sessionId, limit: MAX_LISTED_TASKS })
        return tasks.toSorted((left, right) => right.createdAt - left.createdAt || left.id.localeCompare(right.id))
      })

      const cancel = Effect.fn('project-checks task cancel')(function* (taskId: string) {
        const task = yield* updateNow(taskId, DurableTaskModel.cancel)
        if (task.status === 'cancel-requested' || task.status === 'cancelled') yield* FiberMap.remove(running, taskId)
        return task
      })

      const retry = Effect.fn('project-checks task retry')(function* (input: { readonly taskId: string; readonly confirmPossibleDuplicate: boolean }) {
        return yield* admission.withPermit(
          Effect.gen(function* () {
            yield* failIfStopping
            if (!input.confirmPossibleDuplicate) return yield* new RetryNotConfirmed()
            const current = yield* store.get(input.taskId)
            if (Option.isNone(current)) return yield* new TaskNotFound({ taskId: input.taskId })
            const validation = yield* handler.validate(current.value)
            if (!validation.runnable) return yield* new HandlerUnavailable({ taskId: input.taskId })
            const status = current.value.status
            if (!DurableTaskModel.canRetry(status)) return yield* new RetryNotAllowed({ status })
            const task = yield* updateNow(input.taskId, DurableTaskModel.retry)
            yield* launch(input.taskId)
            return task
          }),
        )
      })

      const awaitIdle = SubscriptionRef.changes(outstanding).pipe(
        Stream.filter(count => count === 0),
        Stream.take(1),
        Stream.runDrain,
      )

      return DurableTasks.of({ enqueue, get: store.get, list, cancel, retry, awaitIdle })
    }),
  )
}
