import { describe, expect, it } from 'vitest'
import type { InboxThreadSignal } from './thread-status.js'
import { WaitingThreads } from './waiting-threads.js'

const signal = (overrides: Partial<InboxThreadSignal> & Pick<InboxThreadSignal, 'itemId'>): InboxThreadSignal => ({
  severity: 'ready',
  reason: 'Turn finished; ready to review.',
  verb: undefined,
  openedAt: 1,
  ...overrides,
})

describe('WaitingThreads', () => {
  it('lists one row per thread, blocking before failed before review, newest first within each', () => {
    const signals = new Map<string, InboxThreadSignal>([
      ['reviewed', signal({ itemId: 'c', severity: 'ready', openedAt: 9 })],
      ['stuck', signal({ itemId: 'b', severity: 'failed', openedAt: 5 })],
      ['waiting', signal({ itemId: 'a', severity: 'blocking', openedAt: 3 })],
      ['asked', signal({ itemId: 'd', severity: 'blocking', openedAt: 7 })],
    ])
    expect(WaitingThreads.rows(signals).map(row => row.sessionId)).toEqual(['asked', 'waiting', 'stuck', 'reviewed'])
  })

  it('counts each tab by severity, and an empty inbox has none', () => {
    const rows = WaitingThreads.rows(
      new Map<string, InboxThreadSignal>([
        ['a', signal({ itemId: '1', severity: 'blocking' })],
        ['b', signal({ itemId: '2', severity: 'failed' })],
        ['c', signal({ itemId: '3', severity: 'ready' })],
        ['d', signal({ itemId: '4', severity: 'ready' })],
      ]),
    )
    expect(WaitingThreads.countsOf(rows)).toEqual({ 'needs-you': 2, review: 2 })
    expect(WaitingThreads.inTab(rows, 'review').map(row => row.sessionId)).toEqual(['c', 'd'])
    expect(WaitingThreads.countsOf([])).toEqual({ 'needs-you': 0, review: 0 })
  })
})
