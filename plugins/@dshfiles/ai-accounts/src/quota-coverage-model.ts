import type { AccountKind, UsageHistoryPoint } from './api.js'
import { QuotaForecastModel, type AccountForecast } from './quota-forecast-model.js'

const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS
const HOURS_PER_CELL = 6
const CELLS_PER_WEEK = 28
const HOURS_PER_WEEK = 168
/** A reading older than this no longer says what the account looked like. */
const STALE_READING_MS = 3 * HOUR_MS
const SPENT_PERCENT = 0.5
const SHORT_WINDOW = /session|5.?hour/i
const RESERVE_WINDOW = /reserve/i

export interface CoverageAccountInput {
  readonly instanceId: string
  readonly displayName: string
  readonly kind: AccountKind
  readonly points: readonly UsageHistoryPoint[]
  readonly forecast: AccountForecast | undefined
}

export interface WorkHours {
  /** `Date.getDay()` values, 0 = Sunday. */
  readonly days: readonly number[]
  readonly startHour: number
  readonly endHour: number
}

interface HourState {
  readonly at: number
  readonly known: boolean
  readonly projected: boolean
  readonly spent: boolean
  readonly used: number
  /** The long window's reset changed during this hour. */
  readonly reset: boolean
}

export type CoverageCellKind = 'use' | 'runs-out' | 'locked' | 'missing'

export interface CoverageCell {
  readonly start: number
  readonly kind: CoverageCellKind
  readonly used: number
  readonly projected: boolean
  readonly reset: boolean
}

export type FreeCellKind = 'all' | 'some' | 'none' | 'none-work' | 'missing'

export interface FreeCell {
  readonly start: number
  readonly kind: FreeCellKind
  readonly projected: boolean
}

export interface CoverageLane {
  readonly instanceId: string
  readonly displayName: string
  readonly cells: readonly CoverageCell[]
  readonly hours: readonly HourState[]
  readonly peak: number | null
  readonly firstSpentAt: number | null
}

export interface CoverageSpan {
  readonly start: number
  readonly end: number
}

export interface CoverageWeek {
  readonly start: number
  readonly current: boolean
  /** First hour with any reading, when it is after the week starts. */
  readonly dataFrom: number | null
  readonly lanes: readonly CoverageLane[]
  readonly free: readonly FreeCell[]
  readonly noneFreeWorkHours: number
  readonly coveredWorkHours: number
  readonly projectedNoneFreeWorkHours: number
  readonly longestNoneFree: CoverageSpan | null
  readonly hasData: boolean
}

export type CoverageGroup =
  | {
      readonly status: 'pool'
      readonly kind: AccountKind
      readonly accounts: readonly { readonly instanceId: string; readonly displayName: string }[]
      readonly weeks: readonly CoverageWeek[]
    }
  | {
      readonly status: 'single'
      readonly kind: AccountKind
      readonly instanceId: string
      readonly displayName: string
      readonly spentEpisodes: number
    }

export interface CoverageReport {
  readonly weekStarts: readonly number[]
  readonly groups: readonly CoverageGroup[]
}

const startOfWeek = (at: number): number => {
  const date = new Date(at)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7))
  return date.getTime()
}

const addHours = (at: number, hours: number): number => {
  const date = new Date(at)
  date.setHours(date.getHours() + hours)
  return date.getTime()
}

const isWorkHour = (at: number, workHours: WorkHours): boolean => {
  const date = new Date(at)
  return workHours.days.includes(date.getDay()) && date.getHours() >= workHours.startHour && date.getHours() < workHours.endHour
}

const quotaLabels = (point: UsageHistoryPoint): readonly string[] => Object.keys(point.windows).filter(label => !RESERVE_WINDOW.test(label))

/** The weekly or monthly figure when one exists, so a short session window does not flicker the shade. */
const longUsed = (point: UsageHistoryPoint): number => {
  const labels = quotaLabels(point)
  const long = labels.filter(label => !SHORT_WINDOW.test(label))
  const used = (long.length > 0 ? long : labels).map(label => 100 - Math.max(0, Math.min(100, point.windows[label] ?? 100)))
  return used.length === 0 ? 0 : Math.max(...used)
}

const resetSignature = (point: UsageHistoryPoint): string =>
  quotaLabels(point)
    .filter(label => !SHORT_WINDOW.test(label))
    .map(label => `${label}=${String(point.resetsAt[label] ?? '')}`)
    .join('|')

const pastHours = (points: readonly UsageHistoryPoint[], hourStarts: readonly number[], now: number): readonly HourState[] => {
  const ordered = [...points].sort((left, right) => left.at - right.at)
  let cursor = -1
  let previousSignature: string | undefined
  return hourStarts.map(at => {
    const end = at + HOUR_MS
    while (ordered[cursor + 1] !== undefined && (ordered[cursor + 1]?.at ?? Infinity) < end) cursor += 1
    const point = ordered[cursor]
    if (point === undefined || at > now || end - point.at > STALE_READING_MS + HOUR_MS) {
      return { at, known: false, projected: false, spent: false, used: 0, reset: false }
    }
    const signature = resetSignature(point)
    const reset = previousSignature !== undefined && signature !== previousSignature
    previousSignature = signature
    return {
      at,
      known: true,
      projected: false,
      spent: quotaLabels(point).some(label => (point.windows[label] ?? 100) <= SPENT_PERCENT),
      used: longUsed(point),
      reset,
    }
  })
}

const projectedHour = (at: number, forecast: AccountForecast | undefined, now: number): HourState => {
  if (forecast?.status !== 'forecast') return { at, known: false, projected: true, spent: false, used: 0, reset: false }
  const window = forecast.window
  const afterReset = window.resetsAt !== null && at >= window.resetsAt
  const used = afterReset ? 0 : QuotaForecastModel.usedAt(window, at + HOUR_MS, now)
  return {
    at,
    known: true,
    projected: true,
    spent: !afterReset && window.runsOutAt !== null && at + HOUR_MS > window.runsOutAt,
    used,
    reset: window.resetsAt !== null && window.resetsAt >= at && window.resetsAt < at + HOUR_MS,
  }
}

const laneCells = (hours: readonly HourState[]): readonly CoverageCell[] =>
  Array.from({ length: CELLS_PER_WEEK }, (_, index) => {
    const slice = hours.slice(index * HOURS_PER_CELL, (index + 1) * HOURS_PER_CELL)
    const known = slice.filter(hour => hour.known)
    const start = slice[0]?.at ?? 0
    const projected = slice.some(hour => hour.projected)
    const reset = slice.some(hour => hour.reset)
    if (known.length === 0) return { start, kind: 'missing', used: 0, projected, reset }
    const spentFrom = known.findIndex(hour => hour.spent)
    const used = Math.max(...known.map(hour => hour.used))
    if (spentFrom === -1) return { start, kind: 'use', used, projected, reset }
    const before = hours[index * HOURS_PER_CELL - 1]
    const startsSpent = spentFrom === 0 && before?.spent === true
    if (startsSpent && known.every(hour => hour.spent)) return { start, kind: 'locked', used: 100, projected, reset }
    return { start, kind: startsSpent ? 'locked' : 'runs-out', used: 100, projected, reset }
  })

const longestSpan = (hours: readonly number[]): CoverageSpan | null => {
  let best: CoverageSpan | null = null
  let runStart: number | null = null
  let previous: number | null = null
  for (const at of [...hours, Number.NaN]) {
    if (runStart !== null && previous !== null && at !== previous + HOUR_MS) {
      const span = { start: runStart, end: previous + HOUR_MS }
      if (best === null || span.end - span.start > best.end - best.start) best = span
      runStart = null
    }
    if (Number.isNaN(at)) break
    if (runStart === null) runStart = at
    previous = at
  }
  return best
}

const poolWeek = (input: {
  readonly start: number
  readonly accounts: readonly CoverageAccountInput[]
  readonly now: number
  readonly workHours: WorkHours
}): CoverageWeek => {
  const hourStarts = Array.from({ length: HOURS_PER_WEEK }, (_, index) => addHours(input.start, index))
  const current = input.now >= input.start && input.now < addHours(input.start, HOURS_PER_WEEK)
  const lanes = input.accounts.map(account => {
    const past = pastHours(account.points, hourStarts, input.now)
    const hours = past.map((hour, index) => {
      const at = hourStarts[index] ?? hour.at
      return current && at + HOUR_MS > input.now && !hour.known ? projectedHour(at, account.forecast, input.now) : hour
    })
    const known = hours.filter(hour => hour.known)
    return {
      instanceId: account.instanceId,
      displayName: account.displayName,
      hours,
      cells: laneCells(hours),
      peak: known.length === 0 ? null : Math.round(Math.max(...known.map(hour => hour.used))),
      firstSpentAt: hours.find((hour, index) => hour.spent && hours[index - 1]?.spent !== true)?.at ?? null,
    }
  })

  const noneFree: number[] = []
  let noneFreeWorkHours = 0
  let coveredWorkHours = 0
  let projectedNoneFreeWorkHours = 0
  const freeByHour = hourStarts.map((at, index) => {
    const states = lanes.map(lane => lane.hours[index]).filter((hour): hour is HourState => hour?.known === true)
    if (states.length === 0) return null
    const free = states.filter(hour => !hour.spent).length
    const work = isWorkHour(at, input.workHours)
    const projected = states.some(hour => hour.projected)
    if (free === 0) noneFree.push(at)
    if (work && free === 0 && projected) projectedNoneFreeWorkHours += 1
    else if (work && free === 0) noneFreeWorkHours += 1
    else if (work && free < lanes.length && !projected) coveredWorkHours += 1
    return { at, free, work, projected }
  })

  const free = Array.from({ length: CELLS_PER_WEEK }, (_, index): FreeCell => {
    const slice = freeByHour.slice(index * HOURS_PER_CELL, (index + 1) * HOURS_PER_CELL).filter(hour => hour !== null)
    const start = hourStarts[index * HOURS_PER_CELL] ?? input.start
    const projected = slice.some(hour => hour.projected)
    if (slice.length === 0) return { start, kind: 'missing', projected }
    const noneHours = slice.filter(hour => hour.free === 0)
    if (noneHours.some(hour => hour.work)) return { start, kind: 'none-work', projected }
    if (noneHours.length > 0) return { start, kind: 'none', projected }
    return { start, kind: slice.some(hour => hour.free < lanes.length) ? 'some' : 'all', projected }
  })

  const firstKnown = freeByHour.find(hour => hour !== null)?.at ?? null
  return {
    start: input.start,
    current,
    dataFrom: firstKnown !== null && firstKnown > input.start + DAY_MS / 4 ? firstKnown : null,
    lanes,
    free,
    noneFreeWorkHours,
    coveredWorkHours,
    projectedNoneFreeWorkHours,
    longestNoneFree: longestSpan(noneFree),
    hasData: firstKnown !== null,
  }
}

const spentEpisodes = (points: readonly UsageHistoryPoint[]): number => {
  let episodes = 0
  let spent = false
  for (const point of [...points].sort((left, right) => left.at - right.at)) {
    const now = quotaLabels(point).some(label => (point.windows[label] ?? 100) <= SPENT_PERCENT)
    if (now && !spent) episodes += 1
    spent = now
  }
  return episodes
}

export class QuotaCoverageModel {
  static readonly defaultWorkHours: WorkHours = { days: [1, 2, 3, 4, 5], startHour: 9, endHour: 18 }
  static readonly weekCount = 5

  /**
   * Whether each provider kind kept an account free, week by week. Accounts of
   * one kind cover for each other, so the pool runs dry only when every one is
   * spent at once; the current week continues each account's forecast past now.
   */
  static report = (input: { readonly accounts: readonly CoverageAccountInput[]; readonly now: number; readonly workHours?: WorkHours }): CoverageReport => {
    const workHours = input.workHours ?? QuotaCoverageModel.defaultWorkHours
    const thisWeek = startOfWeek(input.now)
    const weekStarts = Array.from({ length: QuotaCoverageModel.weekCount }, (_, index) => {
      const date = new Date(thisWeek)
      date.setDate(date.getDate() - 7 * (QuotaCoverageModel.weekCount - 1 - index))
      return date.getTime()
    })
    const kinds = [...new Set(input.accounts.map(account => account.kind))]
    const groups = kinds.map((kind): CoverageGroup => {
      const accounts = input.accounts.filter(account => account.kind === kind)
      const only = accounts[0]
      if (accounts.length === 1 && only !== undefined) {
        return { status: 'single', kind, instanceId: only.instanceId, displayName: only.displayName, spentEpisodes: spentEpisodes(only.points) }
      }
      return {
        status: 'pool',
        kind,
        accounts: accounts.map(account => ({ instanceId: account.instanceId, displayName: account.displayName })),
        weeks: weekStarts.map(start => poolWeek({ start, accounts, now: input.now, workHours })),
      }
    })
    return {
      weekStarts,
      groups: groups.sort((left, right) => (left.status === right.status ? 0 : left.status === 'pool' ? -1 : 1)),
    }
  }
}
