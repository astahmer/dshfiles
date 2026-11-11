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

/** Bounds of a prompt-history read: rows returned, newest prompts searched, and the longest prompt kept. */
export const PROMPT_HISTORY_LIMIT_MAX = 200
export const PROMPT_HISTORY_WINDOW_MAX = 50_000
/** The index stores at most 65 536 characters of a user message; a longer one is never a history row. */
export const PROMPT_HISTORY_CHARS_MAX = 65_536

const boundedInt = (max: number) => Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(max))

export const promptHistoryRequestSchema = Schema.Struct({
  /** An FTS5 expression from `findExpression`; absent lists the newest prompts. */
  query: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(4_096))),
  limit: boundedInt(PROMPT_HISTORY_LIMIT_MAX),
  window: boundedInt(PROMPT_HISTORY_WINDOW_MAX),
  maxChars: boundedInt(PROMPT_HISTORY_CHARS_MAX),
})
export type PromptHistoryRequest = typeof promptHistoryRequestSchema.Type

/** One prompt a person sent, with the thread and event it came from. */
export const historyPromptSchema = Schema.Struct({
  sessionId: Schema.String,
  seq: countSchema,
  time: Schema.Number.check(Schema.isFinite()),
  text: Schema.String,
})
export type HistoryPrompt = typeof historyPromptSchema.Type

export const promptHistoryResultSchema = Schema.Struct({ prompts: Schema.Array(historyPromptSchema) })
export type PromptHistoryResult = typeof promptHistoryResultSchema.Type
