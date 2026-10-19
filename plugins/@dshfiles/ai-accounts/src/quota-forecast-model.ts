import type { AccountKind, UsageCard, UsageHistoryPoint } from './api.js'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const CELL_MS = 6 * HOUR_MS
const BOARD_CELL_COUNT = 28
const MIN_PACE_SPAN_MS = 30 * MINUTE_MS
/** At or below this many points left, a window counts as spent. */
const SPENT_PERCENT = 0.5
/** A climb this large without a reported reset still marks a new cycle. */
const RESET_RISE_PERCENT = 5

const LABEL_LENGTHS: readonly (readonly [RegExp, number])[] = [
  [/session|5.?hour/i, 5 * HOUR_MS],
  [/week/i, 7 * DAY_MS],
  [/month/i, 30 * DAY_MS],
  [/daily|day/i, DAY_MS],
]

export interface ForecastAccountInput {
  readonly instanceId: string
  readonly displayName: string
  readonly kind: AccountKind
  readonly usage: UsageCard | undefined
  readonly points: readonly UsageHistoryPoint[]
}

export type ForecastCellKind = 'projected' | 'runs-out' | 'locked' | 'fresh'

export interface ForecastCell {
  readonly start: number
  readonly end: number
  readonly kind: ForecastCellKind
  /** Projected percent used at the end of the cell; 100 once spent. */
  readonly used: number
  /** Where in the cell (0–1) the window resets, when it does. */
  readonly resetOffset: number | null
  /** Where in the cell (0–1) the window runs out, when it does. */
  readonly runsOutOffset: number | null
}

export interface WindowForecast {
  readonly label: string
  readonly used: number
  readonly resetsAt: number | null
  readonly startsAt: number | null
  readonly lengthMs: number | null
  /** Percentage points used per hour; `null` until enough history spans the cycle. */
  readonly pacePerHour: number | null
  readonly evenPerHour: number | null
  readonly elapsedFraction: number | null
  readonly runsOutAt: number | null
  readonly lockedMs: number | null
  readonly usedAtReset: number | null
  readonly series: readonly { readonly at: number; readonly used: number }[]
  readonly daily: readonly { readonly day: number; readonly used: number }[]
  readonly allowedPerDay: number | null
}

export type AccountForecast =
  | {
      readonly status: 'forecast'
      readonly instanceId: string
      readonly displayName: string
      readonly kind: AccountKind
      readonly window: WindowForecast
      readonly others: readonly WindowForecast[]
      readonly cells: readonly ForecastCell[]
    }
  | {
      readonly status: 'unavailable'
      readonly instanceId: string
      readonly displayName: string
      readonly kind: AccountKind
      readonly reason: 'reconnect' | 'unsupported' | 'no-reading'
    }

export interface ForecastBoard {
  readonly now: number
  readonly cellStarts: readonly number[]
  readonly accounts: readonly AccountForecast[]
  readonly runsOutCount: number
}

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value))

const startOfCell = (at: number): number => {
  const date = new Date(at)
  date.setHours(Math.floor(date.getHours() / 6) * 6, 0, 0, 0)
  return date.getTime()
}

const startOfDay = (at: number): number => {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

const usedOf = (point: UsageHistoryPoint, label: string): number => 100 - clampPercent(point.windows[label] ?? 100)

/** Readings since the last reset of `label`: by reported reset time, else since remaining last jumped up. */
const currentCycle = (series: readonly UsageHistoryPoint[], label: string, resetsAt: number | null): readonly UsageHistoryPoint[] => {
  if (resetsAt !== null) {
    // Providers report the same reset a few seconds apart from one reading to the next.
    const matching = series.filter(point => Math.abs((point.resetsAt[label] ?? Number.NEGATIVE_INFINITY) - resetsAt) <= HOUR_MS)
    if (matching.length > 0) return matching
  }
  let start = 0
  for (let index = 1; index < series.length; index += 1) {
    const previous = series[index - 1]
    const point = series[index]
    if (previous !== undefined && point !== undefined && usedOf(previous, label) - usedOf(point, label) > RESET_RISE_PERCENT) start = index
  }
  return series.slice(start)
}

/** The provider's own gap between two consecutive reset times beats a label guess. */
const windowLength = (series: readonly UsageHistoryPoint[], label: string): number | null => {
  const resets = [...new Set(series.map(point => point.resetsAt[label]).filter((value): value is number => value !== undefined))].sort((a, b) => a - b)
  const previous = resets.at(-2)
  const last = resets.at(-1)
  if (previous !== undefined && last !== undefined && last - previous >= HOUR_MS) return last - previous
  return LABEL_LENGTHS.find(([pattern]) => pattern.test(label))?.[1] ?? null
}

const dailyUse = (series: readonly UsageHistoryPoint[], label: string, now: number): WindowForecast['daily'] => {
  const today = startOfDay(now)
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today)
    date.setDate(date.getDate() - (6 - index))
    return date.getTime()
  })
  const totals = new Map<number, number>(days.map(day => [day, 0]))
  for (let index = 1; index < series.length; index += 1) {
    const previous = series[index - 1]
    const point = series[index]
    if (previous === undefined || point === undefined) continue
    const spent = usedOf(point, label) - usedOf(previous, label)
    const day = startOfDay(point.at)
    if (spent > 0 && totals.has(day)) totals.set(day, (totals.get(day) ?? 0) + spent)
  }
  return days.map(day => ({ day, used: Math.round((totals.get(day) ?? 0) * 10) / 10 }))
}

const forecastWindow = (input: {
  readonly label: string
  readonly remaining: number
  readonly resetsAt: number | null
  readonly points: readonly UsageHistoryPoint[]
  readonly now: number
}): WindowForecast => {
  const { label, now } = input
  const resetsAt = input.resetsAt !== null && input.resetsAt > now ? input.resetsAt : null
  const series = input.points.filter(point => point.windows[label] !== undefined && point.at <= now).sort((left, right) => left.at - right.at)
  const cycle = currentCycle(series, label, resetsAt)
  const lengthMs = windowLength(series, label)
  const startsAt = resetsAt !== null && lengthMs !== null ? resetsAt - lengthMs : (cycle[0]?.at ?? null)
  const used = 100 - clampPercent(input.remaining)

  const lookback = Math.min(DAY_MS, Math.max(HOUR_MS, (lengthMs ?? DAY_MS * 4) / 4))
  const recentStart = cycle.find(point => point.at >= now - lookback)
  let pacePerHour: number | null = null
  if (recentStart !== undefined && now - recentStart.at >= MIN_PACE_SPAN_MS) {
    pacePerHour = Math.max(0, (used - usedOf(recentStart, label)) / ((now - recentStart.at) / HOUR_MS))
  } else if (startsAt !== null && now - startsAt >= MIN_PACE_SPAN_MS) {
    pacePerHour = used / ((now - startsAt) / HOUR_MS)
  }

  const spent = used >= 100 - SPENT_PERCENT
  const rawRunsOut = spent ? now : pacePerHour !== null && pacePerHour > 0 ? now + ((100 - used) / pacePerHour) * HOUR_MS : null
  const runsOutAt = rawRunsOut !== null && (resetsAt === null || rawRunsOut < resetsAt) ? rawRunsOut : null
  const usedAtReset =
    runsOutAt === null && resetsAt !== null ? clampPercent(used + (pacePerHour ?? 0) * ((resetsAt - now) / HOUR_MS)) : runsOutAt === null ? null : 100

  return {
    label,
    used,
    resetsAt,
    startsAt,
    lengthMs,
    pacePerHour,
    evenPerHour: lengthMs === null ? null : 100 / (lengthMs / HOUR_MS),
    elapsedFraction:
      startsAt !== null && resetsAt !== null && resetsAt > startsAt ? clampPercent(((now - startsAt) / (resetsAt - startsAt)) * 100) / 100 : null,
    runsOutAt,
    lockedMs: runsOutAt !== null && resetsAt !== null ? resetsAt - runsOutAt : null,
    usedAtReset,
    series: [...cycle.map(point => ({ at: point.at, used: usedOf(point, label) })), { at: now, used }],
    daily: dailyUse(series, label, now),
    allowedPerDay: lengthMs !== null && lengthMs >= DAY_MS ? 100 / (lengthMs / DAY_MS) : null,
  }
}

const projectedUsedAt = (window: WindowForecast, at: number, now: number): number =>
  clampPercent(window.used + (window.pacePerHour ?? 0) * (Math.max(0, at - now) / HOUR_MS))

const offsetIn = (at: number | null, start: number, end: number): number | null =>
  at !== null && at >= start && at < end ? (at - start) / (end - start) : null

const boardCells = (window: WindowForecast, cellStarts: readonly number[], now: number): readonly ForecastCell[] =>
  cellStarts.map(start => {
    const end = start + CELL_MS
    const resetOffset = offsetIn(window.resetsAt, start, end)
    const runsOutOffset = offsetIn(window.runsOutAt, start, end)
    if (window.resetsAt !== null && start >= window.resetsAt) return { start, end, kind: 'fresh', used: 0, resetOffset: null, runsOutOffset: null }
    if (window.runsOutAt !== null && start >= window.runsOutAt) return { start, end, kind: 'locked', used: 100, resetOffset, runsOutOffset: null }
    if (runsOutOffset !== null) return { start, end, kind: 'runs-out', used: 100, resetOffset, runsOutOffset }
    return { start, end, kind: 'projected', used: projectedUsedAt(window, Math.min(end, window.resetsAt ?? end), now), resetOffset, runsOutOffset: null }
  })

/**
 * The window that binds an account: the first to run out before its reset,
 * else the one projected closest to its limit. Windows shorter than a day only
 * govern when nothing longer is reported, so a 5-hour session does not hide a
 * weekly limit on a seven-day board.
 */
const governingWindow = (windows: readonly WindowForecast[]): WindowForecast | undefined => {
  const long = windows.filter(window => window.lengthMs === null || window.lengthMs >= DAY_MS)
  const candidates = long.length > 0 ? long : windows
  const runningOut = candidates.filter(window => window.runsOutAt !== null).sort((left, right) => (left.runsOutAt ?? 0) - (right.runsOutAt ?? 0))
  if (runningOut[0] !== undefined) return runningOut[0]
  return [...candidates].sort((left, right) => (right.usedAtReset ?? right.used) - (left.usedAtReset ?? left.used))[0]
}

const forecastAccount = (account: ForecastAccountInput, cellStarts: readonly number[], now: number): AccountForecast => {
  const identity = { instanceId: account.instanceId, displayName: account.displayName, kind: account.kind }
  const usage = account.usage
  if (usage === undefined || usage.status === 'unauthenticated' || usage.status === 'error') return { status: 'unavailable', ...identity, reason: 'reconnect' }
  if (usage.status === 'unsupported') return { status: 'unavailable', ...identity, reason: 'unsupported' }
  const windows = usage.windows
    .filter(window => window.reserve !== true)
    .map(window => forecastWindow({ label: window.label, remaining: window.percentRemaining, resetsAt: window.resetsAt, points: account.points, now }))
  const governing = governingWindow(windows)
  if (governing === undefined) return { status: 'unavailable', ...identity, reason: 'no-reading' }
  return {
    status: 'forecast',
    ...identity,
    window: governing,
    others: windows.filter(window => window !== governing),
    cells: boardCells(governing, cellStarts, now),
  }
}

const sortKey = (account: AccountForecast): readonly [number, number] => {
  if (account.status === 'unavailable') return [2, 0]
  if (account.window.runsOutAt !== null) return [0, account.window.runsOutAt]
  return [1, -(account.window.usedAtReset ?? account.window.used)]
}

export class QuotaForecastModel {
  static readonly cellMs = CELL_MS

  /** Seven days of six-hour cells from the one holding `now`, every account sorted by how soon it runs out. */
  static board = (input: { readonly accounts: readonly ForecastAccountInput[]; readonly now: number }): ForecastBoard => {
    const first = startOfCell(input.now)
    const cellStarts = Array.from({ length: BOARD_CELL_COUNT }, (_, index) => {
      const date = new Date(first)
      date.setHours(date.getHours() + index * 6)
      return date.getTime()
    })
    const accounts = input.accounts
      .map(account => forecastAccount(account, cellStarts, input.now))
      .sort((left, right) => {
        const [leftGroup, leftValue] = sortKey(left)
        const [rightGroup, rightValue] = sortKey(right)
        return leftGroup - rightGroup || leftValue - rightValue
      })
    return {
      now: input.now,
      cellStarts,
      accounts,
      runsOutCount: accounts.filter(account => account.status === 'forecast' && account.window.runsOutAt !== null).length,
    }
  }

  /** Projected percent used at `at`, holding the current pace and capping at the limit. */
  static usedAt = (window: WindowForecast, at: number, now: number): number =>
    window.runsOutAt !== null && at >= window.runsOutAt ? 100 : projectedUsedAt(window, at, now)
}
