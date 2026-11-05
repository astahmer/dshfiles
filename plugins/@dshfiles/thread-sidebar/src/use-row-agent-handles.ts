import { agentsApi } from '@dshfiles/agents/contract'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { useApiQuery } from '@dshfiles/dshx/client'
import { useCallback, useEffect, useMemo } from 'react'

/** Dispatches from other pages and the agent tool show up on the next read; a page's own dispatch is rare enough to wait. */
const REFRESH_MS = 60_000

/**
 * The `@handle` of the configured agent that started each thread, from the agents plugin's registry. agents sits below
 * this plugin (thread-sidebar → jj-integration → memory → agents), so the sidebar reads its published contract rather
 * than taking a contribution: agents depending on the sidebar would close a cycle. Without agents, or on a Host that
 * predates `threadHandles`, the lookup is empty and rows keep the preset chip.
 */
export const useRowAgentHandles = (): ((sessionId: string) => string | undefined) => {
  const query = useApiQuery(agentsApi, 'threadHandles')
  const refetch = query.refetch
  const ownerMissing = query.error !== null && isApiOwnerMissing(query.error)
  useEffect(() => {
    if (ownerMissing) return
    const timer = globalThis.setInterval(() => void refetch(), REFRESH_MS)
    return () => globalThis.clearInterval(timer)
  }, [ownerMissing, refetch])
  const handles = useMemo(() => new Map((query.data?.threads ?? []).map(thread => [thread.sessionId, thread.handle])), [query.data])
  return useCallback((sessionId: string) => handles.get(sessionId), [handles])
}
