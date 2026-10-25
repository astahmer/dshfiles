import { appendFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { DurableTaskRunner } from '../durable-task-runner.ts'
import { DurableTaskStore } from '../durable-task-store.ts'

const [root, markerPath, mode] = process.argv.slice(2)
if (root === undefined || markerPath === undefined || mode === undefined) throw new Error('Worker arguments are incomplete.')

const store = await DurableTaskStore.open({ root })
const task = {
  id: 'a'.repeat(64),
  idempotencyKey: '00000000-0000-4000-8000-000000000001',
  sessionId: 'process-race-session',
  actionId: 'test',
  handlerVersion: 1,
  actionFingerprint: 'b'.repeat(64),
  cwd: '/tmp/project',
  status: 'queued',
  attempts: [],
  createdAt: 1,
  updatedAt: 1,
  errorCode: null,
}
const runner = new DurableTaskRunner({
  table: store,
  newAttemptId: () => '00000000-0000-4000-8000-000000000002',
  validate: async () => ({ runnable: true, safeReplay: false }),
  findReceipt: async () => null,
  run: async ({ attemptId, signal }) => {
    await appendFile(markerPath, 'effect\n')
    if (mode === 'cancelable') {
      process.stdout.write('started\n')
      return new Promise(resolve => {
        signal.addEventListener('abort', () => resolve({ status: 'cancelled', exitCode: null }), { once: true })
      })
    }
    if (mode === 'crash-after-effect') process.kill(process.pid, 'SIGKILL')
    if (mode === 'crash-after-receipt') {
      await store.saveAttemptReceipt({
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
    await delay(250)
    return { status: 'succeeded', exitCode: 0 }
  },
  onFailure: error => {
    console.error(error instanceof Error ? error.message : 'worker failed')
  },
})

if (mode === 'recover') await runner.recover()
else await runner.enqueue(task)
await runner.waitForIdle()
await runner.close()
store.close()
