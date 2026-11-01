import type { ApiClient, ApiContract } from '@dshfiles/dshx/api'
import { queryOptions } from '@dshfiles/plugin-ui/query'
import * as Schema from 'effect/Schema'
import { servingAccountApi, servingAccountSnapshotSchema, type ServingAccountSnapshot } from './serving-account-api.js'

type ServingAccountClient = typeof servingAccountApi extends ApiContract<infer Methods> ? ApiClient<Methods> : never

export const servingAccountPollInterval = (running: boolean, snapshot: ServingAccountSnapshot | null | undefined): number | false =>
  running && snapshot !== null ? 1500 : false

export const servingAccountQuery = (client: Pick<ServingAccountClient, 'snapshot'>, sessionId: string | null, running: boolean) =>
  queryOptions({
    // Running/idle transitions force a new read; inactive queries retain no previous-turn attempts.
    queryKey: ['ai-accounts', 'serving-account', sessionId, running] as const,
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
    gcTime: 0,
    staleTime: 0,
  })
