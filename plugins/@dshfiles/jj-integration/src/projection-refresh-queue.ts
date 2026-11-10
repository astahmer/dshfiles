/** Bounded, deduplicated refresh queue for the panel's session projections. */

export interface ProjectionRefreshQueueOptions {
  /**
   * Reads one session's projection; the queue only decides when each id is asked for. The signal aborts when the
   * queue is cancelled, so an abortable read stops and an un-abortable one only has its result ignored.
   */
  readonly refresh: (sessionId: string, signal: AbortSignal) => Promise<void>
  /** How many refreshes may be in flight at once. */
  readonly concurrency?: number
  /** A failed refresh is retried once after this delay. */
  readonly retryDelayMs?: number
}

export interface ProjectionRefreshQueue {
  /**
   * Ask for the projections of these sessions. Ids already queued, in flight, waiting for a retry, answered or given
   * up are skipped; `visible` ids jump ahead of the ids that are only waiting to fill the screen below the fold.
   */
  request(sessionIds: readonly string[], priority: 'visible' | 'background'): void
  /** Ids still queued, waiting for a retry or in flight, for tests and diagnostics. */
  pending(): number
  /** Drop queued work, stop retries and abort what is in flight; the panel calls this when it unmounts. */
  cancel(): void
}

/** One id's place in the queue: waiting, refreshing, waiting for a retry, or done with it for good. */
export type ProjectionRefreshState =
  | { readonly _tag: 'queued'; readonly priority: 'visible' | 'background'; readonly attempts: number }
  | { readonly _tag: 'refreshing'; readonly controller: AbortController; readonly attempt: number }
  | { readonly _tag: 'retry-wait'; readonly attempts: number; readonly cancel: () => void }
  | { readonly _tag: 'succeeded' }
  | { readonly _tag: 'failed' }
  | { readonly _tag: 'cancelled' }

type RefreshingState = Extract<ProjectionRefreshState, { readonly _tag: 'refreshing' }>

const DEFAULT_CONCURRENCY = 4
const DEFAULT_RETRY_DELAY_MS = 2_000
const MAX_ATTEMPTS = 2

const isPending = (state: ProjectionRefreshState | undefined): boolean =>
  state !== undefined && (state._tag === 'queued' || state._tag === 'refreshing' || state._tag === 'retry-wait')

export const createProjectionRefreshQueue = (options: ProjectionRefreshQueueOptions): ProjectionRefreshQueue => {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY)
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS
  const queue: string[] = []
  const states = new Map<string, ProjectionRefreshState>()
  let cancelled = false

  const inFlight = (): number => {
    let count = 0
    for (const state of states.values()) if (state._tag === 'refreshing') count += 1
    return count
  }

  const pump = (): void => {
    if (cancelled) return
    while (inFlight() < concurrency) {
      const sessionId = queue.shift()
      if (sessionId === undefined) return
      const queued = states.get(sessionId)
      if (queued?._tag !== 'queued') continue
      const refreshing: RefreshingState = {
        _tag: 'refreshing',
        controller: new AbortController(),
        attempt: queued.attempts + 1,
      }
      states.set(sessionId, refreshing)
      void options
        .refresh(sessionId, refreshing.controller.signal)
        .then(
          () => {
            if (states.get(sessionId) !== refreshing) return
            states.set(sessionId, { _tag: 'succeeded' })
          },
          () => {
            if (states.get(sessionId) !== refreshing) return
            if (refreshing.attempt >= MAX_ATTEMPTS) {
              states.set(sessionId, { _tag: 'failed' })
              return
            }
            const timer = setTimeout(() => {
              if (states.get(sessionId)?._tag !== 'retry-wait') return
              states.set(sessionId, { _tag: 'queued', priority: 'background', attempts: refreshing.attempt })
              queue.push(sessionId)
              pump()
            }, retryDelayMs)
            states.set(sessionId, { _tag: 'retry-wait', attempts: refreshing.attempt, cancel: () => clearTimeout(timer) })
          },
        )
        .finally(() => {
          if (states.get(sessionId) === refreshing) states.set(sessionId, { _tag: 'cancelled' })
          pump()
        })
    }
  }

  return {
    request: (sessionIds, priority) => {
      if (cancelled) return
      const wanted = [...new Set(sessionIds)].filter(sessionId => {
        const state = states.get(sessionId)
        return state === undefined || state._tag === 'cancelled'
      })
      if (wanted.length === 0) return
      for (const sessionId of wanted) states.set(sessionId, { _tag: 'queued', priority, attempts: 0 })
      if (priority === 'visible') queue.unshift(...wanted)
      else queue.push(...wanted)
      pump()
    },
    pending: () => {
      let count = 0
      for (const state of states.values()) if (isPending(state)) count += 1
      return count
    },
    cancel: () => {
      cancelled = true
      queue.length = 0
      for (const [sessionId, state] of states) {
        if (state._tag === 'refreshing') state.controller.abort()
        if (state._tag === 'retry-wait') state.cancel()
        if (isPending(state)) states.set(sessionId, { _tag: 'cancelled' })
      }
    },
  }
}
