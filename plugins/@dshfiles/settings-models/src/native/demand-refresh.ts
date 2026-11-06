/** Refresh a page store once per burst of Host changes, and only while a surface shows its state. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'

const REFRESH_QUIET_MS = 50
const REFRESH_MAX_WAIT_MS = 250

/** The store surfaces bind and the trigger Host change events call. */
export interface DemandRefresh<State> {
  /** The store every surface binds: subscribing to it is what counts as showing the page. */
  readonly observed: SnapshotStore<State>
  /** A Host change: refresh once the burst goes quiet (50 ms, at most 250 ms after it began) while shown, otherwise on the next show. */
  readonly request: () => void
  readonly dispose: () => void
}

/**
 * One settings write announces several events within milliseconds, and a page's store outlives the surfaces that show
 * it; refreshing per event kept re-reading Host state for a page nobody had open.
 * @param input - the store surfaces bind, the refresh to run, and whether the store starts out unread.
 * @returns the observed store and the change trigger.
 */
export const createDemandRefresh = <State>(input: {
  readonly store: SnapshotStore<State>
  readonly refresh: () => void
  readonly stale?: boolean
}): DemandRefresh<State> => {
  let observers = 0
  let stale = input.stale ?? false
  let pending: ReturnType<typeof setTimeout> | undefined
  let burstStartedAt: number | undefined
  const run = (): void => {
    pending = undefined
    burstStartedAt = undefined
    if (observers === 0) {
      stale = true
      return
    }
    stale = false
    input.refresh()
  }
  const schedule = (delayMs: number): void => {
    pending ??= setTimeout(run, delayMs)
  }
  // One write's events can arrive spread over more than one window on a busy page, so wait for the burst to go quiet.
  const request = (): void => {
    const now = performance.now()
    burstStartedAt ??= now
    if (pending !== undefined) clearTimeout(pending)
    pending = setTimeout(run, Math.max(0, Math.min(REFRESH_QUIET_MS, burstStartedAt + REFRESH_MAX_WAIT_MS - now)))
  }
  const observed: SnapshotStore<State> = {
    ...input.store,
    subscribe: (listener) => {
      observers += 1
      const unsubscribe = input.store.subscribe(listener)
      // Showing is not a burst: read on the next task, which still folds a StrictMode double subscribe into one.
      if (stale) schedule(0)
      return () => {
        observers -= 1
        unsubscribe()
      }
    },
  }
  return {
    observed,
    request,
    dispose: () => {
      if (pending !== undefined) clearTimeout(pending)
    },
  }
}
