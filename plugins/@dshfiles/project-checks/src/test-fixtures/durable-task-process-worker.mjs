import { appendFile } from 'node:fs/promises'
import { Context, Effect, Layer } from 'effect'
import { DurableTasks } from '../durable-task-runner.ts'
import { DurableTaskStore } from '../durable-task-store.ts'
import { DurableTestLayers } from './durable-layers.ts'

const { queuedTask, store: storeLayer, tasks: tasksLayer } = DurableTestLayers

const [root, markerPath, mode] = process.argv.slice(2)
if (root === undefined || markerPath === undefined || mode === undefined) throw new Error('Worker arguments are incomplete.')

const task = queuedTask({ id: 'a'.repeat(64), idempotencyKey: '00000000-0000-4000-8000-000000000001', sessionId: 'process-race-session', createdAt: 1 })

const program = Effect.gen(function* () {
  const receipts = Context.get(yield* Layer.build(storeLayer(root)), DurableTaskStore)
  const run = ({ attemptId }) =>
    Effect.gen(function* () {
      yield* Effect.promise(() => appendFile(markerPath, 'effect\n'))
      if (mode === 'cancelable') {
        process.stdout.write('started\n')
        return yield* Effect.never
      }
      if (mode === 'crash-after-effect') process.kill(process.pid, 'SIGKILL')
      if (mode === 'crash-after-receipt') {
        yield* receipts.saveAttemptReceipt({
          id: '00000000-0000-4000-8000-000000000004',
          taskId: task.id,
          taskAttemptId: attemptId,
          sessionId: task.sessionId,
          actionId: task.actionId,
          label: 'Test action',
          status: 'passed',
          failure: null,
          startedAt: Date.now(),
          finishedAt: Date.now() + 1,
          durationMs: 1,
          exitCode: 0,
          sourceRevision: null,
          verificationTurn: null,
          automatic: false,
          attempt: 1,
        })
        process.kill(process.pid, 'SIGKILL')
      }
      yield* Effect.sleep('250 millis')
      return { status: 'succeeded', exitCode: 0 }
    })
  const tasks = Context.get(yield* Layer.build(tasksLayer(root, { attemptIds: () => '00000000-0000-4000-8000-000000000002', run })), DurableTasks)
  if (mode !== 'recover') yield* tasks.enqueue(task)
  yield* tasks.awaitIdle
})

await Effect.runPromise(Effect.scoped(program))
