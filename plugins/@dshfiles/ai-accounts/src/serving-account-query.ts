import type { ApiClient, ApiContract } from '@dshfiles/dshx/api'
import { queryOptions } from '@dshfiles/plugin-ui/query'
import * as Schema from 'effect/Schema'
import { servingAccountApi, servingAccountSnapshotSchema, type ServingAccountSnapshot } from './serving-account-api.js'

type ServingAccountClient = typeof servingAccountApi extends ApiContract<infer Methods> ? ApiClient<Methods> : never

export const servingAccountPollInterval = (running: boolean, snapshot: ServingAccountSnapshot | null | undefined): number | false =>
  running && snapshot !== null ? 1500 : false

/** Idle snapshots of chats visited earlier stay cached this long; a later turn changes the key anyway. */
const IDLE_SNAPSHOT_GC_MS = 10 * 60_000

/**
 * @param updatedAt - the Session's durable activity time. An idle snapshot only changes when a turn runs, and every
 * turn moves it, so an idle read is reused per Session version instead of refetched on each thread switch.
 */
export const servingAccountQuery = (client: Pick<ServingAccountClient, 'snapshot'>, sessionId: string | null, running: boolean, updatedAt: number | null) =>
  queryOptions({
    // Running/idle transitions force a new read; inactive queries retain no previous-turn attempts.
    queryKey: ['ai-accounts', 'serving-account', sessionId, running, running ? null : updatedAt] as const,
    queryFn: async ({ signal }): Promise<ServingAccountSnapshot | null> => {
      if (sessionId === null) return null
      try {
        const parsed = Schema.decodeUnknownResult(servingAccountSnapshotSchema)(await client.snapshot({ sessionId }, { signal }))
        if (parsed._tag === 'Failure' || parsed.success.sessionId !== sessionId) return null
        const snapshot = parsed.success
        if (snapshot.currentAttempt !== null && snapshot.currentAttempt.sessionId !== sessionId) return null
        if (snapshot.lastSuccessful !== null && snapshot.lastSuccessful.sessionId !== sessionId) return null
        return snapshot
      } catch (error) {
        if (signal.aborted) throw error
        // Old/missing Host, malformed response or unavailable storage: never infer from selected provider.
        return null
      }
    },
    enabled: sessionId !== null,
    refetchInterval: query => servingAccountPollInterval(running, query.state.data),
    refetchIntervalInBackground: false,
    retry: false,
    gcTime: running ? 0 : IDLE_SNAPSHOT_GC_MS,
    staleTime: running ? 0 : Number.POSITIVE_INFINITY,
  })
