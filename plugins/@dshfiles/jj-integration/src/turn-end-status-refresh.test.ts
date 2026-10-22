import { describe, expect, it } from 'vitest'
import { TurnEndStatusRefresh } from './turn-end-status-refresh.js'

describe('turn-end status refresh', () => {
  it('asks for one read when a running Turn ends', () => {
    const refresh = new TurnEndStatusRefresh(undefined)
    expect(refresh.take({ newestTurnHasEnded: false, endedAt: undefined })).toBe(false)
    expect(refresh.take({ newestTurnHasEnded: true, endedAt: 1_000 })).toBe(true)
    expect(refresh.take({ newestTurnHasEnded: true, endedAt: 1_000 })).toBe(false)
  })

  it('does not re-read a Turn that had already ended when its tail mounted', () => {
    const refresh = new TurnEndStatusRefresh(1_000)
    expect(refresh.take({ newestTurnHasEnded: true, endedAt: 1_000 })).toBe(false)
  })

  it('leaves an older Turn alone', () => {
    const refresh = new TurnEndStatusRefresh(undefined)
    expect(refresh.take({ newestTurnHasEnded: false, endedAt: 1_000 })).toBe(false)
  })

  it('reads once for a later Turn of the same conversation', () => {
    const refresh = new TurnEndStatusRefresh(undefined)
    expect(refresh.take({ newestTurnHasEnded: true, endedAt: 1_000 })).toBe(true)
    expect(refresh.take({ newestTurnHasEnded: true, endedAt: 2_000 })).toBe(true)
  })
})
