import { useApi } from '@dshfiles/dshx/client'
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { threadSidebarAttentionApi, type ThreadAttentionMigrationEntry, type ThreadAttentionView } from './attention-api.js'
import { sharedThreadAttentionStore, threadAttentionViews } from './attention-client-store.js'

export interface ThreadAttentionState {
  /** True once the Host served a snapshot; an older Host without this API leaves attention unavailable. */
  readonly available: boolean
  /** The loaded Host does not serve this API, so no retry can succeed. */
  readonly ownerMissing: boolean
  readonly records: ReadonlyMap<string, ThreadAttentionView>
  /** The same records in Host order, for surfaces that filter or sort them. */
  readonly views: readonly ThreadAttentionView[]
  readonly acknowledge: (sessionId: string, version: number) => void
  readonly clearUnread: (sessionId: string, version: number) => void
  readonly clearUnreadMany: (entries: readonly { readonly sessionId: string; readonly version: number }[]) => void
  readonly markUnread: (sessionId: string) => void
  readonly markUnreadMany: (sessionIds: readonly string[]) => void
  /** Resolves once the Host stored the records; rejects so a caller can keep its own copy for a retry. */
  readonly migrate: (entries: readonly ThreadAttentionMigrationEntry[]) => Promise<void>
  readonly refresh: () => void
}

/**
 * Threads the user has not acknowledged yet, read from the Host. Every browser,
 * plugin and CLI shares one record, so acknowledging in one tab clears it everywhere.
 * Surfaces on the same page share one slow poll through a page-wide store instead of
 * each adding an interval for the same snapshot.
 */
export const useThreadAttention = (options: { readonly enabled: boolean }): ThreadAttentionState => {
  const api = useApi(threadSidebarAttentionApi)
  const store = sharedThreadAttentionStore()
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  useEffect(() => {
    if (!options.enabled) return
    return store.attach(api)
  }, [api, options.enabled, store])

  const acknowledge = useCallback(
    (sessionId: string, version: number) => {
      void store.acknowledge(sessionId, version).catch(() => undefined)
    },
    [store],
  )
  const clearUnread = useCallback(
    (sessionId: string, version: number) => {
      void store.clearUnread(sessionId, version).catch(() => undefined)
    },
    [store],
  )
  const clearUnreadMany = useCallback(
    (entries: readonly { readonly sessionId: string; readonly version: number }[]) => {
      void store.clearUnreadMany(entries).catch(() => undefined)
    },
    [store],
  )
  const markUnread = useCallback(
    (sessionId: string) => {
      void store.markUnread(sessionId).catch(() => undefined)
    },
    [store],
  )
  const markUnreadMany = useCallback(
    (sessionIds: readonly string[]) => {
      void store.markUnreadMany(sessionIds).catch(() => undefined)
    },
    [store],
  )
  const migrate = useCallback((entries: readonly ThreadAttentionMigrationEntry[]) => store.migrate(entries), [store])
  const refresh = useCallback(() => {
    void store.refresh()
  }, [store])

  const views = useMemo(() => threadAttentionViews(state.snapshot), [state.snapshot])
  const records = useMemo(() => new Map(views.map(view => [view.sessionId, view])), [views])
  return {
    available: state.snapshot !== null,
    ownerMissing: state.ownerMissing,
    records,
    views,
    acknowledge,
    clearUnread,
    clearUnreadMany,
    markUnread,
    markUnreadMany,
    migrate,
    refresh,
  }
}
