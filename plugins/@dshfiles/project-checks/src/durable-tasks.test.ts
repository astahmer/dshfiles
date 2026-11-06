import { describe, expect, it } from 'vitest'
import { Schema } from 'effect'
import { DurableTaskModel, durableTaskSchema, type DurableTask } from './durable-tasks.js'

const queuedTask = (): DurableTask =>
  Schema.decodeUnknownSync(durableTaskSchema)({
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

describe('durable Project Checks task verb table', () => {
  const statuses = ['queued', 'running', 'cancel-requested', 'succeeded', 'failed', 'cancelled', 'timed-out', 'unknown', 'blocked'] as const
  const withStatus = (status: (typeof statuses)[number]): DurableTask =>
    Schema.decodeUnknownSync(durableTaskSchema)({ ...DurableTaskModel.begin(queuedTask(), { attemptId: firstAttemptId, now: 2 }), status })

  it('refuses a verb from a status it does not apply to, leaving the task untouched', () => {
    for (const status of statuses) {
      const task = withStatus(status)
      const terminal = DurableTaskModel.isTerminal(status)
      expect(DurableTaskModel.retry(task, 9) === task).toBe(!DurableTaskModel.canRetry(status))
      expect(DurableTaskModel.block(task, { errorCode: 'handler-unavailable', now: 9 }) === task).toBe(terminal)
      expect(DurableTaskModel.cancel(task, 9) === task).toBe(status !== 'queued' && status !== 'running')
    }
  })

  it('names the statuses a caller may retry before it writes anything', () => {
    expect(statuses.filter(status => DurableTaskModel.canRetry(status))).toEqual(['failed', 'cancelled', 'timed-out', 'unknown'])
    expect(statuses.filter(status => DurableTaskModel.isTerminal(status))).toEqual(['succeeded', 'failed', 'cancelled', 'timed-out', 'blocked'])
  })
})
