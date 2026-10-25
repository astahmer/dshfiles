import { describe, expect, it } from 'vitest'
import { DurableTaskModel, durableTaskSchema, type DurableTask } from './durable-tasks.js'

const queuedTask = (): DurableTask =>
  durableTaskSchema.parse({
    id: 'a'.repeat(64),
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

const firstAttemptId = '00000000-0000-4000-8000-000000000002'

describe('durable Project Checks task transitions', () => {
  it('persists an attempt before effects and leaves an interrupted attempt unknown', () => {
    const running = DurableTaskModel.begin(queuedTask(), { attemptId: firstAttemptId, now: 2 })
    const interrupted = DurableTaskModel.unknown(running, 3)

    expect(interrupted.status).toBe('unknown')
    expect(interrupted.attempts[0]).toMatchObject({ id: firstAttemptId, status: 'unknown', startedAt: 2, finishedAt: 3 })
  })

  it('retries only after a new attempt is queued and rejects stale completion', () => {
    const running = DurableTaskModel.begin(queuedTask(), { attemptId: firstAttemptId, now: 2 })
    const retried = DurableTaskModel.retry(DurableTaskModel.unknown(running, 3), 4)
    const secondAttemptId = '00000000-0000-4000-8000-000000000003'
    const secondAttempt = DurableTaskModel.begin(retried, { attemptId: secondAttemptId, now: 5 })
    const staleFinish = DurableTaskModel.finish(secondAttempt, {
      attemptId: firstAttemptId,
      status: 'succeeded',
      exitCode: 0,
      now: 6,
    })

    expect(staleFinish).toEqual(secondAttempt)
    expect(secondAttempt.attempts.map(attempt => attempt.id)).toEqual([firstAttemptId, secondAttemptId])
  })

  it('cancels queued work before any attempt and requires settlement for running work', () => {
    const cancelledBeforeStart = DurableTaskModel.cancel(queuedTask(), 2)
    const running = DurableTaskModel.begin(queuedTask(), { attemptId: firstAttemptId, now: 2 })
    const cancelRequested = DurableTaskModel.cancel(running, 3)
    const cancelled = DurableTaskModel.finish(cancelRequested, {
      attemptId: firstAttemptId,
      status: 'cancelled',
      exitCode: null,
      now: 4,
    })

    expect(cancelledBeforeStart).toMatchObject({ status: 'cancelled', attempts: [] })
    expect(cancelRequested.status).toBe('cancel-requested')
    expect(cancelled.status).toBe('cancelled')
  })
})
