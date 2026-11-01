import * as Schema from 'effect/Schema'

/** A JSON value as it crosses the worker boundary. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }

const jsonValueSchema: Schema.ConstraintDecoder<JsonValue> = Schema.suspend(() =>
  Schema.Union([
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    Schema.Array(jsonValueSchema),
    Schema.Record(Schema.String, jsonValueSchema),
  ]),
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
const eventFilterClauseSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('type'), values: Schema.Array(Schema.String.check(Schema.isMinLength(1))) }),
  Schema.Struct({ kind: Schema.Literal('surface'), values: Schema.Array(Schema.String.check(Schema.isMinLength(1))) }),
  Schema.Struct({
    kind: Schema.Literal('seq'),
    from: Schema.optional(Schema.Number.check(Schema.isFinite(), Schema.isInt())),
    to: Schema.optional(Schema.Number.check(Schema.isFinite(), Schema.isInt())),
  }),
  Schema.Struct({
    kind: Schema.Literal('time'),
    from: Schema.optional(Schema.Number.check(Schema.isFinite())),
    to: Schema.optional(Schema.Number.check(Schema.isFinite())),
  }),
])

const eventFiltersSchema = Schema.Array(eventFilterClauseSchema)
export type EventFilters = typeof eventFiltersSchema.Type

const sessionSearchRequestSchema = Schema.Struct({
  query: Schema.String.check(Schema.isMinLength(1)),
  limit: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100)),
  /** Offset into the ranked result set; the host keeps cursors opaque. */
  cursor: Schema.optional(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  sessionIds: Schema.optional(Schema.Array(Schema.String.check(Schema.isMinLength(1)))),
  cwd: Schema.optional(Schema.String.check(Schema.isMinLength(1))),
  filters: Schema.optional(eventFiltersSchema),
})
export type SessionSearchRequest = typeof sessionSearchRequestSchema.Type

const sessionEventSearchRequestSchema = Schema.Struct({
  sessionId: Schema.String.check(Schema.isMinLength(1)),
  query: Schema.String.check(Schema.isMinLength(1)),
  limit: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100)),
  cursor: Schema.optional(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))),
  filters: Schema.optional(eventFiltersSchema),
})
export type SessionEventSearchRequest = typeof sessionEventSearchRequestSchema.Type

const countSchema = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const durationSchema = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))

export const indexHealthSchema = Schema.Struct({
  sessions: countSchema,
  documents: countSchema,
  indexBytes: countSchema,
  behindSessions: countSchema,
  behindBytes: countSchema,
  ingesting: Schema.Boolean,
  lastIngestMs: durationSchema,
  /** Slowest ingest pass since the worker started; a search waits behind a running pass. */
  slowestIngestMs: durationSchema,
  lastSearchMs: durationSchema,
  slowestSearchMs: durationSchema,
  lastError: Schema.NullOr(Schema.String),
})
export type IndexHealth = typeof indexHealthSchema.Type

export const sessionHeaderSchema = Schema.Struct({
  version: Schema.Number.check(Schema.isFinite(), Schema.isInt()),
  id: Schema.String.check(Schema.isMinLength(1)),
  createdAt: Schema.Number.check(Schema.isFinite()),
  cwd: Schema.optional(Schema.String),
  parentSession: Schema.optional(Schema.String),
  isSeeded: Schema.Boolean,
  delegationDepth: Schema.optional(Schema.Number.check(Schema.isFinite(), Schema.isInt())),
  agentPreset: Schema.optional(Schema.String),
})
export type SessionHeaderRow = typeof sessionHeaderSchema.Type

const searchMatchSchema = Schema.Struct({
  sessionId: Schema.String,
  seq: Schema.Number.check(Schema.isFinite(), Schema.isInt()),
  type: Schema.String,
  time: Schema.Number.check(Schema.isFinite()),
  surface: Schema.String,
  snippet: Schema.String,
  header: sessionHeaderSchema,
})
export type SearchMatch = typeof searchMatchSchema.Type

export const workerRequestSchema = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('search-sessions'), id: Schema.Number.check(Schema.isFinite(), Schema.isInt()), request: sessionSearchRequestSchema }),
  Schema.Struct({ kind: Schema.Literal('search-events'), id: Schema.Number.check(Schema.isFinite(), Schema.isInt()), request: sessionEventSearchRequestSchema }),
  Schema.Struct({ kind: Schema.Literal('ingest'), id: Schema.Number.check(Schema.isFinite(), Schema.isInt()), root: Schema.String.check(Schema.isMinLength(1)) }),
  Schema.Struct({ kind: Schema.Literal('health'), id: Schema.Number.check(Schema.isFinite(), Schema.isInt()) }),
  Schema.Struct({ kind: Schema.Literal('nudge'), id: Schema.Number.check(Schema.isFinite(), Schema.isInt()) }),
  Schema.Struct({ kind: Schema.Literal('close'), id: Schema.Number.check(Schema.isFinite(), Schema.isInt()) }),
])
export type WorkerRequest = typeof workerRequestSchema.Type

/** The same union without the correlation id, which the client assigns per request. */
export type WorkerRequestInput =
  | { readonly kind: 'search-sessions'; readonly request: SessionSearchRequest }
  | { readonly kind: 'search-events'; readonly request: SessionEventSearchRequest }
  | { readonly kind: 'ingest'; readonly root: string }
  | { readonly kind: 'health' }
  | { readonly kind: 'nudge' }
  | { readonly kind: 'close' }

export const workerReplySchema = Schema.Union([
  Schema.Struct({ id: Schema.Number.check(Schema.isFinite(), Schema.isInt()), ok: Schema.Literal(true), value: jsonValueSchema }),
  Schema.Struct({ id: Schema.Number.check(Schema.isFinite(), Schema.isInt()), ok: Schema.Literal(false), code: Schema.String, message: Schema.String }),
  Schema.Struct({ kind: Schema.Literal('progress'), health: indexHealthSchema }),
])
export type WorkerReply = typeof workerReplySchema.Type

export const searchSessionsResultSchema = Schema.Struct({ matches: Schema.Array(searchMatchSchema), hasMore: Schema.Boolean })
export type SearchSessionsResult = typeof searchSessionsResultSchema.Type

export const searchEventsResultSchema = Schema.Struct({
  sessionId: Schema.String,
  header: Schema.NullOr(sessionHeaderSchema),
  matches: Schema.Array(searchMatchSchema),
  hasMore: Schema.Boolean,
})
export type SearchEventsResult = typeof searchEventsResultSchema.Type
