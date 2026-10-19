import type { AccountKind, UsageHistoryPoint } from './api.js'
import type { ForecastBoard } from './quota-forecast-model.js'

/** At or above this many points used, a window counts as spent. */
const SPENT_USED = 99.5
const PAST_WINDOW_LIMIT = 6
const EARLY_RESET_MS = 3_600_000
const RESET_JITTER_MS = 3_600_000

export interface PacePoint {
  /** Position in the window: 0 at its start, 1 at its reset. */
  readonly x: number
  readonly used: number
}

export interface PaceAccount {
  readonly instanceId: string
  readonly displayName: string
  readonly kind: AccountKind
  readonly label: string
  readonly used: number
  /** Where even pace would stand now: the share of the window already elapsed, in percent. */
  readonly evenNow: number
  /** Used against even pace; above 1 is ahead. */
  readonly ratio: number
  readonly x: number
  readonly startsAt: number
  readonly resetsAt: number
  readonly lengthMs: number
  readonly runsOutAt: number | null
  readonly lockedMs: number | null
  readonly usedAtReset: number | null
  readonly curve: readonly PacePoint[]
  /** From now to the reset at the projected pace, flat at the limit once spent. */
  readonly projection: readonly PacePoint[]
}

export interface PastWindow {
  readonly startsAt: number
  readonly resetsAt: number
  readonly curve: readonly PacePoint[]
  readonly finalUsed: number
  /** Where in the window it ran out, when it did. */
  readonly ranOutX: number | null
  readonly lockedMs: number | null
  /** The window restarted before its reset time, e.g. a banked reset was spent. */
  readonly endedEarly: boolean
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value))

export class QuotaPaceModel {
  /**
   * Every account whose current window has a known start and reset, on one
   * normalised window so a weekly and a monthly limit read side by side;
   * fastest against even pace first.
   */
  static current = (board: ForecastBoard): readonly PaceAccount[] =>
    board.accounts
      .flatMap(account => {
        if (account.status !== 'forecast') return []
        const window = account.window
        if (window.startsAt === null || window.resetsAt === null || window.lengthMs === null || window.elapsedFraction === null) return []
        const { startsAt, resetsAt, lengthMs } = window
        const xOf = (at: number): number => clamp01((at - startsAt) / (resetsAt - startsAt))
        const evenNow = window.elapsedFraction * 100
        const x = xOf(board.now)
        const projection =
          window.runsOutAt === null
            ? [
                { x, used: window.used },
                { x: 1, used: window.usedAtReset ?? window.used },
              ]
            : [
                { x, used: window.used },
                { x: xOf(window.runsOutAt), used: 100 },
                { x: 1, used: 100 },
              ]
        return [
          {
            instanceId: account.instanceId,
            displayName: account.displayName,
            kind: account.kind,
            label: window.label,
            used: window.used,
            evenNow,
            ratio: evenNow > 0 ? window.used / evenNow : 0,
            x,
            startsAt,
            resetsAt,
            lengthMs,
            runsOutAt: window.runsOutAt,
            lockedMs: window.lockedMs,
            usedAtReset: window.usedAtReset,
            curve: window.series.filter(point => point.at >= startsAt).map(point => ({ x: xOf(point.at), used: point.used })),
            projection,
          },
        ]
      })
      .sort((left, right) => right.ratio - left.ratio)

  /** The finished windows of one limit, newest first, each on the same 0–1 axis. */
  static pastWindows = (input: {
    readonly points: readonly UsageHistoryPoint[]
    readonly label: string
    readonly lengthMs: number
    readonly now: number
  }): readonly PastWindow[] => {
    const readings = [...input.points]
      .sort((left, right) => left.at - right.at)
      .filter(point => point.resetsAt[input.label] !== undefined && point.windows[input.label] !== undefined)
    // Providers report the same reset a few seconds apart from one reading to the next; one window, one key.
    const resets = [...new Set(readings.map(point => point.resetsAt[input.label] ?? 0))].sort((left, right) => left - right)
    const canonical = new Map<number, number>()
    let clusterStart: number | undefined
    for (const reset of resets) {
      if (clusterStart === undefined || reset - clusterStart > RESET_JITTER_MS) clusterStart = reset
      canonical.set(reset, clusterStart)
    }
    const byReset = new Map<number, UsageHistoryPoint[]>()
    for (const point of readings) {
      const reset = canonical.get(point.resetsAt[input.label] ?? 0) ?? 0
      const cycle = byReset.get(reset) ?? []
      cycle.push(point)
      byReset.set(reset, cycle)
    }
    const cycles = [...byReset.entries()].sort(([left], [right]) => left - right)
    return cycles
      .map(([resetsAt, cycle], index) => {
        const startsAt = resetsAt - input.lengthMs
        // A newer window's first reading ends this one, even before its reset time.
        const endsAt = Math.min(resetsAt, cycles[index + 1]?.[1][0]?.at ?? resetsAt)
        const used = (point: UsageHistoryPoint): number => 100 - Math.max(0, Math.min(100, point.windows[input.label] ?? 100))
        const spent = cycle.find(point => used(point) >= SPENT_USED)
        const last = cycle.at(-1)
        return {
          startsAt,
          resetsAt,
          curve: cycle.map(point => ({ x: clamp01((point.at - startsAt) / input.lengthMs), used: used(point) })),
          finalUsed: last === undefined ? 0 : used(last),
          ranOutX: spent === undefined ? null : clamp01((spent.at - startsAt) / input.lengthMs),
          lockedMs: spent === undefined ? null : Math.max(0, endsAt - spent.at),
          endedEarly: resetsAt - endsAt > EARLY_RESET_MS,
        }
      })
      .filter((window, index) => Math.min(window.resetsAt, cycles[index + 1]?.[1][0]?.at ?? window.resetsAt) <= input.now)
      .reverse()
      .slice(0, PAST_WINDOW_LIMIT)
  }
}
