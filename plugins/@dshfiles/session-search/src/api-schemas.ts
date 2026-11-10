/**
 * Schemas the public API shares with the worker protocol. They live apart from `protocol.ts` so the `search-api`
 * module a Client imports carries no RPC code.
 */
import * as Schema from 'effect/Schema'

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

/** One event of a thread whose indexed text matches a find, in transcript order. */
export const findMatchSchema = Schema.Struct({
  seq: countSchema,
  type: Schema.String,
  time: Schema.Number.check(Schema.isFinite()),
  snippet: Schema.String,
})
export type FindMatch = typeof findMatchSchema.Type

/** Most matches one find returns; a thread with more reports `hasMore`. */
export const FIND_LIMIT_MAX = 1_000
