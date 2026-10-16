import { useApi, useApiQuery } from '@dshfiles/dshx/client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { threadSidebarAttentionApi, type ThreadAttentionMigrationEntry, type ThreadAttentionSnapshot, type ThreadAttentionView } from './attention-api.js'

export interface ThreadAttentionState {
  /** True once the Host served a snapshot; an older Host without this API leaves attention unavailable. */
  readonly available: boolean
  readonly records: ReadonlyMap<string, ThreadAttentionView>
  readonly acknowledge: (sessionId: string, version: number) => void
  readonly clearUnread: (sessionId: string, version: number) => void
  readonly markUnread: (sessionId: string) => void
  /** Resolves once the Host stored the records; rejects so a caller can keep its own copy for a retry. */
  readonly migrate: (entries: readonly ThreadAttentionMigrationEntry[]) => Promise<void>
  readonly refresh: () => void
}

/**
 * Threads the user has not acknowledged yet, read from the Host. Every browser,
 * plugin and CLI shares one record, so acknowledging in one tab clears it everywhere.
 */
export const useThreadAttention = (options: { readonly enabled: boolean }): ThreadAttentionState => {
  const api = useApi(threadSidebarAttentionApi)
  const query = useApiQuery(threadSidebarAttentionApi, 'state', { enabled: options.enabled })
  const [snapshot, setSnapshot] = useState<ThreadAttentionSnapshot | null>(null)
  const revision = useRef(0)

  const adopt = useCallback((next: ThreadAttentionSnapshot) => {
    if (next.revision < revision.current) return
    revision.current = next.revision
    setSnapshot(next)
  }, [])

  useEffect(() => {
    if (query.data !== undefined) adopt(query.data)
  }, [adopt, query.data])

  // A write answers with the state it produced; a read that started earlier must not replace it.
  const mutate = useCallback(
    async (call: () => Promise<ThreadAttentionSnapshot>): Promise<void> => {
      adopt(await call())
    },
    [adopt],
  )

  const acknowledge = useCallback(
    (sessionId: string, version: number) => {
      void mutate(() => api.acknowledge({ sessionId, version })).catch(() => undefined)
    },
    [api, mutate],
  )
  const clearUnread = useCallback(
    (sessionId: string, version: number) => {
      void mutate(() => api.clearUnread({ sessionId, version })).catch(() => undefined)
    },
    [api, mutate],
  )
  const markUnread = useCallback(
    (sessionId: string) => {
      void mutate(() => api.markUnread({ sessionId })).catch(() => undefined)
    },
    [api, mutate],
  )
  const migrate = useCallback((entries: readonly ThreadAttentionMigrationEntry[]) => mutate(() => api.migrate({ entries: [...entries] })), [api, mutate])

  const records = useMemo(() => new Map((snapshot?.sessions ?? []).map(view => [view.sessionId, view])), [snapshot])
  return { available: snapshot !== null, records, acknowledge, clearUnread, markUnread, migrate, refresh: query.refetch }
}
