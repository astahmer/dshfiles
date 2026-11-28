// Shared time-label helpers for user/assistant IconActions rows.

import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import { formatClockTime } from '@dshfiles/plugin-ui/lib/format-clock-time'
import { formatElapsed } from '@dshfiles/plugin-ui/lib/format-duration'

/** The date-template share of the conversation dictionary the clock consumes. */
export type ClockTranslate = Translate<'clock.md' | 'clock.ymd'>

/** Refresh interval for whole-second live run clocks. */
export const LIVE_RUN_CLOCK_INTERVAL_MS = 1000

/**
 * Local calendar-day epoch (ms at local midnight) for an instant.
 * @param ms - Unix epoch ms.
 * @returns Midnight of that local calendar day.
 */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/**
 * Delay until the next local midnight after `ms` (at least 1ms).
 * @param ms - Unix epoch ms.
 * @returns Milliseconds until the following local midnight.
 */
export function msUntilNextLocalMidnight(ms: number): number {
  const next = new Date(ms)
  next.setHours(24, 0, 0, 0)
  return Math.max(next.getTime() - ms, 1)
}

/** One numeric value or unit in an elapsed-time label. */
export interface RunDurationPart {
  readonly text: string
  readonly numeric: boolean
}

/**
 * Build elapsed-time fragments for both live and completed Turn labels.
 * dshfiles (unslop R1): the kit's `formatElapsed` grammar (`9s`, `2m 05s`, `1h 04m`), whole seconds floored, padded
 * after minutes and hours so a ticking clock keeps its width, and the same `s`/`m`/`h` in every language.
 * @param ms - elapsed milliseconds; negatives clamp to zero and fractions floor.
 * @returns numbers and units in display order; the space between two pairs rides on the first unit.
 */
export function formatRunDuration(ms: number): RunDurationPart[] {
  return [...formatElapsed(ms).matchAll(/(\d+)(\D+)/g)].flatMap(([, value = '', unit = '']) => [
    { text: value, numeric: true },
    { text: unit, numeric: false },
  ])
}

/**
 * Decode-throughput figure: whole tokens from ten up, one decimal below.
 * @param tps - Tokens per second.
 * @returns Display number without unit.
 */
export function formatTokensPerSecond(tps: number): string {
  const clamped = Math.max(0, tps)
  return clamped >= 10 ? String(Math.round(clamped)) : String(Math.round(clamped * 10) / 10)
}

/**
 * Compact local timestamp for message IconActions. Same calendar day →
 * `HH:mm`; earlier this year → the `clock.md` date template + clock; other
 * years → the `clock.ymd` template + clock. Pure: the date templates arrive
 * through the caller's locale seat.
 * @param time - Unix epoch ms from the source session event.
 * @param t - translate seat supplying the `clock.md` / `clock.ymd` templates.
 * @param now - Reference instant for the day/year cut (defaults to wall clock).
 * @returns Date-aware clock string; the time follows the locale's 12/24 h through the kit's one clock formatter
 *   (dshfiles, council round 5 A6), so the transcript and every other surface print an instant the same way.
 */
export function formatMessageClock(time: number, t: ClockTranslate, now: number = Date.now()): string {
  const d = new Date(time)
  const n = new Date(now)
  const clock = formatClockTime(time)
  if (
    d.getFullYear() === n.getFullYear()
    && d.getMonth() === n.getMonth()
    && d.getDate() === n.getDate()
  ) {
    return clock
  }
  const params = { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() }
  const md = d.getFullYear() === n.getFullYear() ? t('clock.md', params) : t('clock.ymd', params)
  return `${md} ${clock}`
}
