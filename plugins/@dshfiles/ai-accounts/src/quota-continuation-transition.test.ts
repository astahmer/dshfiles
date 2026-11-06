import { describe, expect, it } from 'vitest'
import type { QuotaContinuationRecord } from './quota-continuation-model.js'
import { isActive, transition, type QuotaContinuationEvent } from './quota-continuation-transition.js'

const record = (state: QuotaContinuationRecord['state']): QuotaContinuationRecord => ({
  continuationId: '9f1f3c9e-6d0c-4c1e-9e0e-1f0a1d5b9a11',
  sessionId: 'session-quota',
  accountId: 'account-claude',
  failedSeq: 12,
  failedAt: 1_800_000_000_000,
  resetAt: 1_800_000_600_000,
  autoRetry: true,
  autoRetrySource: 'user',
  snoozedUntil: null,
  scheduleId: 'quota-1',
  queueSource: null,
  state,
})

const events: readonly QuotaContinuationEvent[] = [
  { kind: 'queued', queueSource: 'manual' },
  { kind: 'queued', queueSource: 'schedule' },
  { kind: 'ranInHistory' },
  { kind: 'newerWork' },
  { kind: 'notReady' },
  { kind: 'dropped' },
]

describe('quota continuation transition', () => {
  it('queues a waiting recovery and clears its Schedule task', () => {
    expect(transition(record('waiting'), { kind: 'queued', queueSource: 'manual' })).toMatchObject({
      state: 'queued',
      scheduleId: null,
      queueSource: 'manual',
    })
  })

  it('sends a recovery whose queue entry disappeared back to waiting', () => {
    expect(transition({ ...record('queued'), queueSource: 'manual' }, { kind: 'notReady' })).toMatchObject({
      state: 'waiting',
      scheduleId: null,
      queueSource: null,
    })
  })

  it.each(['waiting', 'queued'] as const)('completes a %s recovery that ran in the Session history', state => {
    expect(transition(record(state), { kind: 'ranInHistory' })).toMatchObject({ state: 'completed', scheduleId: null, queueSource: null })
  })

  it.each(['waiting', 'queued'] as const)('invalidates a %s recovery once newer work or a dismissal arrives', state => {
    expect(transition(record(state), { kind: 'newerWork' })).toMatchObject({ state: 'invalidated', scheduleId: null, queueSource: null })
    expect(transition(record(state), { kind: 'dropped' })).toMatchObject({ state: 'invalidated', scheduleId: null, queueSource: null })
  })

  it.each(['completed', 'invalidated'] as const)('ignores every event on a %s recovery, so a stale read cannot revive it', state => {
    const retired = { ...record(state), scheduleId: null, queueSource: null }
    for (const event of events) expect(transition(retired, event)).toEqual(retired)
    expect(isActive(retired)).toBe(false)
  })

  it.each(['waiting', 'queued'] as const)('keeps a %s recovery active until a terminal event', state => {
    expect(isActive(record(state))).toBe(true)
  })
})
