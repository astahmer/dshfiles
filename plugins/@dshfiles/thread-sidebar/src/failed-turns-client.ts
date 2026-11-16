import { useApiEvent, useResource } from '@dshfiles/dshx/client'
import { useMemo } from 'react'
import { threadSidebarAttentionApi, type FailedTurn } from './attention-api.js'

const FAILED_TURNS_READ = { staleTime: 30_000, pollInterval: 60_000 } as const
const NONE: ReadonlyMap<string, FailedTurn> = new Map()

/**
 * Threads whose last finished turn failed, read from the Host and re-read when it announces an attention change (every
 * finished turn does). A Host that predates the method answers an error: the list is then empty, as before it existed.
 */
export const useFailedTurns = (options: { readonly enabled: boolean }): ReadonlyMap<string, FailedTurn> => {
  const resource = useResource(threadSidebarAttentionApi, 'failedTurns', undefined, { ...FAILED_TURNS_READ, enabled: options.enabled })
  useApiEvent(threadSidebarAttentionApi, 'changed', () => {
    if (options.enabled) resource.refetch()
  })
  const sessions = resource.data?.sessions
  return useMemo(() => (sessions === undefined || sessions.length === 0 ? NONE : new Map(sessions.map(turn => [turn.sessionId, turn]))), [sessions])
}
