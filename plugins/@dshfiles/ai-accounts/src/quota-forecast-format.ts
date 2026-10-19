const HOUR_MS = 3_600_000
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

  static percent = (value: number): string => `${String(Math.round(value))}%`
}
