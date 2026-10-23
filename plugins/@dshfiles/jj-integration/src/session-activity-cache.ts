import { setTimeout as settleAfter } from 'node:timers/promises'
import { ThreadRebaseEligibilityModel, type ThreadSessionActivity } from './thread-rebase-eligibility.js'

export type SessionActivity = ReadonlyMap<string, ThreadSessionActivity>

interface WorkspaceSessionProjections {
  readonly title?: string | null | undefined
  readonly userQuestions?: { readonly active: readonly unknown[] } | null | undefined
  readonly sessionListMetadata?: { readonly blank: boolean } | null | undefined
}

const WORKSPACE_ACTIVITY_READ_CONCURRENCY = 4

export const readWorkspaceSessionActivity = async (input: {
  readonly sessionIds: readonly string[]
  readonly signal: AbortSignal
  readonly getRunning: (sessionId: string) => boolean | undefined
  readonly readProjections: (sessionId: string, signal: AbortSignal) => Promise<{ readonly values: WorkspaceSessionProjections } | null>
  readonly readFallback?: (sessionIds: readonly string[], signal: AbortSignal) => Promise<SessionActivity | undefined>
}): Promise<SessionActivity> => {
  const activity = new Map<string, ThreadSessionActivity>()
  const sessionIds = [...new Set(input.sessionIds)]
  let nextIndex = 0
  const unavailableSessionIds: string[] = []
  const readNext = async (): Promise<void> => {
    while (nextIndex < sessionIds.length) {
      input.signal.throwIfAborted()
      const sessionId = sessionIds[nextIndex]
      if (sessionId === undefined) return
      nextIndex += 1
      try {
        const projections = await input.readProjections(sessionId, input.signal)
        input.signal.throwIfAborted()
        activity.set(
          sessionId,
          projections === null
            ? { running: undefined, pendingUserQuestion: undefined }
            : {
                running: input.getRunning(sessionId),
                pendingUserQuestion: ThreadRebaseEligibilityModel.hasPendingUserQuestion(
                  projections.values.userQuestions == null ? undefined : { userQuestions: projections.values.userQuestions },
                ),
                title: projections.values.title ?? undefined,
                blank: projections.values.sessionListMetadata?.blank,
              },
        )
      } catch (error) {
        input.signal.throwIfAborted()
        if (error instanceof Error && error.name === 'AbortError') throw error
        unavailableSessionIds.push(sessionId)
        activity.set(sessionId, { running: undefined, pendingUserQuestion: undefined })
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(WORKSPACE_ACTIVITY_READ_CONCURRENCY, sessionIds.length) }, () => readNext()))
  input.signal.throwIfAborted()
  if (unavailableSessionIds.length > 0 && input.readFallback !== undefined) {
    try {
      const fallbackActivity = await input.readFallback(unavailableSessionIds, input.signal)
      input.signal.throwIfAborted()
      for (const sessionId of unavailableSessionIds) {
        const fallback = fallbackActivity?.get(sessionId)
        if (fallback !== undefined) activity.set(sessionId, fallback)
      }
    } catch {
      input.signal.throwIfAborted()
    }
  }
  return activity
}

/** A resolved read, tagged so a caller can tell "nothing came back yet" from "the read came back empty". */
type Settled<Value> = { readonly value: Value }
type ActivityScan = { readonly promise: Promise<SessionActivity | undefined> }

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
 * Display and repository-wide cleanup share a bounded full-store read and keep serving the last good value. A rebase
 * guard can instead use a workspace-scoped reader, so one thread's eligibility never waits for unrelated Sessions.
 * Both guard paths keep waiting on one authoritative read across budgets instead of restarting completed work.
 */
export const createSessionActivityCache = (options: {
  readonly read: (signal: AbortSignal) => Promise<SessionActivity | undefined>
  readonly readGuard?: (sessionIds: readonly string[], signal: AbortSignal) => Promise<SessionActivity | undefined>
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
  let guardScan: ActivityScan | undefined
  const workspaceGuardScans = new Map<string, ActivityScan>()

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

  const beginGuardScan = (): ActivityScan => {
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
  const beginWorkspaceGuardScan = (sessionIds: readonly string[]): ActivityScan => {
    const key = JSON.stringify([...new Set(sessionIds)].sort())
    const existing = workspaceGuardScans.get(key)
    if (existing !== undefined) return existing
    const promise =
      options.readGuard?.(sessionIds, AbortSignal.timeout(options.guardCeilingMs)).then(
        value => value,
        () => undefined,
      ) ?? Promise.resolve(undefined)
    const scan = { promise }
    workspaceGuardScans.set(key, scan)
    void promise.then(() => {
      if (workspaceGuardScans.get(key) === scan) workspaceGuardScans.delete(key)
    })
    return scan
  }

  const guard = async (sessionIds?: readonly string[]): Promise<SessionActivity | undefined> => {
    let lastAnswer: SessionActivity | undefined
    for (let attempt = 1; attempt <= options.guardAttempts; attempt += 1) {
      const scan = sessionIds === undefined ? beginGuardScan() : beginWorkspaceGuardScan(sessionIds)
      const settled = await settleWithin(scan.promise, options.guardBudgetMs)
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
