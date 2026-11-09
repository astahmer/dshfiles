import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'

/** A JSON value as a session log stores it. */
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { readonly [key: string]: JsonValue }

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

export const searchSessionsResultSchema = Schema.Struct({ matches: Schema.Array(searchMatchSchema), hasMore: Schema.Boolean })
export type SearchSessionsResult = typeof searchSessionsResultSchema.Type

export const searchEventsResultSchema = Schema.Struct({
  sessionId: Schema.String,
  header: Schema.NullOr(sessionHeaderSchema),
  matches: Schema.Array(searchMatchSchema),
  hasMore: Schema.Boolean,
})
export type SearchEventsResult = typeof searchEventsResultSchema.Type

/** The index refused or failed one request; `code` is the stable identifier the Host logs and callers branch on. */
export class SearchWorkerFailed extends Schema.TaggedError<SearchWorkerFailed>()('SearchWorkerFailed', {
  code: Schema.String,
  reason: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.reason
  }
}

/** The worker's whole RPC surface; the worker side serves it with `RpcServer`, the Host calls it with `RpcClient`. */
export class SearchWorkerRpcs extends RpcGroup.make(
  Rpc.make('SearchSessions', { payload: sessionSearchRequestSchema, success: searchSessionsResultSchema, error: SearchWorkerFailed }),
  Rpc.make('SearchEvents', { payload: sessionEventSearchRequestSchema, success: searchEventsResultSchema, error: SearchWorkerFailed }),
  Rpc.make('StartIngest', { payload: { root: Schema.String.check(Schema.isMinLength(1)) }, success: indexHealthSchema, error: SearchWorkerFailed }),
  Rpc.make('SetArchived', { payload: { archivedSessionIds: Schema.Array(Schema.String) }, success: indexHealthSchema, error: SearchWorkerFailed }),
  Rpc.make('Health', { success: indexHealthSchema, error: SearchWorkerFailed }),
  Rpc.make('Nudge', { success: indexHealthSchema, error: SearchWorkerFailed }),
) {}

/** What the Host hands the worker at spawn. */
export const workerConfigSchema = Schema.Struct({
  indexPath: Schema.String.check(Schema.isMinLength(1)),
  // Each window is decoded, parsed and committed in one synchronous step that searches wait behind.
  windowBytes: Schema.optional(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0))),
})
