/** Bounded, deduplicated refresh queue for the panel's session projections. */

export interface ProjectionRefreshQueueOptions {
  /** Reads one session's projection; the queue only decides when each id is asked for. */
  readonly refresh: (sessionId: string) => Promise<void>
  /** How many refreshes may be in flight at once. */
  readonly concurrency?: number
  /** A failed refresh is retried once after this delay. */
  readonly retryDelayMs?: number
}

export interface ProjectionRefreshQueue {
  /**
   * Ask for the projections of these sessions. Ids already queued, in flight or answered successfully are skipped;
   * `visible` ids jump ahead of the ids that are only waiting to fill the screen below the fold.
   */
  request(sessionIds: readonly string[], priority: 'visible' | 'background'): void
  /** Ids still queued or in flight, for tests and diagnostics. */
  pending(): number
  /** Drop queued work and ignore what is already in flight; the panel calls this when it unmounts. */
  cancel(): void
}

const DEFAULT_CONCURRENCY = 4
const DEFAULT_RETRY_DELAY_MS = 2_000
const MAX_ATTEMPTS = 2

export const createProjectionRefreshQueue = (options: ProjectionRefreshQueueOptions): ProjectionRefreshQueue => {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY)
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  const queued: string[] = []
  const queuedIds = new Set<string>()
  const inFlight = new Set<string>()
  const succeeded = new Set<string>()
  const attempts = new Map<string, number>()
  let cancelled = false

  const push = (sessionId: string): void => {
    queued.push(sessionId)
    queuedIds.add(sessionId)
  }

  const pump = (): void => {
    while (!cancelled && inFlight.size < concurrency && queued.length > 0) {
      const sessionId = queued.shift()
      if (sessionId === undefined) return
      queuedIds.delete(sessionId)
      if (succeeded.has(sessionId) || inFlight.has(sessionId)) continue
      inFlight.add(sessionId)
      void options
        .refresh(sessionId)
        .then(
          () => {
            succeeded.add(sessionId)
          },
          () => {
            const attempt = (attempts.get(sessionId) ?? 0) + 1
            attempts.set(sessionId, attempt)
            if (attempt >= MAX_ATTEMPTS) return
            setTimeout(() => {
              if (cancelled || succeeded.has(sessionId)) return
              push(sessionId)
              pump()
            }, retryDelayMs)
          },
        )
        .finally(() => {
          inFlight.delete(sessionId)
          pump()
        })
    }
  }

  return {
    request: (sessionIds, priority) => {
      if (cancelled) return
      const wanted = sessionIds.filter(sessionId => !succeeded.has(sessionId) && !inFlight.has(sessionId) && !queuedIds.has(sessionId))
      if (wanted.length === 0) return
      if (priority === 'visible') {
        for (const sessionId of wanted) queuedIds.add(sessionId)
        queued.unshift(...wanted)
      } else {
        for (const sessionId of wanted) push(sessionId)
      }
      pump()
    },
    pending: () => queued.length + inFlight.size,
    cancel: () => {
      cancelled = true
      queued.length = 0
      queuedIds.clear()
    },
  }
}
