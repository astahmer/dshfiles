import { describe, expect, it } from 'vitest'
import { SettledThreadsModel, type SettledSessionState } from './settled-threads.js'

const session = (overrides: Partial<SettledSessionState> = {}): SettledSessionState => ({
  running: false,
  pendingInteraction: false,
  updatedAt: 0,
  ...overrides,
})

const sessions = (entries: Readonly<Record<string, SettledSessionState>>): ReadonlyMap<string, SettledSessionState> => new Map(Object.entries(entries))

describe('SettledThreadsModel.settle', () => {
  it('records when each thread was settled and keeps the first instant on a repeated settle', () => {
    const first = SettledThreadsModel.settle({ settledSessionIds: [], settledAt: {} }, ['session-a'], 1_000)
    expect(first).toEqual({ settledSessionIds: ['session-a'], settledAt: { 'session-a': 1_000 } })
    expect(SettledThreadsModel.settle(first, ['session-a'], 5_000)).toEqual(first)
  })

  it('drops a timestamp whose id is no longer settled and ignores an empty settle', () => {
    const status = SettledThreadsModel.unsettle({ settledSessionIds: ['session-a', 'session-b'], settledAt: { 'session-a': 1_000, 'session-b': 2_000 } }, [
      'session-a',
    ])
    expect(status).toEqual({ settledSessionIds: ['session-b'], settledAt: { 'session-b': 2_000 } })
    expect(SettledThreadsModel.settle(status, [], 3_000)).toBe(status)
  })
})

describe('SettledThreadsModel.settleAndUnpark', () => {
  const status = { settledSessionIds: [], settledAt: {} }

  it('settles a parked thread and drops its parked mark in the same write', () => {
    expect(
      SettledThreadsModel.settleAndUnpark({
        status,
        parkedSessionIds: ['session-a', 'session-b'],
        sessionIds: ['session-a'],
        now: 1_000,
      }),
    ).toEqual({ settledSessionIds: ['session-a'], settledAt: { 'session-a': 1_000 }, parkedSessionIds: ['session-b'] })
  })

  it('leaves other parked ids alone and never restores a mark on unsettle', () => {
    const settled = SettledThreadsModel.settleAndUnpark({ status, parkedSessionIds: ['session-a'], sessionIds: ['session-a'], now: 1_000 })
    expect(settled.parkedSessionIds).toEqual([])
    expect(SettledThreadsModel.unsettle(settled, ['session-a'])).toEqual({ settledSessionIds: [], settledAt: {} })
  })

  it('ignores an empty settle and keeps parked ids as they are', () => {
    const result = SettledThreadsModel.settleAndUnpark({ status, parkedSessionIds: ['session-a'], sessionIds: [], now: 1_000 })
    expect(result).toEqual({ settledSessionIds: [], settledAt: {}, parkedSessionIds: ['session-a'] })
  })
})

describe('SettledThreadsModel.archiveTime', () => {
  it('adds the delay to the settle instant and stays undefined without either', () => {
    expect(SettledThreadsModel.archiveTime({ settledAt: 1_000, delayMs: 60_000 })).toBe(61_000)
    expect(SettledThreadsModel.archiveTime({ settledAt: 1_000, delayMs: 0 })).toBe(1_000)
    expect(SettledThreadsModel.archiveTime({ settledAt: undefined, delayMs: 60_000 })).toBeUndefined()
    expect(SettledThreadsModel.archiveTime({ settledAt: 1_000, delayMs: Number.POSITIVE_INFINITY })).toBeUndefined()
  })
})

describe('SettledThreadsModel.dueArchiveSessionIds', () => {
  const status = { settledSessionIds: ['session-a'], settledAt: { 'session-a': 1_000 } }
  const archive = (overrides: Partial<Parameters<typeof SettledThreadsModel.dueArchiveSessionIds>[0]> = {}) =>
    SettledThreadsModel.dueArchiveSessionIds({
      status,
      sessions: sessions({ 'session-a': session() }),
      archivedSessionIds: new Set(),
      pinnedSessionIds: new Set(),
      now: 61_000,
      delayMs: 60_000,
      ...overrides,
    })

  it('returns a settled thread once its delay has passed', () => {
    expect(archive()).toEqual(['session-a'])
    expect(archive({ now: 60_999 })).toEqual([])
  })

  it('never returns anything while the delay is disabled or the settle instant is unknown', () => {
    expect(archive({ delayMs: Number.POSITIVE_INFINITY })).toEqual([])
    expect(archive({ status: { settledSessionIds: ['session-a'], settledAt: {} } })).toEqual([])
  })

  it('leaves archived, pinned, running, waiting and newly changed threads alone', () => {
    expect(archive({ archivedSessionIds: new Set(['session-a']) })).toEqual([])
    expect(archive({ pinnedSessionIds: new Set(['session-a']) })).toEqual([])
    expect(archive({ sessions: sessions({ 'session-a': session({ running: true }) }) })).toEqual([])
    expect(archive({ sessions: sessions({ 'session-a': session({ pendingInteraction: true }) }) })).toEqual([])
    expect(archive({ sessions: sessions({ 'session-a': session({ pendingInteraction: undefined }) }) })).toEqual([])
    expect(archive({ sessions: sessions({ 'session-a': session({ updatedAt: 1_001 }) }) })).toEqual([])
    expect(archive({ sessions: sessions({}) })).toEqual([])
  })
})
