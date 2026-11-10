import { describe, expect, it } from 'vitest'
import { Option, Schema } from 'effect'
import { CompactionReading, ContextPressure } from './compaction-reading.js'

describe('the compaction reading', () => {
  it('counts down from the trigger with the size the context ring shows', () => {
    const used = CompactionReading.usedTokens({ pressureTokens: 50_000, projectedTokens: 86_272, contextWindow: 200_000 })
    const reading = CompactionReading.of({ usedTokens: used, thresholdTokens: 126_272, contextWindow: 200_000, auto: true })
    expect(reading).toEqual({ remainingTokens: 40_000, thresholdTokens: 126_272, contextWindow: 200_000, thresholdPercent: 63, due: false })
    expect(reading === null ? '' : CompactionReading.label(reading)).toBe('compacts in ~40K')
  })

  it('says the next step compacts once the trigger is reached', () => {
    const reading = CompactionReading.of({ usedTokens: 130_000, thresholdTokens: 126_272, contextWindow: 200_000, auto: true })
    expect(reading?.due).toBe(true)
    expect(reading === null ? '' : CompactionReading.label(reading)).toBe('compacts next step')
  })

  it('drops a malformed pressure projection at the boundary', () => {
    expect(Option.isNone(Schema.decodeUnknownOption(ContextPressure)({ contextWindow: 'wide' }))).toBe(true)
  })

  it('shows nothing with automatic compaction off or before the first usage sample', () => {
    expect(CompactionReading.of({ usedTokens: 1, thresholdTokens: 10, contextWindow: 20, auto: false })).toBeNull()
    expect(CompactionReading.of({ usedTokens: CompactionReading.usedTokens(undefined), thresholdTokens: 10, contextWindow: 20, auto: true })).toBeNull()
  })
})
