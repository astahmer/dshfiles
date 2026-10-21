import { setTimeout as settleAfter } from 'node:timers/promises'
import type { ThreadSessionActivity } from './thread-rebase-eligibility.js'

export type SessionActivity = ReadonlyMap<string, ThreadSessionActivity>

/** A resolved read, tagged so a caller can tell "nothing came back yet" from "the read came back empty". */
type Settled<Value> = { readonly value: Value }

const readWithin = async (read: (signal: AbortSignal) => Promise<SessionActivity | undefined>, budgetMs: number): Promise<SessionActivity | undefined> => {
  try {
    return await read(AbortSignal.timeout(budgetMs))
  } catch {
    return undefined
  }
}

/** Waits for one read no longer than a budget without cancelling it, so the work already done is kept. */
const settleWithin = async <Value>(promise: Promise<Value>, budgetMs: number): Promise<Settled<Value> | undefined> =>
  await Promise.race([promise.then(value => ({ value })), settleAfter(budgetMs, undefined, { ref: false })])

/**
 * The Host's Session list folds every stored Session's projections, which costs seconds on a large store and is what
 * the guard, the sidebar and the repository scan all read. Display reads therefore share one bounded background read
 * and keep serving the last good value. The rebase guard instead waits on one authoritative read for several budgets:
 * restarting the fold after an impatient abort would discard the work that was nearly done, and "could not verify"
 * would keep refusing a rebase on a Host that is merely busy.
 */
export const createSessionActivityCache = (options: {
  readonly read: (signal: AbortSignal) => Promise<SessionActivity | undefined>
  readonly ttlMs: number
  readonly displayBudgetMs: number
  /** How long one guard attempt waits on the authoritative read before it waits again. */
  readonly guardBudgetMs: number
  /** Bounded waits one guard accepts; every attempt keeps waiting on the same read. */
  readonly guardAttempts: number
  /** Hard ceiling for one authoritative read, so a stuck read cannot answer every later guard with unknown. */
  readonly guardCeilingMs: number
  readonly now?: () => number
}) => {
  const now = options.now ?? Date.now
  let cached: { readonly value: SessionActivity; readonly at: number } | undefined
  let displayScan: Promise<SessionActivity | undefined> | undefined
  let guardScan: { readonly promise: Promise<SessionActivity | undefined> } | undefined

  const publish = (value: SessionActivity | undefined): SessionActivity | undefined => {
    if (value !== undefined) cached = { value, at: now() }
    return value
  }

  const refresh = (): Promise<SessionActivity | undefined> => {
    if (displayScan !== undefined) return displayScan
    const scan = readWithin(options.read, options.displayBudgetMs).then(publish)
    displayScan = scan
    return scan.finally(() => {
      if (displayScan === scan) displayScan = undefined
    })
  }

  /** A value within its TTL, otherwise the last good value while one bounded read refreshes it. */
  const display = async (): Promise<SessionActivity | undefined> => {
    // oxlint-disable-next-line antislop/no-passthrough-variable -- Snapshot before the background refresh replaces the cache, so the returned value matches the freshness check that selected it.
    const current = cached
    if (current === undefined) return await refresh()
    if (now() - current.at < options.ttlMs) return current.value
    void refresh()
    return current.value
  }

  const beginGuardScan = (): { readonly promise: Promise<SessionActivity | undefined> } => {
    if (guardScan !== undefined) return guardScan
    const promise = options.read(AbortSignal.timeout(options.guardCeilingMs)).then(publish, () => undefined)
    const scan = { promise }
    guardScan = scan
    void promise.then(() => {
      if (guardScan === scan) guardScan = undefined
    })
    return scan
  }

  /**
   * Bypasses the cache: the guard must read activity the moment it decides. A read that outlives one budget is awaited
   * again rather than restarted, so the fold keeps its progress and only a store that stays unreadable answers unknown.
   */
  const guard = async (): Promise<SessionActivity | undefined> => {
    let lastAnswer: SessionActivity | undefined
    for (let attempt = 1; attempt <= options.guardAttempts; attempt += 1) {
      const settled = await settleWithin(beginGuardScan().promise, options.guardBudgetMs)
      if (settled === undefined) continue
      lastAnswer = settled.value
      if (lastAnswer !== undefined) return lastAnswer
    }
    return lastAnswer
  }

  const reset = (): void => {
    cached = undefined
  }

  return { display, guard, reset }
}
