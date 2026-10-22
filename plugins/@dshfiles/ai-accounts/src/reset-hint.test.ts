import { describe, expect, it } from 'vitest'
import { declaredResetWaitMs, MAX_RESET_WAIT_MS } from './reset-hint.js'

const MINUTE = 60_000
const HOUR = 3_600_000
const NOW = new Date(2026, 9, 22, 10, 0, 0, 0).getTime()

describe('declaredResetWaitMs', () => {
  it('reads the minutes a spent plan names', () => {
    expect(declaredResetWaitMs('You have hit your ChatGPT usage limit (plus plan). Try again in ~242 min.', NOW)).toBe(242 * MINUTE)
    expect(declaredResetWaitMs('Try again in 7 min.', NOW)).toBe(7 * MINUTE)
    expect(declaredResetWaitMs('try again in ~3 minutes.', NOW)).toBe(3 * MINUTE)
    expect(declaredResetWaitMs('Try again in 2 hours', NOW)).toBe(2 * HOUR)
  })

  it('reads the clock a Claude limit resets at', () => {
    expect(declaredResetWaitMs("You've hit your limit · resets 3:00 PM", NOW)).toBe(5 * HOUR)
    expect(declaredResetWaitMs('resets 2:10am', NOW)).toBe(16 * HOUR + 10 * MINUTE)
    expect(declaredResetWaitMs('resets at 17:30', NOW)).toBe(7 * HOUR + 30 * MINUTE)
  })

  it('rolls a clock that already passed into tomorrow', () => {
    expect(declaredResetWaitMs('resets 9:00 AM', NOW)).toBe(23 * HOUR)
  })

  it('caps a distant reset at a day and leaves other wording alone', () => {
    expect(declaredResetWaitMs('Try again in 100000 min.', NOW)).toBe(MAX_RESET_WAIT_MS)
    expect(declaredResetWaitMs('Try again in 0 min.', NOW)).toBeUndefined()
    expect(declaredResetWaitMs('You have hit your usage limit', NOW)).toBeUndefined()
    expect(declaredResetWaitMs('upstream closed the stream', NOW)).toBeUndefined()
  })
})
