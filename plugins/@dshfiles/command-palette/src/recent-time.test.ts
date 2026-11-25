import { describe, expect, it } from 'vitest'
import { recentTime } from './recent-time.js'

describe('recentTime', () => {
  const now = new Date(2026, 10, 25, 15, 0, 0).getTime()

  it("says today's recents in whole units", () => {
    expect(recentTime(now - 20_000, now)).toBe('now')
    expect(recentTime(now - 2 * 60_000 - 41_000, now)).toBe('2m')
    expect(recentTime(now - 3 * 3_600_000, now)).toBe('3h')
  })

  it('dates a thread from an earlier day', () => {
    const yesterday = new Date(2026, 10, 24, 23, 0, 0).getTime()
    expect(recentTime(yesterday, now)).toBe(new Date(yesterday).toLocaleDateString())
  })
})
