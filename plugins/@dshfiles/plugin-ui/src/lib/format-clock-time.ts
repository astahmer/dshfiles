/**
 * The one time-of-day formatter (council round 5 A6; DESIGN.md › Durations). It follows the locale's 12/24 h choice and
 * prints it the same way everywhere: a 24-hour locale gets the transcript's zero-padded `15:45` / `09:05` (never hour
 * 24 at midnight), a 12-hour locale its own `3:45 PM`. Use it for every clock time a row, a card or a chart prints, so
 * two places never show the same instant two ways. Durations use `formatElapsed` (lib/format-duration).
 */

export type ClockHourCycle = 'h12' | 'h23'

export interface ClockTimeOptions {
  /** A BCP 47 locale (or list); the browser's when omitted. */
  readonly locale?: string | readonly string[] | undefined
  /** Append seconds (`15:45:09`), for a log or a trace. */
  readonly seconds?: boolean | undefined
}

type LocaleInput = string | readonly string[] | undefined

const localeArgument = (locale: LocaleInput): string | string[] | undefined =>
  locale === undefined ? undefined : typeof locale === 'string' ? locale : [...locale]

const keyOf = (locale: LocaleInput): string => (locale === undefined ? '' : typeof locale === 'string' ? locale : locale.join(','))

const cycles = new Map<string, ClockHourCycle>()
const formats = new Map<string, Intl.DateTimeFormat>()

/** Whether the locale reads the clock in 12 or 24 hours (`h11`/`h12` → `h12`; `h23`/`h24` → `h23`). */
export const clockHourCycle = (locale?: LocaleInput): ClockHourCycle => {
  const key = keyOf(locale)
  const cached = cycles.get(key)
  if (cached !== undefined) return cached
  const resolved = new Intl.DateTimeFormat(localeArgument(locale), { hour: 'numeric' }).resolvedOptions().hourCycle
  const cycle: ClockHourCycle = resolved === 'h11' || resolved === 'h12' ? 'h12' : 'h23'
  cycles.set(key, cycle)
  return cycle
}

const formatFor = (locale: LocaleInput, seconds: boolean): Intl.DateTimeFormat => {
  const key = `${keyOf(locale)}|${seconds ? 's' : ''}`
  const cached = formats.get(key)
  if (cached !== undefined) return cached
  const cycle = clockHourCycle(locale)
  const options: Intl.DateTimeFormatOptions = {
    // A 12-hour clock drops the leading zero (`9:05 AM`); a 24-hour one keeps it, as the transcript does (`09:05`).
    hour: cycle === 'h12' ? 'numeric' : '2-digit',
    minute: '2-digit',
    // `hour12: false` leaves midnight open to `24:00` in some engines; name the cycle instead.
    hourCycle: cycle,
  }
  if (seconds) options.second = '2-digit'
  const format = new Intl.DateTimeFormat(localeArgument(locale), options)
  formats.set(key, format)
  return format
}

/** `15:45` (24-hour locales) or `3:45 PM` (12-hour locales) for an epoch-ms instant or a `Date`. */
export const formatClockTime = (at: number | Date, options: ClockTimeOptions = {}): string =>
  formatFor(options.locale, options.seconds === true).format(at)
