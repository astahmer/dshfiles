import { describe, expect, it } from 'vitest'
import { StalledStream } from './stalled-stream.js'

describe('stalled streams', () => {
  it('reads how long the stream stayed silent from the pi-ai watchdog message', () => {
    expect(StalledStream.silentMs({ message: 'pi-ai stream idle timeout after 120000ms' })).toBe(120_000)
    expect(StalledStream.silentMs({ message: 'socket hang up' })).toBeUndefined()
  })

  it('tells the user how to retry and how to turn on the automatic fallback', () => {
    const advice = StalledStream.turnAdvice({ silentMs: 120_000, fallbackOn: false })
    expect(advice).toContain('sent no data for 2 min')
    expect(advice).toContain('Resume to retry it')
    expect(advice).toContain('Fall back on stalled streams')
  })

  it('points at the fallback chain once the automatic fallback is on', () => {
    expect(StalledStream.turnAdvice({ silentMs: 90_000, fallbackOn: true })).toContain('Fallbacks section')
  })
})
