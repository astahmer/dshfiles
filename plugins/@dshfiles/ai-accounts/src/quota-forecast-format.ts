import type { WorkHours } from './quota-coverage-model.js'

const HOUR_MS = 3_600_000
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const
// 5 October 2026 is a Monday; adding a day index names that weekday in the viewer's locale.
const MONDAY = new Date(2026, 9, 5).getTime()
const DAY_MS = 24 * HOUR_MS

/** Wording shared by the forecast board and the coverage weeks. */
export class QuotaForecastFormat {
  /** `Fri 03:24` within the coming week, `Oct 24` beyond it. */
  static moment = (at: number, now: number): string => {
    const date = new Date(at)
    if (Math.abs(at - now) < 6 * DAY_MS) {
      return `${date.toLocaleDateString(undefined, { weekday: 'short' })} ${date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })}`
    }
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  }

  static clock = (at: number): string => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })

  static weekday = (at: number, style: 'short' | 'long' = 'short'): string => new Date(at).toLocaleDateString(undefined, { weekday: style })

  static day = (at: number): string => new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

  /** `8 h`, `1 day 19 h`, `45 min`. */
  static duration = (ms: number): string => {
    if (ms < HOUR_MS) return `${String(Math.max(1, Math.round(ms / 60_000)))} min`
    const hours = Math.round(ms / HOUR_MS)
    if (hours < 24) return `${String(hours)} h`
    const days = Math.floor(hours / 24)
    const rest = hours % 24
    return `${String(days)} day${days === 1 ? '' : 's'}${rest === 0 ? '' : ` ${String(rest)} h`}`
  }

  /** `Mon–Fri 09:00 to 18:00`, or the listed days when they are not one run. */
  static workHours = (workHours: WorkHours): string => {
    const ordered = WEEK_ORDER.filter(day => workHours.days.includes(day))
    if (ordered.length === 0) return 'No work days'
    const names = ordered.map(day => QuotaForecastFormat.weekday(MONDAY + ((day + 6) % 7) * DAY_MS))
    const positions = ordered.map(day => WEEK_ORDER.indexOf(day))
    const contiguous = positions.every((position, index) => index === 0 || position === (positions[index - 1] ?? -2) + 1)
    const days = contiguous && names.length > 2 ? `${names[0] ?? ''}–${names.at(-1) ?? ''}` : names.join(', ')
    const hour = (value: number): string => `${String(value).padStart(2, '0')}:00`
    return `${days} ${hour(workHours.startHour)} to ${hour(workHours.endHour)}`
  }

  static percent = (value: number): string => `${String(Math.round(value))}%`
}
