import { Schema } from 'effect'

/**
 * Wire shapes of the agent-sessions API. Every string and list is bounded so one oversized log line can never make a
 * response fail schema validation; the parsers clamp to the same limits before a value reaches these schemas.
 */

export const TITLE_MAX = 300
export const PATH_MAX = 1000
export const TEXT_MAX = 4_000
export const TOOL_TEXT_MAX = 1_500
export const SNIPPET_MAX = 320

const boundedString = (minimum: number, maximum: number) => Schema.String.check(Schema.isMinLength(minimum), Schema.isMaxLength(maximum))
const boundedText = (maximum: number) => Schema.String.check(Schema.isMaxLength(maximum))
const nonnegativeInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const boundedArray = <Item extends Schema.Constraint>(item: Item, maximum: number) => Schema.Array(item).check(Schema.isMaxLength(maximum))
const limitSchema = (maximum: number, fallback: number) =>
  Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(maximum)).annotate({
    description: `1 to ${String(maximum)}; defaults to ${String(fallback)}.`,
  })

export const agentKindValues = ['claude-code', 'codex'] as const
export const agentKindSchema = Schema.Literals(agentKindValues)
export type AgentKind = Schema.Schema.Type<typeof agentKindSchema>

export const tokenTotalsSchema = Schema.Struct({
  input: nonnegativeInteger,
  output: nonnegativeInteger,
  cacheRead: nonnegativeInteger,
  cacheWrite: nonnegativeInteger,
})
export type TokenTotals = Schema.Schema.Type<typeof tokenTotalsSchema>

export const sessionSummarySchema = Schema.Struct({
  key: boundedString(1, 300).annotate({ description: 'Stable `<agent>:<session id>` key the read tool takes.' }),
  agent: agentKindSchema,
  sessionId: boundedString(1, 256),
  title: boundedText(TITLE_MAX),
  firstPrompt: Schema.NullOr(boundedText(TITLE_MAX)),
  cwd: Schema.NullOr(boundedText(PATH_MAX)),
  gitBranch: Schema.NullOr(boundedText(TITLE_MAX)),
  models: boundedArray(boundedText(120), 8),
  agentVersion: Schema.NullOr(boundedText(60)),
  startedAt: Schema.NullOr(nonnegativeInteger),
  updatedAt: nonnegativeInteger,
  userMessages: nonnegativeInteger,
  assistantMessages: nonnegativeInteger,
  toolCalls: nonnegativeInteger,
  tokens: tokenTotalsSchema,
  sizeBytes: nonnegativeInteger,
})
export type SessionSummary = Schema.Schema.Type<typeof sessionSummarySchema>

export const indexingSchema = Schema.Struct({
  totalFiles: nonnegativeInteger,
  indexedFiles: nonnegativeInteger,
  caughtUp: Schema.Boolean,
  lastPassAt: Schema.NullOr(nonnegativeInteger),
  lastError: Schema.NullOr(boundedText(500)),
})
export type Indexing = Schema.Schema.Type<typeof indexingSchema>

export const sourceSchema = Schema.Struct({
  agent: agentKindSchema,
  label: boundedText(60),
  root: boundedText(PATH_MAX),
  available: Schema.Boolean,
  sessions: nonnegativeInteger,
})
export type Source = Schema.Schema.Type<typeof sourceSchema>

export const sourcesSchema = Schema.Struct({ sources: Schema.Array(sourceSchema), indexing: indexingSchema })
export type Sources = Schema.Schema.Type<typeof sourcesSchema>

export const listInputSchema = Schema.Struct({
  agent: Schema.optional(agentKindSchema.annotate({ description: 'Only sessions of this agent CLI.' })),
  filter: Schema.optional(
    Schema.Trimmed.check(Schema.isMinLength(1), Schema.isMaxLength(200)).annotate({
      description: 'Case-insensitive literal match over title, first prompt, working directory, branch and model.',
    }),
  ),
  cwd: Schema.optional(boundedString(1, PATH_MAX).annotate({ description: 'Only sessions whose working directory is this path or below it.' })),
  offset: Schema.optional(nonnegativeInteger.annotate({ description: 'Rows to skip, for paging; defaults to 0.' })),
  limit: Schema.optional(limitSchema(200, 50)),
})
export type ListInput = Schema.Schema.Type<typeof listInputSchema>

export const sessionListSchema = Schema.Struct({
  sessions: boundedArray(sessionSummarySchema, 200),
  total: nonnegativeInteger,
  indexing: indexingSchema,
})
export type SessionList = Schema.Schema.Type<typeof sessionListSchema>

export const itemKindValues = ['user', 'assistant', 'thinking', 'tool-call', 'tool-result', 'meta'] as const
export const itemKindSchema = Schema.Literals(itemKindValues)
export type ItemKind = Schema.Schema.Type<typeof itemKindSchema>

export const transcriptItemSchema = Schema.Struct({
  index: nonnegativeInteger,
  kind: itemKindSchema,
  text: boundedText(TEXT_MAX),
  truncated: Schema.Boolean,
  toolName: Schema.NullOr(boundedText(120)),
  isError: Schema.Boolean,
  at: Schema.NullOr(nonnegativeInteger),
})
export type TranscriptItem = Schema.Schema.Type<typeof transcriptItemSchema>

export const readInputSchema = Schema.Struct({
  key: boundedString(1, 300).annotate({ description: 'Session key from a list or search row, `<agent>:<session id>`.' }),
  offset: Schema.optional(nonnegativeInteger.annotate({ description: 'First transcript item to return; defaults to 0.' })),
  limit: Schema.optional(limitSchema(400, 100)),
  kinds: Schema.optional(boundedArray(itemKindSchema, itemKindValues.length).annotate({ description: 'Only these item kinds; omit for every kind.' })),
})
export type ReadInput = Schema.Schema.Type<typeof readInputSchema>

export const transcriptSchema = Schema.Struct({
  session: sessionSummarySchema,
  items: boundedArray(transcriptItemSchema, 400),
  total: nonnegativeInteger,
  offset: nonnegativeInteger,
  capped: Schema.Boolean.annotate({ description: 'True when the log holds more items than one transcript keeps.' }),
})
export type Transcript = Schema.Schema.Type<typeof transcriptSchema>

export const searchInputSchema = Schema.Struct({
  query: Schema.Trimmed.check(Schema.isMinLength(2), Schema.isMaxLength(200)).annotate({
    description: 'Case-insensitive literal text to find in user and assistant messages and tool calls.',
  }),
  agent: Schema.optional(agentKindSchema.annotate({ description: 'Only sessions of this agent CLI.' })),
  limit: Schema.optional(limitSchema(100, 30)),
})
export type SearchInput = Schema.Schema.Type<typeof searchInputSchema>

export const searchHitSchema = Schema.Struct({
  session: sessionSummarySchema,
  itemIndex: Schema.NullOr(nonnegativeInteger).annotate({ description: 'Transcript item that matched; null for a title or metadata match.' }),
  kind: Schema.NullOr(itemKindSchema),
  snippet: boundedText(SNIPPET_MAX),
})
export type SearchHit = Schema.Schema.Type<typeof searchHitSchema>

export const searchResultSchema = Schema.Struct({
  hits: boundedArray(searchHitSchema, 100),
  scannedSessions: nonnegativeInteger,
  totalSessions: nonnegativeInteger,
  complete: Schema.Boolean.annotate({ description: 'False when the scan budget ran out before every session was read.' }),
})
export type SearchResult = Schema.Schema.Type<typeof searchResultSchema>

export const statsInputSchema = Schema.Struct({
  days: Schema.optional(limitSchema(365, 30).annotate({ description: 'Window in days ending now; defaults to 30.' })),
})
export type StatsInput = Schema.Schema.Type<typeof statsInputSchema>

const statsRowSchema = Schema.Struct({
  name: boundedText(120),
  sessions: nonnegativeInteger,
  userMessages: nonnegativeInteger,
  toolCalls: nonnegativeInteger,
  tokens: tokenTotalsSchema,
})
export type StatsRow = Schema.Schema.Type<typeof statsRowSchema>

export const statsSchema = Schema.Struct({
  days: nonnegativeInteger,
  totals: statsRowSchema,
  byAgent: boundedArray(statsRowSchema, agentKindValues.length),
  byModel: boundedArray(statsRowSchema, 40),
  byDay: boundedArray(Schema.Struct({ day: boundedText(10), sessions: nonnegativeInteger, outputTokens: nonnegativeInteger }), 366),
  indexing: indexingSchema,
})
export type Stats = Schema.Schema.Type<typeof statsSchema>

export const refreshSchema = Schema.Struct({ indexing: indexingSchema })
