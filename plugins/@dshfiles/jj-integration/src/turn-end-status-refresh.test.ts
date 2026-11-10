import { describe, expect, it } from 'vitest'
import { TurnEndStatusRefreshModel, type TurnEndStatusRefresh } from './turn-end-status-refresh.js'

const ended = (state: TurnEndStatusRefresh, endedAt: number | undefined, baseline = 0) =>
  TurnEndStatusRefreshModel.turnEndRefreshOnEnd(state, { newestTurnHasEnded: endedAt !== undefined, endedAt, baseline })

describe('turn-end status refresh', () => {
  it('asks for one read when a running Turn ends', () => {
    const waiting = TurnEndStatusRefreshModel.turnEndRefreshOnMount(undefined)
    expect(ended(waiting, undefined)).toBe(waiting)

    const refreshing = ended(waiting, 1_000, 40)
    expect(refreshing).toEqual({ phase: 'refreshing', endedAt: 1_000, baseline: 40 })
    expect(TurnEndStatusRefreshModel.turnEndRefreshPending(refreshing)).toBe(true)
    expect(ended(refreshing, 1_000, 90)).toBe(refreshing)
  })

  it('settles once a status read is newer than the one it started from', () => {
    const refreshing = ended(TurnEndStatusRefreshModel.turnEndRefreshOnMount(undefined), 1_000, 40)
    expect(TurnEndStatusRefreshModel.turnEndRefreshStatusRead(refreshing, 40)).toBe(refreshing)
    expect(TurnEndStatusRefreshModel.turnEndRefreshPending(TurnEndStatusRefreshModel.turnEndRefreshStatusRead(refreshing, 41))).toBe(false)
    expect(TurnEndStatusRefreshModel.turnEndRefreshStatusRead(refreshing, 41)).toEqual({ phase: 'settled', endedAt: 1_000 })
  })

  it('does not re-read a Turn that had already ended when its tail mounted', () => {
    const settled = TurnEndStatusRefreshModel.turnEndRefreshOnMount(1_000)
    expect(settled).toEqual({ phase: 'settled', endedAt: 1_000 })
    expect(ended(settled, 1_000)).toBe(settled)
    expect(TurnEndStatusRefreshModel.turnEndRefreshPending(settled)).toBe(false)
  })

  it('reads once for a later Turn of the same conversation', () => {
    const settled = TurnEndStatusRefreshModel.turnEndRefreshOnMount(1_000)
    expect(ended(settled, 2_000, 90)).toEqual({ phase: 'refreshing', endedAt: 2_000, baseline: 90 })
  })
})
