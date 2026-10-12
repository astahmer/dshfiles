import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'

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
  /** Stream entries, not unique captured event rows. */
  readonly events: number | null
  readonly uniqueEvents?: number | null
  readonly streams: number | null
  /** Summary calls since this engine instance started. */
  readonly summaryCalls: number | null
  /** Legacy in-memory job count. Use pendingLeafJobs and pendingMergeJobs for precise labels. */
  readonly pendingSummaries: number | null
  readonly pendingMerges: number | null
  readonly pipeline?: {
    readonly pendingLeafJobs: number
    readonly pendingEvents: number
    readonly estimatedLeafSummaryCalls: number
    readonly pendingMergeJobs: number
    readonly oldestPendingAt: number | null
    readonly completedSummaryNodes: number
    readonly summariesLastTenMinutes: number
    readonly paused: boolean
    readonly health: 'off' | 'starting' | 'paused' | 'processing' | 'waiting' | 'degraded' | 'idle'
    /** Positions the injected main view covers, against the whole stream: the backlog progress measure. */
    readonly viewThroughPos: number
    readonly streamLength: number
    /** Newest model-produced node, so a stalled stream is distinguishable from an idle one. */
    readonly lastSummaryAt: number | null
    /** Nodes materialized from clipped head+tail text after repeated summary failure. */
    readonly unsummarizedNodes: number
    /** Summary nodes per ten minutes across every stream, for a project-versus-global comparison. */
    readonly globalSummariesLastTenMinutes: number
    readonly failedJobs: number
    readonly retryingJobs: number
    /** Why the last summary step failed; null once nothing is failing. */
    readonly lastError: string | null
    readonly fallbacks: number
    readonly callsLastMinute: number
    readonly rateLimitPerMinute: number
    readonly catchUpIntervalMs: number
    readonly catchUpLastScanAt: number | null
  }
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

export type OptmemProject = {
  readonly projectId: string
  readonly title: string
  readonly path: string | null
  readonly registered: boolean
  readonly eventCount: number
}

export type OptmemExplorerNode = {
  readonly address: string
  readonly text: string
  readonly bytes: number
  readonly model: string
  readonly createdAt: number
}

export type OptmemExplorerZoom =
  | {
      readonly kind: 'node'
      readonly address: string
      readonly lines: readonly string[]
      readonly text: string
      readonly bytes: number
      readonly model: string
      readonly createdAt: number
      readonly parentAddress: string | null
      readonly childAddresses: readonly string[]
      readonly sources: readonly { readonly eventId: number; readonly conversationId: string; readonly role: string; readonly createdAt: number }[]
      readonly sourceCount: number
      readonly sourcesTruncated: boolean
    }
  | {
      readonly kind: 'event'
      readonly address: string
      readonly eventId: number
      readonly conversationId: string
      readonly role: string
      readonly createdAt: number
      readonly truncated: boolean
      readonly page: number
      readonly pageCount: number
      readonly text: string
    }

export type OptmemExplorerSearchHit = {
  readonly eventId: number
  readonly conversationId: string
  readonly role: string
  readonly createdAt: number
  readonly pos: number
  readonly snippet: string
  readonly address: string | null
}

const projectInput = z.object({ projectId: z.string().min(1).max(256) })
const projectPathInput = z.object({ path: z.string().min(1).max(4_096) })
const projectZoomInput = z.object({
  projectId: z.string().min(1).max(256),
  address: z
    .string()
    .regex(/^\d+\+\d+$/)
    .max(32),
  page: z.number().int().min(0).max(1_000_000).optional(),
})
const projectSearchInput = z.object({
  projectId: z.string().min(1).max(256),
  query: z.string().trim().min(1).max(512),
  offset: z.number().int().min(0).max(1_000_000).optional(),
  limit: z.number().int().min(1).max(50).optional(),
})
const contextPreviewInput = z.object({
  projectId: z.string().min(1).max(256),
  conversationId: z.string().trim().min(1).max(512).optional(),
})
const projectOutput = z.object({
  projectId: z.string().min(1).max(256),
  title: z.string().max(256),
  path: z.string().max(4_096).nullable(),
  registered: z.boolean(),
  eventCount: z.number().int().nonnegative(),
})
const explorerNodeOutput = z.object({
  address: z.string().max(32),
  text: z.string(),
  bytes: z.number().int().nonnegative(),
  model: z.string().max(256),
  createdAt: z.number().int().nonnegative(),
})
const zoomOutput = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('node'),
    address: z.string().max(32),
    lines: z.array(z.string()).readonly(),
    text: z.string(),
    bytes: z.number().int().nonnegative(),
    model: z.string().max(256),
    createdAt: z.number().int().nonnegative(),
    parentAddress: z.string().max(32).nullable(),
    childAddresses: z.array(z.string().max(32)).readonly(),
    sources: z
      .array(
        z.object({
          eventId: z.number().int().nonnegative(),
          conversationId: z.string().min(1).max(512),
          role: z.string().max(64),
          createdAt: z.number().int().nonnegative(),
        }),
      )
      .readonly(),
    sourceCount: z.number().int().nonnegative(),
    sourcesTruncated: z.boolean(),
  }),
  z.object({
    kind: z.literal('event'),
    address: z.string().max(32),
    eventId: z.number().int().nonnegative(),
    conversationId: z.string().min(1).max(512),
    role: z.string().max(64),
    createdAt: z.number().int().nonnegative(),
    truncated: z.boolean(),
    page: z.number().int().nonnegative(),
    pageCount: z.number().int().nonnegative(),
    text: z.string(),
  }),
])
const searchHitOutput = z.object({
  eventId: z.number().int().nonnegative(),
  conversationId: z.string().min(1).max(512),
  role: z.string().max(64),
  createdAt: z.number().int().nonnegative(),
  pos: z.number().int().nonnegative(),
  snippet: z.string(),
  address: z.string().max(32).nullable(),
})
const searchOutput = z.object({ hits: z.array(searchHitOutput).max(50).readonly(), nextOffset: z.number().int().nonnegative(), hasMore: z.boolean() })
const contextPreviewOutput = z.object({
  text: z.string(),
  budgetBytes: z.number().int().nonnegative(),
  estimatedTokens: z.number().int().nonnegative(),
  sourceAddresses: z.array(z.string().max(32)).max(500).readonly(),
})
const pipelineOutput = z
  .object({
    pendingLeafJobs: z.number().int().nonnegative(),
    pendingEvents: z.number().int().nonnegative(),
    estimatedLeafSummaryCalls: z.number().int().nonnegative(),
    pendingMergeJobs: z.number().int().nonnegative(),
    oldestPendingAt: z.number().int().nonnegative().nullable(),
    completedSummaryNodes: z.number().int().nonnegative(),
    summariesLastTenMinutes: z.number().int().nonnegative(),
    paused: z.boolean(),
    health: z.enum(['off', 'starting', 'paused', 'processing', 'waiting', 'degraded', 'idle']),
    // Defaults keep the decode working against a Host started before these fields existed: a rebuilt client hot-reloads
    // while the running Host is still the old one, and a strict schema would fail the whole call.
    viewThroughPos: z.number().int().nonnegative().default(0),
    streamLength: z.number().int().nonnegative().default(0),
    lastSummaryAt: z.number().int().nonnegative().nullable().default(null),
    unsummarizedNodes: z.number().int().nonnegative().default(0),
    globalSummariesLastTenMinutes: z.number().int().nonnegative().default(0),
    failedJobs: z.number().int().nonnegative().default(0),
    retryingJobs: z.number().int().nonnegative().default(0),
    lastError: z.string().nullable().default(null),
    fallbacks: z.number().int().nonnegative().default(0),
    callsLastMinute: z.number().int().nonnegative().default(0),
    rateLimitPerMinute: z.number().int().nonnegative().default(0),
    catchUpIntervalMs: z.number().int().nonnegative().default(0),
    catchUpLastScanAt: z.number().int().nonnegative().nullable().default(null),
  })
  .optional()

/**
 * Host reads use DSHX request authentication and bounded schemas. A Host started before this API was added returns an
 * unknown-endpoint error, which the panel reports as a restart requirement.
 */
export const optmemApi = defineApi({
  id: 'dshfiles-optmem',
  version: 1,
  methods: {
    overview: method<void, OptmemOverview>(),
    providers: method<void, readonly OptmemProvider[]>(),
    backfill: method<{ readonly limit: number }, { readonly text: string }>(),
    projects: method({ output: z.array(projectOutput).max(1_000).readonly() }),
    projectForPath: method({ input: projectPathInput, output: z.string().max(256).nullable() }),
    projectView: method({ input: projectInput, output: z.array(explorerNodeOutput).max(2_000).readonly() }),
    projectZoom: method({ input: projectZoomInput, output: zoomOutput }),
    projectSearch: method({ input: projectSearchInput, output: searchOutput }),
    contextPreview: method({ input: contextPreviewInput, output: contextPreviewOutput }),
    projectPipeline: method({ input: projectInput, output: pipelineOutput }),
  },
})
