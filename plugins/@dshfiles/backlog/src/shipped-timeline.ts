import type { ShippedUnit } from './shipped.js'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

interface BucketRange {
  readonly start: number
  readonly end: number
  readonly count: number
}

export type TimelineEntry<Bucket extends BucketRange> =
  | { readonly kind: 'bucket'; readonly bucket: Bucket; readonly current: boolean }
  | { readonly kind: 'quiet'; readonly start: number; readonly end: number; readonly periods: number }

const unitNames = {
  hour: ['hour', 'hours'],
  day: ['day', 'days'],
  week: ['week', 'weeks'],
  month: ['month', 'months'],
  year: ['year', 'years'],
} satisfies Record<ShippedUnit, readonly [string, string]>

/**
 * The buckets a timeline shows: the current period always, every period that shipped something, and each run of
 * empty periods folded into one quiet line, so a day view of a slow week is not a column of zeros.
 */
const entriesOf = <Bucket extends BucketRange>(buckets: readonly Bucket[]): TimelineEntry<Bucket>[] => {
  const entries: TimelineEntry<Bucket>[] = []
  buckets.forEach((bucket, index) => {
    if (index === 0 || bucket.count > 0) {
      entries.push({ kind: 'bucket', bucket, current: index === 0 })
      return
    }
    const last = entries.at(-1)
    if (last?.kind === 'quiet') entries[entries.length - 1] = { kind: 'quiet', start: bucket.start, end: last.end, periods: last.periods + 1 }
    else entries.push({ kind: 'quiet', start: bucket.start, end: bucket.end, periods: 1 })
  })
  return entries
}

const sameDay = (left: Date, right: Date): boolean =>
  left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate()

/** A bucket's heading in the reader's locale and time zone: "Today", "Last week", "Mon, Nov 2", "November 2026". */
const labelOf = (input: { readonly unit: ShippedUnit; readonly start: number; readonly now: number; readonly locale?: string | undefined }): string => {
  const start = new Date(input.start)
  const now = new Date(input.now)
  const format = (options: Intl.DateTimeFormatOptions): string => new Intl.DateTimeFormat(input.locale, options).format(start)
  const otherYear = start.getFullYear() !== now.getFullYear()
  const dayOfMonth: Intl.DateTimeFormatOptions = otherYear ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' }
  if (input.unit === 'hour') {
    const time = format({ hour: 'numeric', minute: '2-digit' })
    if (sameDay(start, now)) return time
    return `${format({ weekday: 'short', month: 'short', day: 'numeric' })}, ${time}`
  }
  if (input.unit === 'day') {
    if (sameDay(start, now)) return 'Today'
    if (sameDay(start, new Date(input.now - DAY_MS))) return 'Yesterday'
    return format({ weekday: 'short', ...dayOfMonth })
  }
  if (input.unit === 'week') {
    const weeksAgo = Math.floor((input.now - input.start) / (7 * DAY_MS))
    if (weeksAgo <= 0) return 'This week'
    if (weeksAgo === 1) return 'Last week'
    return `Week of ${format(dayOfMonth)}`
  }
  if (input.unit === 'month') {
    if (start.getFullYear() === now.getFullYear() && start.getMonth() === now.getMonth()) return 'This month'
    return format({ month: 'long', year: 'numeric' })
  }
  return otherYear ? String(start.getFullYear()) : 'This year'
}

const quietLabel = (unit: ShippedUnit, periods: number): string => `${String(periods)} quiet ${unitNames[unit][periods === 1 ? 0 : 1]}`

/** A count against the period before: `+3`, `−2` or `±0`, with its tone. */
export interface ShippedDelta {
  readonly text: string
  readonly tone: 'up' | 'down' | 'flat'
}

/** `+3`, `−2` or `±0` against the period before, with its tone. */
const deltaOf = (input: { readonly count: number; readonly previousCount: number }): ShippedDelta => {
  const delta = input.count - input.previousCount
  if (delta > 0) return { text: `+${String(delta)}`, tone: 'up' }
  if (delta < 0) return { text: `−${String(-delta)}`, tone: 'down' }
  return { text: '±0', tone: 'flat' }
}

/** Minutes east of UTC in the reader's zone now, which the Host buckets by. */
const localOffsetMinutes = (now = Date.now()): number => -new Date(now).getTimezoneOffset()

export class ShippedTimeline {
  static readonly entriesOf = entriesOf
  static readonly labelOf = labelOf
  static readonly quietLabel = quietLabel
  static readonly deltaOf = deltaOf
  static readonly localOffsetMinutes = localOffsetMinutes
}
