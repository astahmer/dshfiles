import { defineApi, method } from '@dshfiles/dshx/api'

export type OptmemRoute = { readonly provider: string; readonly model: string; readonly effort: string | null }

/** What the settings panel shows about the running memory; every field degrades to null instead of failing the call. */
export type OptmemOverview = {
  readonly state: 'off' | 'starting' | 'ready' | 'failed'
  readonly failure: string | null
  readonly requestedMode: 'compatibility' | 'full'
  readonly activeMode: 'compatibility' | 'full'
  /** The fork core marker: the agent loop dispatches `agent/request-messages`, so full mode can run. */
  readonly fullModeAvailable: boolean
  readonly settingsSource: 'entry' | 'defaults'
  readonly database: { readonly path: string; readonly bytes: number | null }
  readonly events: number | null
  readonly streams: number | null
  readonly summaryCalls: number | null
  readonly pendingSummaries: number | null
  readonly pendingMerges: number | null
  readonly captured: number
  readonly skipped: number
  readonly queued: number
  readonly lastRoute:
    | { readonly kind: 'unresolved' }
    | { readonly kind: 'ready'; readonly source: 'override' | 'account' | 'fallback'; readonly route: OptmemRoute; readonly conversationId: string }
    | { readonly kind: 'unavailable'; readonly reason: string; readonly conversationId: string }
  /** The error behind summaries still failing, else the last capture error; cleared once summaries recover. */
  readonly lastError: string | null
  readonly retryInMs: number | null
}

export type OptmemProvider = { readonly id: string; readonly name: string; readonly kind: string | null; readonly models: readonly string[] }

/**
 * Settings panel contract. Added after the Host-only release: a Host started before it answers with an unknown-endpoint
 * error, which the panel shows as "restart to load".
 */
export const optmemApi = defineApi({
  id: 'dshfiles-optmem',
  version: 1,
  methods: {
    overview: method<void, OptmemOverview>(),
    providers: method<void, readonly OptmemProvider[]>(),
    backfill: method<{ readonly limit: number }, { readonly text: string }>(),
  },
})
