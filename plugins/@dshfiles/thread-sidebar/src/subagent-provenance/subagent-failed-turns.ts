import { apiResource, createApiClient, resourceStore, subscribeApiEvent } from '@dshfiles/dshx/client'
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'
import { threadSidebarAttentionApi, type FailedTurn } from '../attention-api.js'

/**
 * The Host's failed-turn record for every subagent surface (round 21 D4): the transcript row, its run fold, the dock and
 * the phone header. The fold runs inside Chat's components, where no dshx slot context exists, so `useFailedTurns`
 * (`useResource`) would throw there. These surfaces read through a client the client entry binds once instead, on the
 * same page-wide resource store and attention event. Unbound (a test, a page without this plugin's entry), every child
 * reads as not failed: the surfaces fall back to `subagentTiming`'s Done or Stopped.
 */

const READ = { staleTime: 30_000, pollInterval: 60_000 } as const
const NONE: ReadonlyMap<string, FailedTurn> = new Map()

const createClient = (ctx: Parameters<typeof createApiClient>[0]) => createApiClient(ctx, threadSidebarAttentionApi)
type AttentionClient = ReturnType<typeof createClient>

let bound: { readonly client: AttentionClient; readonly key: string } | undefined
const noSubscription = (): (() => void) => () => undefined
const noSnapshot = (): undefined => undefined

export const SubagentFailedTurns = {
  /** Bind the entry's client; returns the unbind for the entry's disposal. */
  bind(ctx: Parameters<typeof createApiClient>[0]): () => void {
    const client = createClient(ctx)
    const key = apiResource({ client, method: 'failedTurns', input: undefined, options: READ })
    const binding = { client, key }
    bound = binding
    const unsubscribe = subscribeApiEvent(client, 'changed', { onEvent: () => void resourceStore().ensure(key, { force: true }).catch(() => undefined) })
    return () => {
      unsubscribe()
      if (bound === binding) bound = undefined
    }
  },
}

/** Children whose last finished turn failed, by session id. */
export const useSubagentFailedTurns = (): ReadonlyMap<string, FailedTurn> => {
  const binding = bound
  const store = resourceStore()
  const subscribe = useCallback(
    (listener: () => void) => {
      if (binding === undefined) return noSubscription()
      const subscription = store.subscribe(binding.key, listener)
      return () => subscription()
    },
    [binding, store],
  )
  const snapshot = useSyncExternalStore(
    subscribe,
    binding === undefined ? noSnapshot : () => store.getSnapshot<{ readonly sessions: readonly FailedTurn[] }>(binding.key),
  )
  const sessions = snapshot?.data?.sessions
  // Read once when the first surface mounts after the entry bound; the poll and the event keep it current.
  useEffect(() => {
    if (binding !== undefined) void store.ensure(binding.key).catch(() => undefined)
  }, [binding, store])
  return useMemo(() => (sessions === undefined || sessions.length === 0 ? NONE : new Map(sessions.map(turn => [turn.sessionId, turn]))), [sessions])
}
