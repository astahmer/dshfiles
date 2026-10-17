import { describe, expect, it } from 'vitest'
import { UsageLimitRowsModel, type QuotaContinuation } from './usage-limit-rows.js'

const NOW = 1_000_000_000

const continuation = (patch: Partial<QuotaContinuation> = {}): QuotaContinuation => ({
  continuationId: '11111111-1111-4111-8111-111111111111',
  sessionId: 'blocked',
  accountId: 'codex_work',
  failedAt: NOW - 60_000,
  resetAt: NOW + 3_600_000,
  autoRetry: false,
  snoozedUntil: null,
  state: 'waiting',
  scheduled: false,
  ready: false,
  ...patch,
})

const session = (patch: Partial<{ id: string; blank: boolean; running: boolean; displayTitle: string }> = {}) => ({
  id: 'blocked',
  blank: false,
  running: false,
  displayTitle: 'Blocked thread',
  ...patch,
})

const select = (input: {
  readonly sessions?: ReturnType<typeof session>[]
  readonly continuations?: QuotaContinuation[]
  readonly muted?: string[]
  readonly archived?: string[]
}) =>
  UsageLimitRowsModel.select({
    sessions: input.sessions ?? [session()],
    continuations: input.continuations ?? [continuation()],
    mutedSessionIds: new Set(input.muted ?? []),
    archivedSessionIds: new Set(input.archived ?? []),
    matchesWorkspace: () => true,
    matchesSource: () => true,
  })

describe('usage limit rows', () => {
  it('keeps only stored recoveries that are still waiting on an idle, visible thread', () => {
    expect(select({}).map(row => row.session.id)).toEqual(['blocked'])
    expect(select({ continuations: [continuation({ state: 'queued' })] })).toEqual([])
    expect(select({ continuations: [continuation({ sessionId: 'other' })] })).toEqual([])
    expect(select({ sessions: [session({ running: true })] })).toEqual([])
    expect(select({ sessions: [session({ blank: true })] })).toEqual([])
    expect(select({ muted: ['blocked'] })).toEqual([])
    expect(select({ archived: ['blocked'] })).toEqual([])
  })

  it('honours the workspace and source filters the view already applies', () => {
    const filtered = UsageLimitRowsModel.select({
      sessions: [session()],
      continuations: [continuation()],
      mutedSessionIds: new Set(),
      archivedSessionIds: new Set(),
      matchesWorkspace: () => false,
      matchesSource: () => true,
    })
    expect(filtered).toEqual([])
  })

  it('leads with the resets that already passed, then the most recent failure', () => {
    const rows = select({
      sessions: [session({ id: 'a' }), session({ id: 'b' }), session({ id: 'c' })],
      continuations: [
        continuation({ sessionId: 'a', continuationId: 'aa', failedAt: NOW - 9_000 }),
        continuation({ sessionId: 'b', continuationId: 'bb', failedAt: NOW - 1_000, ready: true }),
        continuation({ sessionId: 'c', continuationId: 'cc', failedAt: NOW - 5_000 }),
      ],
    })
    expect(rows.map(row => row.session.id)).toEqual(['b', 'c', 'a'])
  })
})

describe('usage limit timing', () => {
  it('names the wait, the reset that passed, and the one nobody knows', () => {
    expect(UsageLimitRowsModel.timing(continuation(), NOW)).toEqual({ kind: 'waiting', resetAt: NOW + 3_600_000 })
    expect(UsageLimitRowsModel.timing(continuation({ ready: true }), NOW)).toEqual({ kind: 'ready' })
    expect(UsageLimitRowsModel.timing(continuation({ resetAt: null }), NOW)).toEqual({ kind: 'unknown' })
    expect(UsageLimitRowsModel.timing(continuation({ state: 'queued' }), NOW)).toEqual({ kind: 'queued' })
  })

  it('reports a snooze only while it still holds', () => {
    expect(UsageLimitRowsModel.timing(continuation({ snoozedUntil: NOW + 600_000 }), NOW)).toEqual({ kind: 'snoozed', until: NOW + 600_000 })
    expect(UsageLimitRowsModel.timing(continuation({ snoozedUntil: NOW - 1 }), NOW)).toEqual({ kind: 'waiting', resetAt: NOW + 3_600_000 })
  })
})

describe('formatRemaining', () => {
  it('counts down in the largest useful unit', () => {
    expect(UsageLimitRowsModel.formatRemaining(NOW + 30_000, NOW)).toBe('1m')
    expect(UsageLimitRowsModel.formatRemaining(NOW + 42 * 60_000, NOW)).toBe('42m')
    expect(UsageLimitRowsModel.formatRemaining(NOW + 3_600_000, NOW)).toBe('1h')
    expect(UsageLimitRowsModel.formatRemaining(NOW + 150 * 60_000, NOW)).toBe('2h 30m')
    expect(UsageLimitRowsModel.formatRemaining(NOW + 26 * 3_600_000, NOW)).toBe('1d 2h')
    expect(UsageLimitRowsModel.formatRemaining(NOW + 48 * 3_600_000, NOW)).toBe('2d')
  })

  it('never counts a reset that already passed below zero', () => {
    expect(UsageLimitRowsModel.formatRemaining(NOW - 60_000, NOW)).toBe('0m')
  })
})
