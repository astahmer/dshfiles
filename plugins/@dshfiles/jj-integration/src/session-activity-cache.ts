import type { ThreadSessionActivity } from './thread-rebase-eligibility.js'

export type SessionActivity = ReadonlyMap<string, ThreadSessionActivity>

const snapshotActivity = async (read: (budgetMs: number) => Promise<SessionActivity | undefined>, budgetMs: number): Promise<SessionActivity | undefined> => {
  try {
    return await read(budgetMs)
  } catch {
    return undefined
  }
}

/**
 * The Host's Session list folds every stored Session's projections, which costs seconds on a large store and is what
 * the guard, the sidebar and the repository scan all read. Display reads therefore share one bounded background read
 * and keep serving the last good value, while the rebase guard asks for a fresh read so a stale idle bit can never
 * authorize a rebase.
 */
export const createSessionActivityCache = (options: {
  readonly read: (budgetMs: number) => Promise<SessionActivity | undefined>
  readonly ttlMs: number
  readonly displayBudgetMs: number
  readonly guardBudgetMs: number
  readonly now?: () => number
}) => {
  const now = options.now ?? Date.now
  let cached: { readonly value: SessionActivity; readonly at: number } | undefined
  let displayScan: Promise<SessionActivity | undefined> | undefined
  let guardScan: Promise<SessionActivity | undefined> | undefined

  const publish = (value: SessionActivity | undefined): SessionActivity | undefined => {
    if (value !== undefined) cached = { value, at: now() }
    return value
  }

  const refresh = (): Promise<SessionActivity | undefined> => {
    if (displayScan !== undefined) return displayScan
    const scan = snapshotActivity(options.read, options.displayBudgetMs).then(publish)
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

  /** Bypasses the cache: the guard must read activity the moment it decides, and reports unknown when it cannot. */
  const guard = async (): Promise<SessionActivity | undefined> => {
    if (guardScan !== undefined) return guardScan
    const scan = snapshotActivity(options.read, options.guardBudgetMs).then(publish)
    guardScan = scan
    return scan.finally(() => {
      if (guardScan === scan) guardScan = undefined
    })
  }

  const reset = (): void => {
    cached = undefined
  }

  return { display, guard, reset }
}
