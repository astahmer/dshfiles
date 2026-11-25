import { describe, expect, it } from 'vitest'
import manifest from '../package.json' with { type: 'json' }
import { clockHourCycle, formatClockTime } from '../src/lib/format-clock-time.ts'

// Council round 5 A6: one time-of-day formatter that follows the locale's 12/24 h choice everywhere.
const at = (hours: number, minutes: number, seconds = 0): Date => new Date(2026, 10, 25, hours, minutes, seconds)
const pad2 = (n: number): string => String(n).padStart(2, '0')
/** The transcript's turn time today (chat message-chrome `formatMessageClock`, same day): zero-padded `HH:mm`. */
const transcriptClock = (date: Date): string => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`

describe('formatClockTime (council round 5 A6)', () => {
  it.each(['en-GB', 'fr-FR', 'de-DE', 'ja-JP'])('prints the transcript turn time in a 24-hour locale (%s)', locale => {
    expect(clockHourCycle(locale)).toBe('h23')
    for (const date of [at(9, 5), at(15, 45), at(0, 7), at(23, 59)]) expect(formatClockTime(date, { locale })).toBe(transcriptClock(date))
  })

  it('never prints hour 24 at midnight', () => {
    expect(formatClockTime(at(0, 7), { locale: 'en-GB' })).toBe('00:07')
  })

  it('prints the locale 12-hour clock where the locale uses one (en-US), with no leading zero', () => {
    expect(clockHourCycle('en-US')).toBe('h12')
    expect(formatClockTime(at(15, 45), { locale: 'en-US' })).toMatch(/^3:45\s?PM$/u)
    expect(formatClockTime(at(9, 5), { locale: 'en-US' })).toMatch(/^9:05\s?AM$/u)
    expect(formatClockTime(at(0, 7), { locale: 'en-US' })).toMatch(/^12:07\s?AM$/u)
  })

  it('adds seconds on request, still in the locale cycle', () => {
    expect(formatClockTime(at(15, 45, 9), { locale: 'en-GB', seconds: true })).toBe('15:45:09')
    expect(formatClockTime(at(15, 45, 9), { locale: 'en-US', seconds: true })).toMatch(/^3:45:09\s?PM$/u)
  })

  it('accepts an epoch number and a Date alike', () => {
    const date = at(15, 45)
    expect(formatClockTime(date.getTime(), { locale: 'en-GB' })).toBe(formatClockTime(date, { locale: 'en-GB' }))
  })

  it('is exported as a package subpath', () => {
    expect(manifest.exports['./lib/format-clock-time']).toEqual({ types: './src/lib/format-clock-time.ts', default: './src/lib/format-clock-time.ts' })
  })
})
