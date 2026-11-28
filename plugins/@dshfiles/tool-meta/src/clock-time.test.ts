import { formatClockTime } from '@dshfiles/plugin-ui/lib/format-clock-time'
import { describe, expect, it } from 'vitest'
import { ToolTimingModel } from './timing.js'

// Council round 5 (A6): a tool row's start time reads like every other clock time, in the locale's own 12/24 h.
describe("a tool call's start time (round five A6)", () => {
  it("is the kit formatter's clock time", () => {
    const at = new Date(2026, 10, 25, 21, 13).getTime()
    expect(ToolTimingModel.formatMoment({ at, now: at + 60_000, format: 'absolute', t: (() => '') as never })).toBe(formatClockTime(at))
  })
})
