import { describe, expect, test } from 'vitest'
import { DisconnectGrace } from './disconnect-grace.js'

describe('disconnect grace', () => {
  test('a host that was online moments ago still has time before it reads as failed', () => {
    expect(DisconnectGrace.remaining({ lastOnlineAt: 1_000, now: 4_000 })).toBe(DisconnectGrace.windowMs - 3_000)
  })

  test('the window closes and never goes negative', () => {
    expect(DisconnectGrace.remaining({ lastOnlineAt: 1_000, now: 1_000 + DisconnectGrace.windowMs })).toBe(0)
    expect(DisconnectGrace.remaining({ lastOnlineAt: 1_000, now: 1_000_000 })).toBe(0)
  })
})
