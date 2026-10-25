import { describe, expect, it } from 'vitest'
import { DurableTaskModel, durableTaskSchema, type DurableTask } from './durable-tasks.js'
import { DurableTaskRunner, type DurableTaskResult, type DurableTaskTable } from './durable-task-runner.js'

const taskId = 'a'.repeat(64)
const firstAttemptId = '00000000-0000-4000-8000-000000000002'
const nextAttemptId = '00000000-0000-4000-8000-000000000003'

const queuedTask = (): DurableTask =>
  durableTaskSchema.parse({
    id: taskId,
    idempotencyKey: '00000000-0000-4000-8000-000000000001',
    sessionId: 'session-a',
    actionId: 'test',
    handlerVersion: 1,
    actionFingerprint: 'b'.repeat(64),
    cwd: '/work/project',
    status: 'queued',
    attempts: [],
    createdAt: 1,
    updatedAt: 1,
    errorCode: null,
  })

const makeTable = (): DurableTaskTable => {
  const rows = new Map<string, DurableTask>()
  return {
    get: key => rows.get(key),
    entries: () => rows.entries(),
    keys: () => rows.keys(),
    get size() {
      return rows.size
    },
    createIfAbsent: async task => {
      const existing = rows.get(task.id)
      if (existing !== undefined) return existing
      rows.set(task.id, task)
      return task
    },
    withWorkerClaim: async (_signal, work) => work(),
    put: async (key, value) => {
      rows.set(key, value)
    },
    update: async (key, update) => {
      const current = rows.get(key)
      if (current === undefined) throw new Error('missing row')
      const next = update(current)
      rows.set(key, next)
      return next
    },
    delete: async key => rows.delete(key),
  }
}

const makeRunner = (input: {
  readonly table: DurableTaskTable
  readonly safeReplay?: boolean
  readonly run?: (task: DurableTask, signal: AbortSignal) => Promise<DurableTaskResult>
  readonly findReceipt?: (taskId: string, attemptId: string) => Promise<DurableTaskResult | null>
}): DurableTaskRunner => {
  let nextId = input.table.get(taskId)?.attempts.length ?? 0
  return new DurableTaskRunner({
    table: input.table,
    newAttemptId: () => (nextId++ === 0 ? firstAttemptId : nextAttemptId),
    validate: async () => ({ runnable: true, safeReplay: input.safeReplay ?? false }),
    findReceipt: input.findReceipt ?? (async () => null),
    run: async ({ task, signal }) => (input.run === undefined ? { status: 'succeeded', exitCode: 0 } : input.run(task, signal)),
    onFailure: error => {
      throw error
    },
  })
}

const interruptedTask = (): DurableTask => DurableTaskModel.begin(queuedTask(), { attemptId: firstAttemptId, now: 2 })

describe('durable Project Checks task runner', () => {
  it('deduplicates concurrent dispatches in the owning Host process', async () => {
    const table = makeTable()
    let release: () => void = () => undefined
    const running = new Promise<void>(resolve => {
      release = resolve
    })
    let executions = 0
    const runner = makeRunner({
      table,
      run: async () => {
        executions += 1
        await running
        return { status: 'succeeded', exitCode: 0 }
      },
    })

    const [first, duplicate] = await Promise.all([runner.enqueue(queuedTask()), runner.enqueue(queuedTask())])
    expect(first.id).toBe(duplicate.id)
    release()
    await runner.waitForIdle()

    expect(executions).toBe(1)
    expect(runner.get(taskId)).toMatchObject({ status: 'succeeded', attempts: [{ number: 1, status: 'succeeded' }] })
  })

  it('leaves an interrupted side effect unknown and does not replay it by default', async () => {
    const table = makeTable()
    await table.put(taskId, interruptedTask())
    let previousEffectCount = 1
    let executions = 0
    const runner = makeRunner({
      table,
      run: async () => {
        executions += 1
        previousEffectCount += 1
        return { status: 'succeeded', exitCode: 0 }
      },
    })

    await runner.recover()

    expect(runner.get(taskId)).toMatchObject({ status: 'unknown', attempts: [{ status: 'unknown' }] })
    expect(executions).toBe(0)
    expect(previousEffectCount).toBe(1)
  })

  it('does not replay a crash-interrupted task after cancellation was requested', async () => {
    const table = makeTable()
    await table.put(taskId, DurableTaskModel.cancel(interruptedTask(), 3))
    let executions = 0
    const runner = makeRunner({
      table,
      safeReplay: true,
      run: async () => {
        executions += 1
        return { status: 'succeeded', exitCode: 0 }
      },
    })

    await runner.recover()
    await runner.waitForIdle()

    expect(runner.get(taskId)).toMatchObject({ status: 'unknown', attempts: [{ status: 'unknown' }] })
    expect(executions).toBe(0)
  })

  it('retries an interrupted action only when its profile policy declares read-only', async () => {
    const table = makeTable()
    await table.put(taskId, interruptedTask())
    const runner = makeRunner({ table, safeReplay: true })

    await runner.recover()
    await runner.waitForIdle()

    expect(runner.get(taskId)).toMatchObject({ status: 'succeeded', attempts: [{ id: firstAttemptId }, { id: nextAttemptId, status: 'succeeded' }] })
  })

  it('requires explicit duplicate-effect acknowledgement and records a new attempt identity', async () => {
    const table = makeTable()
    await table.put(taskId, DurableTaskModel.unknown(interruptedTask(), 3))
    const runner = makeRunner({ table })

    await expect(runner.retry(taskId, false)).rejects.toThrow(/Confirm possible duplicate effects/u)
    await runner.retry(taskId, true)
    await runner.waitForIdle()

    expect(runner.get(taskId)?.attempts.map(attempt => attempt.id)).toEqual([firstAttemptId, nextAttemptId])
  })

  it('cancels a running process through its signal and records its confirmed result', async () => {
    const table = makeTable()
    let started: () => void = () => undefined
    const runStarted = new Promise<void>(resolve => {
      started = resolve
    })
    const runner = makeRunner({
      table,
      run: async (_task, signal) => {
        started()
        return new Promise(resolve => {
          signal.addEventListener('abort', () => resolve({ status: 'cancelled', exitCode: null }), { once: true })
        })
      },
    })
    await runner.enqueue(queuedTask())
    await runStarted
    const cancel = await runner.cancel(taskId)
    await runner.waitForIdle()

    expect(cancel.status).toBe('cancel-requested')
    expect(runner.get(taskId)?.status).toBe('cancelled')
  })
})
