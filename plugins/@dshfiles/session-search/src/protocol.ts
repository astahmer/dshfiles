import { z } from 'zod'

/** A JSON value as it crosses the worker boundary. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
)

/**
 * The host↔worker contract. The host never touches the index file; it forwards requests and session events over this
 * protocol, which is the whole reason a content search cannot block the Host event loop.
 */

/**
 * One event metadata predicate as SQL can apply it before ranking: clauses are ANDed, values inside a clause are ORed.
 * The host maps core's own filter clauses onto these, so the two callers that matter (`@dshfiles/memory` and the
 * session controller) filter exactly as they do against the stock backend.
 */
export const eventFilterClauseSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('type'), values: z.array(z.string().min(1)).readonly() }),
  z.object({ kind: z.literal('surface'), values: z.array(z.string().min(1)).readonly() }),
  z.object({ kind: z.literal('seq'), from: z.number().int().optional(), to: z.number().int().optional() }).readonly(),
  z.object({ kind: z.literal('time'), from: z.number().optional(), to: z.number().optional() }).readonly(),
])
export const eventFiltersSchema = z.array(eventFilterClauseSchema).readonly()
export type EventFilters = z.infer<typeof eventFiltersSchema>

export const sessionSearchRequestSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(100),
  /** Offset into the ranked result set; the host keeps cursors opaque. */
  cursor: z.number().int().nonnegative().optional(),
  sessionIds: z.array(z.string().min(1)).readonly().optional(),
  cwd: z.string().min(1).optional(),
  filters: eventFiltersSchema.optional(),
})
export type SessionSearchRequest = z.infer<typeof sessionSearchRequestSchema>

export const sessionEventSearchRequestSchema = z.object({
  sessionId: z.string().min(1),
  query: z.string().min(1),
  limit: z.number().int().min(1).max(100),
  cursor: z.number().int().nonnegative().optional(),
  filters: eventFiltersSchema.optional(),
})
export type SessionEventSearchRequest = z.infer<typeof sessionEventSearchRequestSchema>

export const indexHealthSchema = z.object({
  sessions: z.number().int().nonnegative(),
  documents: z.number().int().nonnegative(),
  indexBytes: z.number().int().nonnegative(),
  behindSessions: z.number().int().nonnegative(),
  behindBytes: z.number().int().nonnegative(),
  ingesting: z.boolean(),
  lastIngestMs: z.number().nonnegative(),
  /** Slowest ingest pass since the worker started; a search waits behind a running pass. */
  slowestIngestMs: z.number().nonnegative(),
  lastSearchMs: z.number().nonnegative(),
  slowestSearchMs: z.number().nonnegative(),
  lastError: z.string().nullable(),
})
export type IndexHealth = z.infer<typeof indexHealthSchema>

export const sessionHeaderSchema = z.object({
  version: z.number().int(),
  id: z.string().min(1),
  createdAt: z.number(),
  cwd: z.string().optional(),
  parentSession: z.string().optional(),
  isSeeded: z.boolean(),
  delegationDepth: z.number().int().optional(),
  agentPreset: z.string().optional(),
})
export type SessionHeaderRow = z.infer<typeof sessionHeaderSchema>

export const searchMatchSchema = z.object({
  sessionId: z.string(),
  seq: z.number().int(),
  type: z.string(),
  time: z.number(),
  surface: z.string(),
  snippet: z.string(),
  header: sessionHeaderSchema,
})
export type SearchMatch = z.infer<typeof searchMatchSchema>

export const workerRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('search-sessions'), id: z.number().int(), request: sessionSearchRequestSchema }),
  z.object({ kind: z.literal('search-events'), id: z.number().int(), request: sessionEventSearchRequestSchema }),
  z.object({ kind: z.literal('ingest'), id: z.number().int(), root: z.string().min(1) }),
  z.object({ kind: z.literal('health'), id: z.number().int() }),
  z.object({ kind: z.literal('nudge'), id: z.number().int() }),
  z.object({ kind: z.literal('close'), id: z.number().int() }),
])
export type WorkerRequest = z.infer<typeof workerRequestSchema>

/** The same union without the correlation id, which the client assigns per request. */
export type WorkerRequestInput =
  | { readonly kind: 'search-sessions'; readonly request: SessionSearchRequest }
  | { readonly kind: 'search-events'; readonly request: SessionEventSearchRequest }
  | { readonly kind: 'ingest'; readonly root: string }
  | { readonly kind: 'health' }
  | { readonly kind: 'nudge' }
  | { readonly kind: 'close' }

export const workerReplySchema = z.union([
  z.object({ id: z.number().int(), ok: z.literal(true), value: jsonValueSchema }),
  z.object({ id: z.number().int(), ok: z.literal(false), code: z.string(), message: z.string() }),
  z.object({ kind: z.literal('progress'), health: indexHealthSchema }),
])
export type WorkerReply = z.infer<typeof workerReplySchema>

export const searchSessionsResultSchema = z.object({ matches: z.array(searchMatchSchema), hasMore: z.boolean() })
export type SearchSessionsResult = z.infer<typeof searchSessionsResultSchema>

export const searchEventsResultSchema = z.object({
  sessionId: z.string(),
  header: sessionHeaderSchema.nullable(),
  matches: z.array(searchMatchSchema),
  hasMore: z.boolean(),
})
export type SearchEventsResult = z.infer<typeof searchEventsResultSchema>
