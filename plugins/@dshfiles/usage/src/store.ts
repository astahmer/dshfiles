import { basename, dirname } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import type { RegistryToolSource } from '@dshfiles/dshx/api'
import { CostEstimateModel } from '@dshfiles/ai-accounts/cost-estimate'
import { secretCredentialLabelSchemaEffect } from '@dshfiles/credential-port/effect'
import { SqliteStore } from '@dshfiles/sqlite-store'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Clock, Context, Effect, Layer, Option, Ref, Schema } from 'effect'
import { Reactivity } from 'effect/reactivity'
import { SqlClient } from 'effect/sql'
import type { ActivityReport, ChartQuery, ChartView, RequestPage, RequestQuery, RequestView } from './api.js'
import { UsageStoreFailed } from './errors.js'
import { UsageFoldModel, type RequestRow, type SessionMeta, type ToolExecutionRow } from './fold.js'
import {
  JEV_INPUT_USD_PER_MILLION,
  type JevUsageBreakdown,
  type JevUsageQuery,
  type JevUsageRecord,
  type JevUsageView,
  JEV_USAGE_OUTCOMES,
  JEV_USAGE_SOURCES,
} from './jev-usage.js'
import { createOtlpMetricsRequest, type OtlpCounterInput, type OtlpHistogramInput, type OtlpMetricsRequest, type OtlpTemporality } from './otel-metrics.js'
import { LEGACY_USER_VERSION, usageMigrations } from './migrations.js'

/**
 * The usage index: one row per model request, one per session, and one per
 * session log with the byte offset and fold state reached, so a pass only
 * decodes what the log gained since. Costs are never stored: queries join
 * `route_rates` (USD per million tokens per route and context band), which
 * the Host rebuilds whenever the price catalog changes.
 */

export interface RouteBand {
  readonly provider: string
  readonly model: string
  readonly band: number
}

export interface Rates {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
}

/** Bump whenever the fold reads a log differently. */
const FOLD_VERSION = 4

/** Live side calls wait this long for the log row they duplicate before they count on their own. */
const LIVE_MATCH_WAIT_MS = 10 * 60_000
const LIVE_MATCH_WINDOW_MS = 2 * 60_000
const SERIES_KEYS = 6
const OTHER_KEY = 'Other'

/** `~/dev/dshfiles-threads/dshfiles-221d06c1` is a thread workspace of `dshfiles`. */
const projectOf = (cwd: string | null): string | null => {
  if (cwd === null || cwd.length === 0) return null
  const parent = basename(dirname(cwd))
  if (parent.endsWith('-threads') && parent.length > '-threads'.length) return parent.slice(0, -'-threads'.length)
  return basename(cwd)
}

const credentialLabelSchema = Schema.Union([secretCredentialLabelSchemaEffect, Schema.Literals(['Legacy / unknown', 'Other credentials'])])

const textColumn = Schema.NullOr(Schema.String)
const numberColumn = Schema.NullOr(Schema.Number)
const integer = Schema.Number.check(Schema.isInt())
const nonnegativeInteger = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const OTEL_TOOL_CATEGORIES = ['api', 'mcp', 'plugin', 'tool', 'skill', 'other'] as const
const OTEL_TOOL_OUTCOMES = ['success', 'error', 'interrupted', 'unknown', 'pending'] as const
const toolCategory = Schema.Literals(OTEL_TOOL_CATEGORIES)
const toolOutcome = Schema.Literals(OTEL_TOOL_OUTCOMES)

const requestRowSchema = Schema.Struct({
  id: Schema.String,
  session_id: Schema.String,
  title: textColumn,
  parent_session: textColumn,
  project: textColumn,
  cwd: textColumn,
  seq: numberColumn,
  message_id: textColumn,
  turn: numberColumn,
  step: numberColumn,
  purpose: Schema.Literals(UsageFoldModel.REQUEST_PURPOSES),
  provider: Schema.String,
  model: Schema.String,
  started_at: Schema.Number,
  duration_ms: numberColumn,
  ttft_ms: numberColumn,
  input: numberColumn,
  cache_read: numberColumn,
  cache_write: numberColumn,
  output: numberColumn,
  cost: numberColumn,
  status: Schema.Literals(UsageFoldModel.REQUEST_STATUSES),
  stop_reason: textColumn,
  error_code: textColumn,
})

const countRowSchema = Schema.Struct({ key: Schema.String, count: Schema.Number })
const fileRowSchema = Schema.Struct({ path: Schema.String, offset: Schema.Number, size: Schema.Number, mtime_ms: Schema.Number, state: Schema.String })

const bucketRowSchema = Schema.Struct({
  start: Schema.Number,
  key: textColumn,
  cost: Schema.Number,
  requests: Schema.Number,
  failed: Schema.Number,
  input: Schema.Number,
  cache_read: Schema.Number,
  cache_write: Schema.Number,
  output: Schema.Number,
  missing_usage: Schema.Number,
  unpriced: Schema.Number,
})

const breakdownRowSchema = Schema.Struct({
  key: textColumn,
  cost: Schema.Number,
  requests: Schema.Number,
  sessions: Schema.Number,
  input: Schema.Number,
  cache_read: Schema.Number,
  cache_write: Schema.Number,
  output: Schema.Number,
  tokens: Schema.Number,
  missing_usage: Schema.Number,
  unpriced: Schema.Number,
})
const latencyRowSchema = Schema.Struct({ start: Schema.Number, ttft_ms: numberColumn, duration_ms: numberColumn })
const threadRowSchema = Schema.Struct({ session_id: Schema.String, title: textColumn, project: textColumn, cost: Schema.Number, requests: Schema.Number })
const toolRowSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  seq: integer,
  turn: Schema.NullOr(integer),
  step: Schema.NullOr(integer),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  category: toolCategory,
  owner: textColumn,
  normalizedCommand: Schema.NullOr(Schema.String.check(Schema.isMaxLength(80))).pipe(Schema.withDecodingDefaultType(Effect.succeed(null))),
  testRunner: Schema.NullOr(Schema.String.check(Schema.isMaxLength(80))).pipe(Schema.withDecodingDefaultType(Effect.succeed(null))),
  startedAt: integer,
  endedAt: Schema.NullOr(integer),
  outcome: toolOutcome,
  resultChars: Schema.NullOr(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 100_000_000 }))).pipe(
    Schema.withDecodingDefaultType(Effect.succeed(null)),
  ),
})
const durationTotalSchema = Schema.Struct({ totalDurationMs: nonnegativeInteger })
const identifierActivityRowSchema = Schema.Struct({
  identifier: Schema.String,
  calls: integer,
  totalDurationMs: nonnegativeInteger,
  successes: integer,
  errors: integer,
  interrupted: integer,
  unknown: integer,
  pending: integer,
})
const toolActivityRowSchema = Schema.Struct({
  name: Schema.String,
  category: toolCategory,
  owner: textColumn,
  calls: integer,
  successes: integer,
  errors: integer,
  interrupted: integer,
  unknown: integer,
  pending: integer,
  firstStartedAt: numberColumn,
  lastStartedAt: numberColumn,
  firstEndedAt: numberColumn,
  lastEndedAt: numberColumn,
  averageDurationMs: numberColumn,
  totalDurationMs: nonnegativeInteger,
  p50DurationMs: numberColumn,
  p90DurationMs: numberColumn,
  maxDurationMs: numberColumn,
  resultChars: nonnegativeInteger,
  outputTokens: nonnegativeInteger,
  measuredCalls: nonnegativeInteger,
})
const activityCategoryRowSchema = Schema.Struct({
  category: toolCategory,
  calls: integer,
  successes: integer,
  errors: integer,
  interrupted: integer,
  unknown: integer,
  pending: integer,
  averageDurationMs: numberColumn,
  p50DurationMs: numberColumn,
  p90DurationMs: numberColumn,
  maxDurationMs: numberColumn,
  resultChars: nonnegativeInteger,
  outputTokens: nonnegativeInteger,
  measuredCalls: nonnegativeInteger,
})
const timelineRowSchema = Schema.Struct({
  start: integer,
  category: toolCategory,
  calls: integer,
  errors: integer,
  durationMs: nonnegativeInteger,
  outputTokens: nonnegativeInteger,
})
const activityTotalsRowSchema = Schema.Struct({
  calls: integer,
  successes: integer,
  errors: integer,
  interrupted: integer,
  unknown: integer,
  pending: integer,
  durationMs: nonnegativeInteger,
  outputTokens: nonnegativeInteger,
  measuredCalls: nonnegativeInteger,
})
const jevEventRowSchema = Schema.Struct({
  at: integer,
  endedAt: integer,
  durationMs: integer,
  source: Schema.Literals(JEV_USAGE_SOURCES),
  outcome: Schema.Literals(JEV_USAGE_OUTCOMES),
})
const jevOutcomeRowSchema = Schema.Struct({ outcome: Schema.Literals(JEV_USAGE_OUTCOMES), calls: integer })
const jevActivityRowSchema = Schema.Struct({
  calls: integer,
  successes: integer,
  failures: integer,
  inputTokens: integer,
  outputTokens: integer,
  durationMs: numberColumn,
  maxDurationMs: numberColumn,
})
const TOOL_RETENTION_MS = 365 * 24 * 60 * 60 * 1000
/** Raw request rows feed the reports and the boards; a year of them measured +7.3 MB a day with no prune at all. */
const REQUEST_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
const MAX_PENDING_MS = 24 * 60 * 60 * 1000
const OTEL_DURATION_BOUNDS_SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60] as const
const OTEL_DURATION_BOUNDS_MS = OTEL_DURATION_BOUNDS_SECONDS.map(seconds => seconds * 1_000)
const OTEL_BUCKET_SELECT = OTEL_DURATION_BOUNDS_MS.map(
  (bound, index) => `SUM(CASE WHEN duration_ms <= ${String(bound)} THEN 1 ELSE 0 END) AS bucket${String(index)}`,
).join(', ')
const otelBucketRowFields = {
  bucket0: integer,
  bucket1: integer,
  bucket2: integer,
  bucket3: integer,
  bucket4: integer,
  bucket5: integer,
  bucket6: integer,
  bucket7: integer,
  bucket8: integer,
  bucket9: integer,
  bucket10: integer,
  bucket11: integer,
  bucket12: integer,
}
const OTEL_HISTOGRAM_BASE_ROW_SCHEMA = Schema.Struct({ calls: integer, durationSumMs: Schema.Number, ...otelBucketRowFields })

const summaryRowSchema = Schema.Struct({
  cost: Schema.Number,
  requests: Schema.Number,
  failed: Schema.Number,
  aborted: Schema.Number,
  input: Schema.Number,
  cache_read: Schema.Number,
  cache_write: Schema.Number,
  output: Schema.Number,
  unpriced: Schema.Number,
  missing_usage: Schema.Number,
  average_duration_ms: numberColumn,
  cacheSavings: Schema.Number,
  turns: integer,
})

/** Would-be prompt cost of cache reads minus what they were billed, per route list price. */
const CACHE_SAVINGS_SQL = `CASE WHEN rr.provider IS NULL OR r.cache_read IS NULL THEN 0
  ELSE r.cache_read * (rr.input - rr.cache_read) / 1000000.0 END`

const TURNS_SQL = "COUNT(DISTINCT CASE WHEN r.turn IS NULL THEN NULL ELSE r.session_id || ':' || r.turn END)"

const COST_SQL = `CASE WHEN rr.provider IS NULL OR r.input IS NULL THEN NULL
  ELSE (r.input * rr.input + r.output * rr.output + r.cache_read * rr.cache_read + r.cache_write * rr.cache_write) / 1000000.0 END`

const TOKENS_SQL = 'COALESCE(r.input, 0) + COALESCE(r.cache_read, 0) + COALESCE(r.cache_write, 0) + COALESCE(r.output, 0)'

/** The cold archive is created on demand: a migration step would rewrite every existing usage.db's version. */
const ARCHIVE_DDL = `CREATE TABLE IF NOT EXISTS requests_archive (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, seq INTEGER, message_id TEXT, turn INTEGER, step INTEGER,
  purpose TEXT NOT NULL, source TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL, started_at INTEGER NOT NULL,
  ended_at INTEGER, ttft_ms INTEGER, input INTEGER, cache_read INTEGER, cache_write INTEGER, output INTEGER,
  reasoning INTEGER, band INTEGER NOT NULL, status TEXT NOT NULL, stop_reason TEXT, error_code TEXT, merged_into TEXT,
  settled INTEGER NOT NULL
) STRICT`

/**
 * Reports read the hot table and the cold archive as one: rows older than the retention window move to
 * `requests_archive` (no indexes, never written again) instead of being deleted, so a month or year filter keeps
 * answering while the hot table stays small.
 */
const FROM_SQL = `(SELECT * FROM requests UNION ALL SELECT * FROM requests_archive) r
  LEFT JOIN sessions s ON s.id = r.session_id
  LEFT JOIN route_rates rr ON rr.provider = r.provider AND rr.model = r.model AND rr.band = r.band`

/** Hidden: live calls folded into their log row, and live calls still waiting for one. */
const VISIBLE_SQL = "r.merged_into IS NULL AND NOT (r.source = 'live' AND r.settled = 0)"

const SORT_SQL = {
  startedAt: 'r.started_at',
  cost: 'cost',
  input: 'r.input',
  cacheRead: 'r.cache_read',
  output: 'r.output',
  durationMs: 'duration_ms',
  ttftMs: 'r.ttft_ms',
} satisfies Readonly<Record<RequestQuery['sort'], string>>

const percentile = (sorted: readonly number[], fraction: number): number | null => {
  if (sorted.length === 0) return null
  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? null
}

const listOf = <S extends Schema.Top>(schema: S) => Schema.decodeUnknownEffect(Schema.Array(schema))
const oneOf = <S extends Schema.Top>(schema: S) => Schema.decodeUnknownEffect(schema)

const routeBandRowSchema = Schema.Struct({ provider: Schema.String, model: Schema.String, band: Schema.Number })
const waitingLiveRowSchema = Schema.Struct({ id: Schema.String, session_id: Schema.String, purpose: Schema.String, started_at: Schema.Number })
const jevCredentialRowSchema = Schema.Struct({
  credential: credentialLabelSchema,
  backlogCalls: nonnegativeInteger,
  memoryCalls: nonnegativeInteger,
  calls: nonnegativeInteger,
  succeeded: nonnegativeInteger,
  failed: nonnegativeInteger,
  inputTokens: nonnegativeInteger,
  outputTokens: nonnegativeInteger,
  callsWithoutInputUsage: nonnegativeInteger,
})
const jevOmittedRowSchema = Schema.Struct({
  calls: nonnegativeInteger,
  backlogCalls: nonnegativeInteger,
  memoryCalls: nonnegativeInteger,
  succeeded: nonnegativeInteger,
  failed: nonnegativeInteger,
  inputTokens: nonnegativeInteger,
  outputTokens: nonnegativeInteger,
  callsWithoutInputUsage: nonnegativeInteger,
})
const toolEventRowSchema = Schema.Struct({
  id: Schema.String,
  session_id: Schema.String,
  seq: Schema.Number,
  turn: numberColumn,
  step: numberColumn,
  name: Schema.String,
  category: toolCategory,
  owner: textColumn,
  started_at: Schema.Number,
  ended_at: numberColumn,
  outcome: toolOutcome,
})
const jevSourceRowSchema = Schema.Struct({
  source: Schema.Literals(JEV_USAGE_SOURCES),
  calls: Schema.Number,
  successes: Schema.Number,
  failures: Schema.Number,
  inputTokens: Schema.Number,
  outputTokens: Schema.Number,
  averageDurationMs: numberColumn,
  p50DurationMs: numberColumn,
  p90DurationMs: numberColumn,
  maxDurationMs: numberColumn,
})
const jevDurationStatsRowSchema = Schema.Struct({ p50DurationMs: numberColumn, p90DurationMs: numberColumn, maxDurationMs: numberColumn })
const boundedRouteField = Schema.String.check(Schema.isMaxLength(200))
const modelCountRowSchema = Schema.Struct({
  provider: boundedRouteField,
  model: boundedRouteField,
  purpose: Schema.Literals(UsageFoldModel.REQUEST_PURPOSES),
  status: Schema.Literals(UsageFoldModel.REQUEST_STATUSES),
  calls: integer,
})
const modelTokenRowSchema = Schema.Struct({
  provider: boundedRouteField,
  model: boundedRouteField,
  purpose: Schema.Literals(UsageFoldModel.REQUEST_PURPOSES),
  input: integer,
  cacheRead: integer,
  cacheWrite: integer,
  output: integer,
  reasoning: integer,
})
const modelDurationRowSchema = Schema.Struct({
  provider: boundedRouteField,
  model: boundedRouteField,
  purpose: Schema.Literals(UsageFoldModel.REQUEST_PURPOSES),
  status: Schema.Literals(UsageFoldModel.REQUEST_STATUSES),
  calls: integer,
  durationSumMs: Schema.Number,
  ...otelBucketRowFields,
})
const toolCategoryCountRowSchema = Schema.Struct({ category: toolCategory, outcome: toolOutcome, calls: integer })
const toolSourceCountRowSchema = Schema.Struct({
  category: toolCategory,
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(120)),
  owner: textColumn,
  calls: integer,
})
const toolDurationRowSchema = Schema.Struct({
  category: toolCategory,
  outcome: toolOutcome,
  calls: integer,
  durationSumMs: Schema.Number,
  ...otelBucketRowFields,
})
const jevCountRowSchema = Schema.Struct({ source: Schema.Literals(JEV_USAGE_SOURCES), outcome: Schema.Literals(JEV_USAGE_OUTCOMES), calls: integer })
const jevTokenRowSchema = Schema.Struct({ source: Schema.Literals(JEV_USAGE_SOURCES), input: integer, output: integer })
const jevDurationRowSchema = Schema.Struct({
  source: Schema.Literals(JEV_USAGE_SOURCES),
  outcome: Schema.Literals(JEV_USAGE_OUTCOMES),
  calls: integer,
  durationSumMs: Schema.Number,
  ...otelBucketRowFields,
})

const decode = {
  requests: listOf(requestRowSchema),
  counts: listOf(countRowSchema),
  file: oneOf(fileRowSchema),
  buckets: listOf(bucketRowSchema),
  breakdown: listOf(breakdownRowSchema),
  latency: listOf(latencyRowSchema),
  threads: listOf(threadRowSchema),
  tools: listOf(toolRowSchema),
  durationTotal: oneOf(durationTotalSchema),
  identifierActivity: listOf(identifierActivityRowSchema),
  toolActivity: listOf(toolActivityRowSchema),
  activityCategories: listOf(activityCategoryRowSchema),
  timeline: listOf(timelineRowSchema),
  activityTotals: oneOf(activityTotalsRowSchema),
  jevEvents: listOf(jevEventRowSchema),
  jevOutcomes: listOf(jevOutcomeRowSchema),
  jevActivity: oneOf(jevActivityRowSchema),
  summary: oneOf(summaryRowSchema),
  routeBands: listOf(routeBandRowSchema),
  waitingLive: listOf(waitingLiveRowSchema),
  id: oneOf(Schema.Struct({ id: Schema.String })),
  metaValue: oneOf(Schema.Struct({ value: Schema.String })),
  jevCredentials: listOf(jevCredentialRowSchema),
  jevOmitted: oneOf(jevOmittedRowSchema),
  toolEvents: listOf(toolEventRowSchema),
  jevSources: listOf(jevSourceRowSchema),
  jevDurationStats: oneOf(jevDurationStatsRowSchema),
  modelCounts: listOf(modelCountRowSchema),
  modelTokens: listOf(modelTokenRowSchema),
  modelDurations: listOf(modelDurationRowSchema),
  toolCategoryCounts: listOf(toolCategoryCountRowSchema),
  toolSourceCounts: listOf(toolSourceCountRowSchema),
  toolDurations: listOf(toolDurationRowSchema),
  jevCounts: listOf(jevCountRowSchema),
  jevTokens: listOf(jevTokenRowSchema),
  jevDurations: listOf(jevDurationRowSchema),
  storeCounts: oneOf(Schema.Struct({ files: Schema.Number, requests: Schema.Number })),
}

type Rows<S extends Schema.Top> = ReadonlyArray<S['Type']>

const otlpRequestOf = (input: {
  readonly range: OtelMetricsRange
  readonly modelCountRows: Rows<typeof modelCountRowSchema>
  readonly modelTokenRows: Rows<typeof modelTokenRowSchema>
  readonly modelDurationRows: Rows<typeof modelDurationRowSchema>
  readonly toolCategoryRows: Rows<typeof toolCategoryCountRowSchema>
  readonly toolSourceRows: Rows<typeof toolSourceCountRowSchema>
  readonly toolDurationRows: Rows<typeof toolDurationRowSchema>
  readonly jevCountRows: Rows<typeof jevCountRowSchema>
  readonly jevTokenRows: Rows<typeof jevTokenRowSchema>
  readonly jevDurationRows: Rows<typeof jevDurationRowSchema>
}): OtlpMetricsRequest => {
  const {
    range,
    modelCountRows,
    modelTokenRows,
    modelDurationRows,
    toolCategoryRows,
    toolSourceRows,
    toolDurationRows,
    jevCountRows,
    jevTokenRows,
    jevDurationRows,
  } = input
  const counters: OtlpCounterInput[] = []
  if (modelCountRows.length > 0)
    counters.push({
      name: 'dsh.model.request.count',
      description: 'Recorded model requests by provider, model, purpose, and outcome.',
      unit: '{request}',
      points: modelCountRows.map(row => ({
        attributes: {
          'gen_ai.provider.name': row.provider,
          'gen_ai.request.model': row.model,
          'dsh.request.purpose': row.purpose,
          'dsh.request.outcome': row.status,
        },
        value: row.calls,
      })),
    })
  const tokenPoints = modelTokenRows.flatMap(row =>
    [
      { type: 'input', value: row.input },
      { type: 'cache_read', value: row.cacheRead },
      { type: 'cache_write', value: row.cacheWrite },
      { type: 'output', value: row.output },
      { type: 'reasoning', value: row.reasoning },
    ]
      .filter(token => token.value > 0)
      .map(token => ({
        attributes: {
          'gen_ai.provider.name': row.provider,
          'gen_ai.request.model': row.model,
          'dsh.request.purpose': row.purpose,
          'gen_ai.token.type': token.type,
        },
        value: token.value,
      })),
  )
  if (tokenPoints.length > 0)
    counters.push({ name: 'dsh.model.token.usage', description: 'Recorded model tokens by token type.', unit: '{token}', points: tokenPoints })
  if (toolCategoryRows.length > 0)
    counters.push({
      name: 'dsh.tool.execution.count',
      description: 'Recorded tool executions by source category and outcome; exact for the selected interval.',
      unit: '{execution}',
      points: toolCategoryRows.map(row => ({ attributes: { 'dsh.tool.category': row.category, 'dsh.tool.outcome': row.outcome }, value: row.calls })),
    })
  if (toolSourceRows.length > 0)
    counters.push({
      name: 'dsh.tool.source.execution.count',
      description: 'Recorded tool executions for up to the 500 most-used named tool sources; category totals are exported separately.',
      unit: '{execution}',
      points: toolSourceRows.map(row => {
        const point = {
          attributes: { 'dsh.tool.category': row.category, 'dsh.tool.name': row.name },
          value: row.calls,
        }
        if (row.owner === null) return point
        return { attributes: { ...point.attributes, 'dsh.tool.owner': row.owner }, value: point.value }
      }),
    })
  if (jevCountRows.length > 0)
    counters.push({
      name: 'dsh.jev.request.count',
      description: 'Recorded Jev requests by calling plugin and outcome.',
      unit: '{request}',
      points: jevCountRows.map(row => ({ attributes: { 'dsh.jev.source': row.source, 'dsh.jev.outcome': row.outcome }, value: row.calls })),
    })
  const jevTokenPoints = jevTokenRows.flatMap(row =>
    [
      { type: 'input', value: row.input },
      { type: 'output', value: row.output },
    ]
      .filter(token => token.value > 0)
      .map(token => ({ attributes: { 'dsh.jev.source': row.source, 'gen_ai.token.type': token.type }, value: token.value })),
  )
  if (jevTokenPoints.length > 0)
    counters.push({
      name: 'dsh.jev.token.usage',
      description: 'Provider-reported Jev tokens by calling plugin and token type.',
      unit: '{token}',
      points: jevTokenPoints,
    })

  const bucketCountsOf = (row: Schema.Schema.Type<typeof OTEL_HISTOGRAM_BASE_ROW_SCHEMA>): number[] => {
    const cumulative = [
      row.bucket0,
      row.bucket1,
      row.bucket2,
      row.bucket3,
      row.bucket4,
      row.bucket5,
      row.bucket6,
      row.bucket7,
      row.bucket8,
      row.bucket9,
      row.bucket10,
      row.bucket11,
      row.bucket12,
      row.calls,
    ]
    return cumulative.map((value, index) => value - (cumulative[index - 1] ?? 0))
  }
  const histograms: OtlpHistogramInput[] = []
  if (modelDurationRows.length > 0)
    histograms.push({
      name: 'dsh.model.request.duration',
      description: 'Recorded model request duration distribution.',
      unit: 's',
      bounds: OTEL_DURATION_BOUNDS_SECONDS,
      points: modelDurationRows.map(row => ({
        attributes: {
          'gen_ai.provider.name': row.provider,
          'gen_ai.request.model': row.model,
          'dsh.request.purpose': row.purpose,
          'dsh.request.outcome': row.status,
        },
        count: row.calls,
        sum: row.durationSumMs / 1_000,
        bucketCounts: bucketCountsOf(row),
      })),
    })
  if (toolDurationRows.length > 0)
    histograms.push({
      name: 'dsh.tool.execution.duration',
      description: 'Recorded tool execution duration distribution by category and outcome.',
      unit: 's',
      bounds: OTEL_DURATION_BOUNDS_SECONDS,
      points: toolDurationRows.map(row => ({
        attributes: { 'dsh.tool.category': row.category, 'dsh.tool.outcome': row.outcome },
        count: row.calls,
        sum: row.durationSumMs / 1_000,
        bucketCounts: bucketCountsOf(row),
      })),
    })
  if (jevDurationRows.length > 0)
    histograms.push({
      name: 'dsh.jev.request.duration',
      description: 'Recorded Jev request duration distribution by calling plugin and outcome.',
      unit: 's',
      bounds: OTEL_DURATION_BOUNDS_SECONDS,
      points: jevDurationRows.map(row => ({
        attributes: { 'dsh.jev.source': row.source, 'dsh.jev.outcome': row.outcome },
        count: row.calls,
        sum: row.durationSumMs / 1_000,
        bucketCounts: bucketCountsOf(row),
      })),
    })

  return createOtlpMetricsRequest({
    from: range.from,
    to: range.to,
    temporality: range.temporality,
    serviceName: range.serviceName,
    counters,
    histograms,
  })
}

type SqlParam = string | number | null

/** 100 rows × 24 columns stays far below SQLite's 32 766 bound parameters. */
const UPSERT_BATCH_ROWS = 100

export interface LogSlice {
  readonly path: string
  readonly sessionId: string
  readonly offset: number
  readonly size: number
  readonly mtimeMs: number
  readonly state: string
  readonly session: SessionMeta | null
  readonly rows: readonly RequestRow[]
  readonly tools?: readonly ToolExecutionRow[]
}

export type FileCursor = Schema.Schema.Type<typeof fileRowSchema>

export interface ActivityQuery {
  readonly from: number
  readonly to: number
  readonly category?: 'api' | 'mcp' | 'plugin' | 'tool' | 'skill' | 'other'
  readonly limit?: number
  readonly eventLimit?: number
  /** Timeline bucket; defaults to a local day. */
  readonly bucket?: 'hour' | 'day'
  readonly tzOffsetMinutes?: number
}

export interface OtelMetricsRange {
  readonly from: number
  readonly to: number
  readonly temporality: OtlpTemporality
  readonly serviceName: string
}

type RepoEffect<A> = Effect.Effect<A, UsageStoreFailed>

/**
 * The usage index on the plugin's SQLite file. Writes are transactions; reads decode every row with its schema. Every
 * failure is a `UsageStoreFailed` naming the operation, so the caller sees one stable wire code.
 */
export class UsageRepo extends Context.Service<
  UsageRepo,
  {
    readonly fileCursor: (path: string) => RepoEffect<Option.Option<FileCursor>>
    /** Commit one log slice: its rows, its session and the new cursor, or none of them. */
    readonly commitLogSlice: (slice: LogSlice) => RepoEffect<void>
    readonly insertLiveCall: (row: RequestRow) => RepoEffect<void>
    readonly reconcileLiveCalls: (now: number) => RepoEffect<number>
    readonly pruneTelemetry: (now: number) => RepoEffect<void>
    readonly routeBands: () => RepoEffect<readonly RouteBand[]>
    readonly unratedRouteBands: () => RepoEffect<readonly RouteBand[]>
    readonly writeRates: (input: {
      readonly rates: ReadonlyMap<string, { readonly route: RouteBand; readonly rates: Rates }>
      readonly replace: boolean
    }) => RepoEffect<void>
    readonly getMeta: (key: string) => RepoEffect<string | null>
    readonly setMeta: (input: { readonly key: string; readonly value: string }) => RepoEffect<void>
    readonly requests: (query: RequestQuery) => RepoEffect<RequestPage>
    readonly charts: (query: ChartQuery) => RepoEffect<ChartView>
    readonly recordJevUsage: (record: JevUsageRecord) => RepoEffect<void>
    readonly jevUsage: (query: JevUsageQuery) => RepoEffect<JevUsageView>
    readonly activity: (query: ActivityQuery) => RepoEffect<ActivityReport>
    readonly otelMetrics: (range: OtelMetricsRange) => RepoEffect<OtlpMetricsRequest>
    readonly syncToolSources: (sources: ReadonlyMap<string, { readonly category: RegistryToolSource; readonly owner: string | null }>) => RepoEffect<void>
    readonly counts: () => RepoEffect<{ readonly files: number; readonly requests: number }>
  }
>()('@dshfiles/usage/UsageRepo') {
  /** Over a caller-provided client, for a test that must also assert raw rows. */
  static readonly layerOverClient = Layer.effect(
    UsageRepo,
    Effect.flatMap(SqlClient.SqlClient, sql => make(sql)),
  )
  /**
   * The plugin's own file, opened on the first read or write that needs it: activation builds the service, not the
   * SQLite connection with its schema checks, and an idle panel costs the Host nothing.
   */
  static readonly layerAt = (filename: string) =>
    SqliteStore.deferred(
      UsageRepo,
      Layer.effect(
        UsageRepo,
        SqliteStore.make({ filename, migrations: usageMigrations, legacyUserVersion: LEGACY_USER_VERSION }).pipe(
          Effect.mapError(cause => new UsageStoreFailed({ operation: 'open', cause })),
          Effect.flatMap(make),
        ),
      ).pipe(Layer.provide(Reactivity.layer), Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer))),
    )
  static readonly layer = Layer.unwrap(Effect.sync(() => UsageRepo.layerAt(dshHomePath('plugins', 'usage', 'usage.db'))))
}

const make = (sql: SqlClient.SqlClient) =>
  Effect.gen(function* () {
    const failed = (operation: string) => (cause: unknown) => new UsageStoreFailed({ operation, cause })

    const run = (text: string, params: ReadonlyArray<SqlParam> = []) => Effect.asVoid(sql.unsafe(text, params))
    // Reports read the hot table and the cold archive as one, so the archive exists before the first report runs.
    yield* run(ARCHIVE_DDL)
    const read = <A>(decodeRows: (input: unknown) => Effect.Effect<A, Schema.SchemaError>, text: string, params: ReadonlyArray<SqlParam> = []) =>
      Effect.flatMap(sql.unsafe(text, params), decodeRows)
    const readFirst = <A>(decodeRow: (input: unknown) => Effect.Effect<A, Schema.SchemaError>, text: string, params: ReadonlyArray<SqlParam> = []) =>
      Effect.flatMap(sql.unsafe(text, params), rows => decodeRow(rows[0]))
    const readOption = <A>(decodeRow: (input: unknown) => Effect.Effect<A, Schema.SchemaError>, text: string, params: ReadonlyArray<SqlParam> = []) =>
      Effect.flatMap(sql.unsafe(text, params), rows => (rows[0] === undefined ? Effect.succeedNone : Effect.asSome(decodeRow(rows[0]))))

    // Rows are folded once and only topped up afterwards, so a fold that reads logs differently re-reads them all.
    const foldVersion = yield* readOption(decode.metaValue, "SELECT value FROM meta WHERE key = 'foldVersion'")
    if (Option.getOrUndefined(foldVersion)?.value !== String(FOLD_VERSION)) {
      yield* Effect.all(
        [
          run('DELETE FROM files'),
          run("DELETE FROM requests WHERE source = 'log'"),
          run('DELETE FROM tools'),
          run("UPDATE requests SET merged_into = NULL, settled = 0 WHERE purpose IN ('title', 'compaction')"),
          run("INSERT OR REPLACE INTO meta (key, value) VALUES ('foldVersion', ?)", [String(FOLD_VERSION)]),
        ],
        { discard: true },
      ).pipe(sql.withTransaction)
    }

    /** Routes with usage, keyed by `routeBandKey`; read on the first pricing pass and topped up as requests with usage land. */
    const pricedRoutes = yield* Ref.make(Option.none<ReadonlyMap<string, RouteBand>>())
    const routeBandKey = (route: RouteBand): string => `${route.provider}\u0000${route.model}\u0000${String(route.band)}`

    const prune = (now: number) =>
      Effect.all(
        [
          run('DELETE FROM tools WHERE started_at < ?', [now - TOOL_RETENTION_MS]),
          run('INSERT OR IGNORE INTO requests_archive SELECT * FROM requests WHERE started_at < ?', [now - REQUEST_RETENTION_MS]),
          run('DELETE FROM requests WHERE started_at < ?', [now - REQUEST_RETENTION_MS]),
          run("UPDATE tools SET outcome = 'unknown' WHERE outcome = 'pending' AND started_at < ?", [now - MAX_PENDING_MS]),
        ],
        { discard: true },
      )

    /** One statement per batch of rows: a log slice holds hundreds of rows, and each statement is a round trip through the client. */
    const upsertBatches = <Row>(input: {
      readonly rows: ReadonlyArray<Row>
      readonly statement: (tuples: string) => string
      readonly tuple: string
      readonly params: (row: Row) => ReadonlyArray<SqlParam>
    }) =>
      Effect.forEach(
        Array.from({ length: Math.ceil(input.rows.length / UPSERT_BATCH_ROWS) }, (_, index) =>
          input.rows.slice(index * UPSERT_BATCH_ROWS, (index + 1) * UPSERT_BATCH_ROWS),
        ),
        batch => run(input.statement(batch.map(() => input.tuple).join(', ')), batch.flatMap(input.params)),
        { discard: true },
      )

    const bandOf = (row: RequestRow): number =>
      row.usage === null ? 0 : CostEstimateModel.contextBand(row.usage.input + row.usage.cacheRead + row.usage.cacheWrite)

    const upsertRequests = Effect.fnUntraced(function* (input: { readonly rows: ReadonlyArray<RequestRow>; readonly settled: (row: RequestRow) => boolean }) {
      yield* upsertBatches({
        rows: input.rows,
        tuple: '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)',
        statement:
          tuples => `INSERT INTO requests (id, session_id, seq, message_id, turn, step, purpose, source, provider, model, started_at, ended_at, ttft_ms,
             input, cache_read, cache_write, output, reasoning, band, status, stop_reason, error_code, merged_into, settled)
           VALUES ${tuples}
           ON CONFLICT (id) DO UPDATE SET
             seq = excluded.seq, message_id = excluded.message_id, turn = excluded.turn, step = excluded.step, purpose = excluded.purpose,
             provider = excluded.provider, model = excluded.model, started_at = excluded.started_at, ended_at = excluded.ended_at,
             ttft_ms = COALESCE(excluded.ttft_ms, requests.ttft_ms),
             input = COALESCE(excluded.input, requests.input), cache_read = COALESCE(excluded.cache_read, requests.cache_read),
             cache_write = COALESCE(excluded.cache_write, requests.cache_write), output = COALESCE(excluded.output, requests.output),
             reasoning = COALESCE(excluded.reasoning, requests.reasoning),
             band = CASE WHEN excluded.input IS NULL THEN requests.band ELSE excluded.band END,
             status = excluded.status, stop_reason = excluded.stop_reason, error_code = excluded.error_code`,
        params: row => [
          row.id,
          row.sessionId,
          row.seq,
          row.messageId,
          row.turn,
          row.step,
          row.purpose,
          row.source,
          row.provider,
          row.model,
          Math.round(row.startedAt),
          row.endedAt === null ? null : Math.round(row.endedAt),
          row.ttftMs === null ? null : Math.round(row.ttftMs),
          row.usage?.input ?? null,
          row.usage?.cacheRead ?? null,
          row.usage?.cacheWrite ?? null,
          row.usage?.output ?? null,
          row.usage?.reasoning ?? null,
          bandOf(row),
          row.status,
          row.stopReason,
          row.errorCode,
          input.settled(row) ? 1 : 0,
        ],
      })
      const priced = input.rows.filter(row => row.usage !== null).map(row => ({ provider: row.provider, model: row.model, band: bandOf(row) }))
      if (priced.length === 0) return
      yield* Ref.update(
        pricedRoutes,
        Option.map(routes => new Map([...routes, ...priced.map(route => [routeBandKey(route), route] as const)])),
      )
    })

    const upsertToolExecutions = (rows: ReadonlyArray<Schema.Schema.Type<typeof toolRowSchema>>) =>
      upsertBatches({
        rows,
        tuple: '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        statement:
          tuples => `INSERT INTO tools (id, session_id, seq, turn, step, name, started_at, ended_at, outcome, category, owner, normalized_command, test_runner, result_chars)
           VALUES ${tuples}
           ON CONFLICT (id) DO UPDATE SET turn = excluded.turn, step = excluded.step, name = excluded.name,
             started_at = excluded.started_at, ended_at = excluded.ended_at, outcome = excluded.outcome,
             category = excluded.category, owner = excluded.owner, normalized_command = excluded.normalized_command,
             test_runner = excluded.test_runner, result_chars = COALESCE(excluded.result_chars, tools.result_chars)`,
        params: row => [
          row.id,
          row.sessionId,
          row.seq,
          row.turn,
          row.step,
          row.name,
          row.startedAt,
          row.endedAt,
          row.outcome,
          row.category,
          row.owner,
          row.normalizedCommand,
          row.testRunner,
          row.resultChars,
        ],
      })

    const upsertSession = (session: SessionMeta) =>
      run(
        `INSERT INTO sessions (id, cwd, project, title, parent_session, subagent, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (id) DO UPDATE SET cwd = excluded.cwd, project = excluded.project, title = COALESCE(excluded.title, sessions.title),
             parent_session = excluded.parent_session, subagent = excluded.subagent, created_at = excluded.created_at`,
        [session.id, session.cwd, projectOf(session.cwd), session.title, session.parentSession, session.subagent ? 1 : 0, session.createdAt],
      )

    const fileCursor = Effect.fnUntraced(
      function* (path: string) {
        return yield* readOption(decode.file, 'SELECT path, offset, size, mtime_ms, state FROM files WHERE path = ?', [path])
      },
      Effect.mapError(failed('file cursor')),
    )

    const commitLogSlice = Effect.fnUntraced(
      function* (slice: LogSlice) {
        const now = yield* Clock.currentTimeMillis
        yield* upsertRequests({ rows: slice.rows, settled: () => true })
        yield* upsertToolExecutions(yield* decode.tools(slice.tools ?? []))
        yield* prune(now)
        if (slice.session !== null) yield* upsertSession(slice.session)
        yield* run(
          `INSERT INTO files (path, session_id, offset, size, mtime_ms, state) VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT (path) DO UPDATE SET session_id = excluded.session_id, offset = excluded.offset, size = excluded.size,
               mtime_ms = excluded.mtime_ms, state = excluded.state`,
          [slice.path, slice.sessionId, slice.offset, slice.size, slice.mtimeMs, slice.state],
        )
      },
      sql.withTransaction,
      Effect.mapError(failed('commit log slice')),
    )

    // Side calls the log also records wait for reconciliation; the rest count at once.
    const insertLiveCall = Effect.fnUntraced(
      function* (row: RequestRow) {
        yield* upsertRequests({ rows: [row], settled: live => live.purpose !== 'title' && live.purpose !== 'compaction' })
      },
      Effect.mapError(failed('insert live call')),
    )

    /**
     * Fold each waiting live call into the log row describing the same request (titles gain the usage the log never
     * kept), or let it stand on its own once no log row turned up in time.
     */
    const reconcileLiveCalls = Effect.fn('usage live calls reconcile')(
      function* (now: number) {
        const waiting = yield* read(decode.waitingLive, "SELECT id, session_id, purpose, started_at FROM requests WHERE settled = 0 AND source = 'live'")
        const merged = yield* Effect.forEach(waiting, live =>
          Effect.gen(function* () {
            const match = yield* readOption(
              decode.id,
              `SELECT id FROM requests r WHERE r.source = 'log' AND r.session_id = ? AND r.purpose = ? AND r.started_at BETWEEN ? AND ?
                   AND NOT EXISTS (SELECT 1 FROM requests m WHERE m.merged_into = r.id)
                 ORDER BY ABS(r.started_at - ?) LIMIT 1`,
              [live.session_id, live.purpose, live.started_at - LIVE_MATCH_WINDOW_MS, live.started_at + LIVE_MATCH_WINDOW_MS, live.started_at],
            )
            if (Option.isNone(match)) {
              if (live.started_at < now - LIVE_MATCH_WAIT_MS) yield* run('UPDATE requests SET settled = 1 WHERE id = ?', [live.id])
              return false
            }
            yield* run(
              `UPDATE requests SET
                   input = COALESCE(input, (SELECT input FROM requests WHERE id = ?)),
                   cache_read = COALESCE(cache_read, (SELECT cache_read FROM requests WHERE id = ?)),
                   cache_write = COALESCE(cache_write, (SELECT cache_write FROM requests WHERE id = ?)),
                   output = COALESCE(output, (SELECT output FROM requests WHERE id = ?)),
                   reasoning = COALESCE(reasoning, (SELECT reasoning FROM requests WHERE id = ?)),
                   ttft_ms = COALESCE(ttft_ms, (SELECT ttft_ms FROM requests WHERE id = ?)),
                   band = CASE WHEN input IS NULL THEN (SELECT band FROM requests WHERE id = ?) ELSE band END
                 WHERE id = ?`,
              [live.id, live.id, live.id, live.id, live.id, live.id, live.id, match.value.id],
            )
            yield* run('UPDATE requests SET merged_into = ?, settled = 1 WHERE id = ?', [match.value.id, live.id])
            return true
          }),
        ).pipe(sql.withTransaction)
        return merged.filter(Boolean).length
      },
      Effect.mapError(failed('reconcile live calls')),
    )

    const pruneTelemetry = Effect.fn('usage telemetry prune')((now: number) => prune(now).pipe(sql.withTransaction), Effect.mapError(failed('prune telemetry')))

    const allRouteBands = read(decode.routeBands, 'SELECT DISTINCT provider, model, band FROM requests WHERE input IS NOT NULL')

    /**
     * Pricing runs after every index pass and asked SQLite for the distinct routes of all 150 000 requests each time
     * (50–450 ms on the Host's event loop). The set is read once and topped up as requests with usage land.
     */
    const unratedRouteBands = Effect.gen(function* () {
      const known = yield* Ref.get(pricedRoutes)
      const routes = Option.isSome(known) ? known.value : new Map((yield* allRouteBands).map(route => [routeBandKey(route), route] as const))
      if (Option.isNone(known)) yield* Ref.set(pricedRoutes, Option.some(routes))
      const rated = new Set((yield* read(decode.routeBands, 'SELECT provider, model, band FROM route_rates')).map(routeBandKey))
      return [...routes.values()].filter(route => !rated.has(routeBandKey(route)))
    }).pipe(Effect.mapError(failed('unrated route bands')))

    /** Replace every rate (`replace: true`) or add the missing ones. */
    const writeRates = Effect.fn('usage rates write')(
      function* (input: { readonly rates: ReadonlyMap<string, { readonly route: RouteBand; readonly rates: Rates }>; readonly replace: boolean }) {
        if (input.replace) yield* run('DELETE FROM route_rates')
        yield* Effect.forEach(
          input.rates.values(),
          entry =>
            run('INSERT OR REPLACE INTO route_rates (provider, model, band, input, output, cache_read, cache_write) VALUES (?, ?, ?, ?, ?, ?, ?)', [
              entry.route.provider,
              entry.route.model,
              entry.route.band,
              entry.rates.input,
              entry.rates.output,
              entry.rates.cacheRead,
              entry.rates.cacheWrite,
            ]),
          { discard: true },
        )
      },
      sql.withTransaction,
      Effect.mapError(failed('write rates')),
    )

    const getMeta = Effect.fnUntraced(
      function* (key: string) {
        return Option.getOrNull(Option.map(yield* readOption(decode.metaValue, 'SELECT value FROM meta WHERE key = ?', [key]), row => row.value))
      },
      Effect.mapError(failed('read meta')),
    )

    const setMeta = Effect.fnUntraced(
      function* (input: { readonly key: string; readonly value: string }) {
        yield* run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [input.key, input.value])
      },
      Effect.mapError(failed('write meta')),
    )

    const rangeFilter = (query: {
      readonly from: number
      readonly to: number
      readonly purposes?: readonly string[] | undefined
      readonly provider?: string | undefined
    }) => {
      const clauses = [VISIBLE_SQL, 'r.started_at >= ?', 'r.started_at < ?']
      const params: SqlParam[] = [query.from, query.to]
      if (query.provider !== undefined) {
        clauses.push('r.provider = ? COLLATE BINARY')
        params.push(query.provider)
      }
      if (query.purposes !== undefined && query.purposes.length > 0) {
        clauses.push(`r.purpose IN (${query.purposes.map(() => '?').join(', ')})`)
        params.push(...query.purposes)
      }
      return { clauses, params }
    }

    const requestFilter = (query: RequestQuery, withPurposes: boolean) => {
      const filter = rangeFilter(withPurposes ? query : { from: query.from, to: query.to, provider: query.provider })
      if (query.search !== undefined) {
        const like = `%${query.search.toLowerCase().replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
        filter.clauses.push(
          "(LOWER(r.model) LIKE ? ESCAPE '\\' OR LOWER(r.provider) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(s.project, '')) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(s.title, '')) LIKE ? ESCAPE '\\')",
        )
        filter.params.push(like, like, like, like)
      }
      if (query.sessionId !== undefined) {
        filter.clauses.push('r.session_id = ?')
        filter.params.push(query.sessionId)
      }
      return { where: filter.clauses.join(' AND '), params: filter.params }
    }

    const requests = Effect.fn('usage requests read')(
      function* (query: RequestQuery) {
        const filter = requestFilter(query, true)
        const statusCounts = yield* read(
          decode.counts,
          `SELECT r.status AS key, COUNT(*) AS count FROM ${FROM_SQL} WHERE ${filter.where} GROUP BY r.status`,
          filter.params,
        )
        const unfiltered = requestFilter(query, false)
        const purposeCounts = yield* read(
          decode.counts,
          `SELECT r.purpose AS key, COUNT(*) AS count FROM ${FROM_SQL} WHERE ${unfiltered.where} GROUP BY r.purpose`,
          unfiltered.params,
        )
        const statusClause = query.status === undefined ? '' : ' AND r.status = ?'
        const rows = yield* read(
          decode.requests,
          `SELECT r.id, r.session_id, s.title, s.parent_session, s.project, s.cwd, r.seq, r.message_id, r.turn, r.step, r.purpose, r.provider, r.model, r.started_at,
             CASE WHEN r.ended_at IS NULL THEN NULL ELSE r.ended_at - r.started_at END AS duration_ms, r.ttft_ms,
             r.input, r.cache_read, r.cache_write, r.output, ${COST_SQL} AS cost, r.status, r.stop_reason, r.error_code
           FROM ${FROM_SQL} WHERE ${filter.where}${statusClause}
           ORDER BY ${SORT_SQL[query.sort]} IS NULL, ${SORT_SQL[query.sort]} ${query.direction === 'asc' ? 'ASC' : 'DESC'}, r.started_at DESC
           LIMIT ?`,
          [...filter.params, ...(query.status === undefined ? [] : [query.status]), query.limit],
        )
        const total = statusCounts.reduce((sum, row) => sum + row.count, 0)
        return {
          ...(query.provider !== undefined && { appliedProvider: query.provider }),
          rows: rows.map((row): RequestView => ({
            id: row.id,
            sessionId: row.session_id,
            sessionTitle: row.title,
            parentSessionId: row.parent_session,
            project: row.project,
            cwd: row.cwd,
            seq: row.seq,
            messageId: row.message_id,
            turn: row.turn,
            step: row.step,
            purpose: row.purpose,
            provider: row.provider,
            model: row.model,
            startedAt: row.started_at,
            durationMs: row.duration_ms,
            ttftMs: row.ttft_ms,
            input: row.input,
            cacheRead: row.cache_read,
            cacheWrite: row.cache_write,
            output: row.output,
            cost: row.cost,
            status: row.status,
            stopReason: row.stop_reason,
            errorCode: row.error_code,
          })),
          total,
          statusCounts: Object.fromEntries([['all', total], ...statusCounts.map(row => [row.key, row.count] as const)]),
          purposeCounts: Object.fromEntries(purposeCounts.map(row => [row.key, row.count] as const)),
        } satisfies RequestPage
      },
      Effect.mapError(failed('requests')),
    )

    const summaryOf = (filter: ReturnType<typeof rangeFilter>) =>
      readFirst(
        decode.summary,
        `SELECT COALESCE(SUM(${COST_SQL}), 0) AS cost, COUNT(*) AS requests,
             COALESCE(SUM(r.status = 'failed'), 0) AS failed, COALESCE(SUM(r.status = 'aborted'), 0) AS aborted,
             COALESCE(SUM(r.input), 0) AS input, COALESCE(SUM(r.cache_read), 0) AS cache_read,
             COALESCE(SUM(r.cache_write), 0) AS cache_write, COALESCE(SUM(r.output), 0) AS output,
             COALESCE(SUM(r.input IS NOT NULL AND rr.provider IS NULL), 0) AS unpriced,
             COALESCE(SUM(r.input IS NULL OR r.output IS NULL OR r.cache_read IS NULL OR r.cache_write IS NULL), 0) AS missing_usage,
             AVG(CASE WHEN r.ended_at >= r.started_at THEN r.ended_at - r.started_at END) AS average_duration_ms,
             COALESCE(SUM(${CACHE_SAVINGS_SQL}), 0) AS cacheSavings, ${TURNS_SQL} AS turns
           FROM ${FROM_SQL} WHERE ${filter.clauses.join(' AND ')}`,
        filter.params,
      )

    const charts = Effect.fn('usage charts read')(
      function* (query: ChartQuery) {
        const filter = rangeFilter(query)
        const where = filter.clauses.join(' AND ')
        const bucketMs = query.bucket === 'hour' ? 3_600_000 : 86_400_000
        const offsetMs = query.tzOffsetMinutes * 60_000
        const bucketSql = `((r.started_at + ${String(offsetMs)}) / ${String(bucketMs)}) * ${String(bucketMs)} - ${String(offsetMs)}`
        const dimensionSql = { model: 'r.model', provider: 'r.provider', project: "COALESCE(s.project, '(none)')", purpose: 'r.purpose' } as const

        const breakdown = (dimension: keyof typeof dimensionSql) =>
          read(
            decode.breakdown,
            `SELECT ${dimensionSql[dimension]} AS key, COALESCE(SUM(${COST_SQL}), 0) AS cost, COUNT(*) AS requests,
                 COUNT(DISTINCT r.session_id) AS sessions, COALESCE(SUM(r.input), 0) AS input, COALESCE(SUM(r.cache_read), 0) AS cache_read,
                 COALESCE(SUM(r.cache_write), 0) AS cache_write, COALESCE(SUM(r.output), 0) AS output, COALESCE(SUM(${TOKENS_SQL}), 0) AS tokens,
                 COALESCE(SUM(r.input IS NULL OR r.output IS NULL OR r.cache_read IS NULL OR r.cache_write IS NULL), 0) AS missing_usage,
                 COALESCE(SUM(r.input IS NOT NULL AND rr.provider IS NULL), 0) AS unpriced
               FROM ${FROM_SQL} WHERE ${where} GROUP BY key ORDER BY cost DESC, requests DESC`,
            filter.params,
          ).pipe(
            Effect.map(rows =>
              rows.map(row => ({
                key: row.key ?? '(none)',
                cost: row.cost,
                requests: row.requests,
                sessions: row.sessions,
                input: row.input,
                cacheRead: row.cache_read,
                cacheWrite: row.cache_write,
                output: row.output,
                tokens: row.tokens,
                missingUsage: row.missing_usage,
                unpriced: row.unpriced,
              })),
            ),
          )

        const byDimension = yield* Effect.all({
          model: breakdown('model'),
          provider: breakdown('provider'),
          project: breakdown('project'),
          purpose: breakdown('purpose'),
        })
        const ranked = byDimension[query.groupBy]
        const leading = new Set(ranked.slice(0, ranked.length > SERIES_KEYS ? SERIES_KEYS - 1 : SERIES_KEYS).map(row => row.key))
        const keys = [...leading, ...(ranked.length > leading.size ? [OTHER_KEY] : [])]

        const rawBuckets = yield* read(
          decode.buckets,
          `SELECT ${bucketSql} AS start, ${dimensionSql[query.groupBy]} AS key, COALESCE(SUM(${COST_SQL}), 0) AS cost, COUNT(*) AS requests,
             COALESCE(SUM(r.status = 'failed'), 0) AS failed, COALESCE(SUM(r.input), 0) AS input, COALESCE(SUM(r.cache_read), 0) AS cache_read,
             COALESCE(SUM(r.cache_write), 0) AS cache_write, COALESCE(SUM(r.output), 0) AS output,
              COALESCE(SUM(r.input IS NULL OR r.output IS NULL OR r.cache_read IS NULL OR r.cache_write IS NULL), 0) AS missing_usage,
              COALESCE(SUM(r.input IS NOT NULL AND rr.provider IS NULL), 0) AS unpriced
           FROM ${FROM_SQL} WHERE ${where} GROUP BY start, key ORDER BY start`,
          filter.params,
        )
        const merged = new Map<string, ChartView['buckets'][number]>()
        for (const row of rawBuckets) {
          const key = row.key !== null && leading.has(row.key) ? row.key : OTHER_KEY
          const id = `${String(row.start)}|${key}`
          const previous = merged.get(id)
          merged.set(id, {
            start: row.start,
            key,
            cost: (previous?.cost ?? 0) + row.cost,
            requests: (previous?.requests ?? 0) + row.requests,
            failed: (previous?.failed ?? 0) + row.failed,
            input: (previous?.input ?? 0) + row.input,
            cacheRead: (previous?.cacheRead ?? 0) + row.cache_read,
            cacheWrite: (previous?.cacheWrite ?? 0) + row.cache_write,
            output: (previous?.output ?? 0) + row.output,
            missingUsage: (previous?.missingUsage ?? 0) + row.missing_usage,
            unpriced: (previous?.unpriced ?? 0) + row.unpriced,
          })
        }

        const latencyRows = yield* read(
          decode.latency,
          `SELECT ${bucketSql} AS start, r.ttft_ms, CASE WHEN r.ended_at IS NULL THEN NULL ELSE r.ended_at - r.started_at END AS duration_ms
             FROM ${FROM_SQL} WHERE ${where} AND r.status = 'ok' ORDER BY start`,
          filter.params,
        )
        const latencyByBucket = new Map<number, { ttft: number[]; duration: number[] }>()
        for (const row of latencyRows) {
          const entry = latencyByBucket.get(row.start) ?? { ttft: [], duration: [] }
          if (row.ttft_ms !== null) entry.ttft.push(row.ttft_ms)
          if (row.duration_ms !== null) entry.duration.push(row.duration_ms)
          latencyByBucket.set(row.start, entry)
        }
        const latency = [...latencyByBucket.entries()].map(([start, entry]) => {
          const ttft = entry.ttft.sort((left, right) => left - right)
          const duration = entry.duration.sort((left, right) => left - right)
          return {
            start,
            ttftP50: percentile(ttft, 0.5),
            ttftP90: percentile(ttft, 0.9),
            durationP50: percentile(duration, 0.5),
            durationP90: percentile(duration, 0.9),
          }
        })

        const topThreads = (yield* read(
          decode.threads,
          `SELECT r.session_id, s.title, s.project, COALESCE(SUM(${COST_SQL}), 0) AS cost, COUNT(*) AS requests
               FROM ${FROM_SQL} WHERE ${where} GROUP BY r.session_id ORDER BY cost DESC, requests DESC LIMIT 10`,
          filter.params,
        )).map(row => ({ sessionId: row.session_id, title: row.title, project: row.project, cost: row.cost, requests: row.requests }))

        const current = yield* summaryOf(filter)
        const span = query.to - query.from
        const previous = yield* summaryOf(rangeFilter({ from: query.from - span, to: query.from, purposes: query.purposes, provider: query.provider }))
        return {
          ...(query.provider !== undefined && { appliedProvider: query.provider }),
          summary: {
            cost: current.cost,
            requests: current.requests,
            failed: current.failed,
            aborted: current.aborted,
            input: current.input,
            cacheRead: current.cache_read,
            cacheWrite: current.cache_write,
            output: current.output,
            unpriced: current.unpriced,
            missingUsage: current.missing_usage,
            averageDurationMs: current.average_duration_ms,
            cacheSavings: current.cacheSavings,
            turns: current.turns,
            previous: {
              missingUsage: previous.missing_usage,
              unpriced: previous.unpriced,
              averageDurationMs: previous.average_duration_ms,
              cost: previous.cost,
              requests: previous.requests,
              tokens: previous.input + previous.cache_read + previous.cache_write + previous.output,
              cacheSavings: previous.cacheSavings,
              turns: previous.turns,
            },
          },
          keys,
          buckets: [...merged.values()],
          breakdown: byDimension,
          latency,
          topThreads,
        } satisfies ChartView
      },
      Effect.mapError(failed('charts')),
    )

    const recordJevUsage = Effect.fn('usage jev insert')(
      function* (record: JevUsageRecord) {
        yield* run(
          `INSERT OR IGNORE INTO jev_requests (request_id, source, started_at, duration_ms, outcome, input_tokens, output_tokens, credential)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            record.requestId,
            record.source,
            Math.round(record.startedAt),
            record.durationMs,
            record.outcome,
            record.inputTokens,
            record.outputTokens,
            record.credential,
          ],
        )
      },
      Effect.mapError(failed('record Jev usage')),
    )

    const jevUsage = Effect.fn('usage jev report')(
      function* (query: JevUsageQuery) {
        const rows = yield* read(
          decode.jevCredentials,
          `SELECT credential, COALESCE(SUM(source = 'backlog'), 0) AS backlogCalls, COALESCE(SUM(source = 'memory'), 0) AS memoryCalls, COUNT(*) AS calls,
             COALESCE(SUM(outcome = 'success'), 0) AS succeeded,
             COALESCE(SUM(outcome = 'failure'), 0) AS failed,
             COALESCE(SUM(input_tokens), 0) AS inputTokens,
             COALESCE(SUM(output_tokens), 0) AS outputTokens,
             COALESCE(SUM(input_tokens IS NULL), 0) AS callsWithoutInputUsage
           FROM jev_requests WHERE started_at >= ? AND started_at < ? GROUP BY credential ORDER BY credential LIMIT 19`,
          [query.from, query.to],
        )
        const byCredential: JevUsageBreakdown[] = rows.map(row => ({ ...row, estimatedCostUsd: (row.inputTokens * JEV_INPUT_USD_PER_MILLION) / 1_000_000 }))
        const omitted = yield* readFirst(
          decode.jevOmitted,
          `SELECT COUNT(*) AS calls, COALESCE(SUM(source = 'backlog'), 0) AS backlogCalls, COALESCE(SUM(source = 'memory'), 0) AS memoryCalls,
               COALESCE(SUM(outcome = 'success'), 0) AS succeeded, COALESCE(SUM(outcome = 'failure'), 0) AS failed,
               COALESCE(SUM(input_tokens), 0) AS inputTokens, COALESCE(SUM(output_tokens), 0) AS outputTokens,
               COALESCE(SUM(input_tokens IS NULL), 0) AS callsWithoutInputUsage
             FROM jev_requests WHERE started_at >= ? AND started_at < ? AND credential NOT IN (SELECT credential FROM jev_requests
               WHERE started_at >= ? AND started_at < ? GROUP BY credential ORDER BY credential LIMIT 19)`,
          [query.from, query.to, query.from, query.to],
        )
        if (omitted.calls > 0)
          byCredential.push({ credential: 'Other credentials', ...omitted, estimatedCostUsd: (omitted.inputTokens * JEV_INPUT_USD_PER_MILLION) / 1_000_000 })
        const totals = { calls: 0, succeeded: 0, failed: 0, inputTokens: 0, outputTokens: 0, callsWithoutInputUsage: 0 }
        for (const row of byCredential) {
          totals.calls += row.calls
          totals.succeeded += row.succeeded
          totals.failed += row.failed
          totals.inputTokens += row.inputTokens
          totals.outputTokens += row.outputTokens
          totals.callsWithoutInputUsage += row.callsWithoutInputUsage
        }
        return { ...totals, estimatedCostUsd: (totals.inputTokens * JEV_INPUT_USD_PER_MILLION) / 1_000_000, byCredential } satisfies JevUsageView
      },
      Effect.mapError(failed('Jev usage')),
    )

    const syncToolSources = Effect.fn('usage tool sources sync')(
      function* (sources: ReadonlyMap<string, { readonly category: RegistryToolSource; readonly owner: string | null }>) {
        yield* Effect.forEach(
          sources,
          ([name, source]) =>
            run("UPDATE tools SET category = ?, owner = ? WHERE name = ? AND category != 'skill' AND (category IS NOT ? OR owner IS NOT ?)", [
              source.category,
              source.owner,
              name,
              source.category,
              source.owner,
            ]),
          { discard: true },
        )
      },
      sql.withTransaction,
      Effect.mapError(failed('sync tool sources')),
    )

    const activity = Effect.fn('usage activity report')(
      function* (query: ActivityQuery) {
        const bucketMs = query.bucket === 'hour' ? 3_600_000 : 86_400_000
        const offsetMs = (query.tzOffsetMinutes ?? 0) * 60_000
        const timelineBucketSql = `((started_at + ${String(offsetMs)}) / ${String(bucketMs)}) * ${String(bucketMs)} - ${String(offsetMs)}`
        const category = query.category ?? null
        const toolRows = yield* read(
          decode.toolActivity,
          `WITH grouped AS (
            SELECT t.category, t.owner, t.name, COUNT(*) AS calls,
              SUM(CASE WHEN t.outcome = 'success' THEN 1 ELSE 0 END) AS successes,
              SUM(CASE WHEN t.outcome = 'error' THEN 1 ELSE 0 END) AS errors,
              SUM(CASE WHEN t.outcome = 'interrupted' THEN 1 ELSE 0 END) AS interrupted,
              SUM(CASE WHEN t.outcome = 'unknown' THEN 1 ELSE 0 END) AS unknown,
              SUM(CASE WHEN t.outcome = 'pending' THEN 1 ELSE 0 END) AS pending,
              MIN(t.started_at) AS firstStartedAt, MAX(t.started_at) AS lastStartedAt,
              MIN(t.ended_at) AS firstEndedAt, MAX(t.ended_at) AS lastEndedAt,
              AVG(CASE WHEN t.ended_at IS NOT NULL THEN t.ended_at - t.started_at END) AS averageDurationMs,
              COALESCE(SUM(CASE WHEN t.ended_at IS NOT NULL THEN t.ended_at - t.started_at END), 0) AS totalDurationMs,
              MAX(CASE WHEN t.ended_at IS NOT NULL THEN t.ended_at - t.started_at END) AS maxDurationMs,
              COALESCE(SUM(t.result_chars), 0) AS resultChars,
              SUM(CASE WHEN t.result_chars IS NOT NULL THEN 1 ELSE 0 END) AS measuredCalls
            FROM tools t WHERE t.started_at >= ? AND t.started_at < ? AND (? IS NULL OR t.category = ?)
            GROUP BY t.category, t.owner, t.name
          ), durations AS (
            SELECT category, owner, name, ended_at - started_at AS duration_ms,
              ROW_NUMBER() OVER (PARTITION BY category, owner, name ORDER BY ended_at - started_at) AS rank,
              COUNT(*) OVER (PARTITION BY category, owner, name) AS count
            FROM tools WHERE started_at >= ? AND started_at < ? AND ended_at IS NOT NULL AND (? IS NULL OR category = ?)
          ), duration_stats AS (
            SELECT category, owner, name,
              MAX(CASE WHEN rank = CAST(count * 0.5 AS INTEGER) + 1 THEN duration_ms END) AS p50DurationMs,
              MAX(CASE WHEN rank = CAST(count * 0.9 AS INTEGER) + 1 THEN duration_ms END) AS p90DurationMs
            FROM durations GROUP BY category, owner, name
          )
          SELECT g.name, g.category, g.owner, g.calls, g.successes, g.errors, g.interrupted, g.unknown, g.pending,
            g.firstStartedAt, g.lastStartedAt, g.firstEndedAt, g.lastEndedAt, g.averageDurationMs, g.totalDurationMs,
            ds.p50DurationMs, ds.p90DurationMs, g.maxDurationMs, g.resultChars,
            CAST((g.resultChars + 3) / 4 AS INTEGER) AS outputTokens, g.measuredCalls
          FROM grouped g LEFT JOIN duration_stats ds ON ds.category = g.category AND ds.owner IS g.owner AND ds.name = g.name
          ORDER BY g.calls DESC, g.category, g.owner, g.name LIMIT ?`,
          [query.from, query.to, category, category, query.from, query.to, category, category, query.limit ?? 100],
        )
        const identifierRows = (column: 'normalized_command' | 'test_runner') =>
          read(
            decode.identifierActivity,
            `SELECT ${column} AS identifier, COUNT(*) AS calls,
                COALESCE(SUM(CASE WHEN ended_at IS NOT NULL THEN ended_at - started_at END), 0) AS totalDurationMs,
                SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END) AS successes,
                SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) AS errors,
                SUM(CASE WHEN outcome = 'interrupted' THEN 1 ELSE 0 END) AS interrupted,
                SUM(CASE WHEN outcome = 'unknown' THEN 1 ELSE 0 END) AS unknown,
                SUM(CASE WHEN outcome = 'pending' THEN 1 ELSE 0 END) AS pending
              FROM tools WHERE started_at >= ? AND started_at < ? AND ${column} IS NOT NULL AND (? IS NULL OR category = ?)
              GROUP BY ${column} ORDER BY totalDurationMs DESC, calls DESC, identifier LIMIT 10`,
            [query.from, query.to, category, category],
          )
        const identifierDurationTotal = (column: 'normalized_command' | 'test_runner') =>
          readFirst(
            decode.durationTotal,
            `SELECT COALESCE(SUM(ended_at - started_at), 0) AS totalDurationMs FROM tools
              WHERE started_at >= ? AND started_at < ? AND ended_at IS NOT NULL AND ${column} IS NOT NULL AND (? IS NULL OR category = ?)`,
            [query.from, query.to, category, category],
          ).pipe(Effect.map(row => row.totalDurationMs))
        const commandRows = yield* identifierRows('normalized_command')
        const testRunRows = yield* identifierRows('test_runner')
        const commandDurationTotalMs = yield* identifierDurationTotal('normalized_command')
        const testRunDurationTotalMs = yield* identifierDurationTotal('test_runner')
        const jevEvents = yield* read(
          decode.jevEvents,
          'SELECT started_at AS at, started_at + duration_ms AS endedAt, duration_ms AS durationMs, source, outcome FROM jev_requests WHERE started_at >= ? AND started_at < ? ORDER BY started_at DESC LIMIT ?',
          [query.from, query.to, query.eventLimit ?? 200],
        )
        const toolEvents = yield* read(
          decode.toolEvents,
          `SELECT id, session_id, seq, turn, step, name, category, owner, started_at, ended_at, outcome FROM tools
            WHERE started_at >= ? AND started_at < ?
            ORDER BY started_at DESC LIMIT ?`,
          [query.from, query.to, query.eventLimit ?? 200],
        )
        const events = [
          ...jevEvents.map(row => ({ kind: 'jev' as const, ...row })),
          ...toolEvents.map(row => ({
            kind: 'tool' as const,
            at: row.started_at,
            endedAt: row.ended_at,
            durationMs: row.ended_at === null ? null : row.ended_at - row.started_at,
            category: row.category,
            name: row.name,
            owner: row.owner,
            outcome: row.outcome,
            turn: row.turn,
            step: row.step,
          })),
        ]
          .sort((left, right) => right.at - left.at)
          .slice(0, query.eventLimit ?? 50)
        const categoryOutcomes = (yield* read(
          decode.activityCategories,
          `WITH durations AS (
            SELECT category, ended_at - started_at AS duration_ms,
              ROW_NUMBER() OVER (PARTITION BY category ORDER BY ended_at - started_at) AS rank,
              COUNT(*) OVER (PARTITION BY category) AS count
            FROM tools WHERE started_at >= ? AND started_at < ? AND ended_at IS NOT NULL
          ), duration_stats AS (
            SELECT category,
              MAX(CASE WHEN rank = CAST(count * 0.5 AS INTEGER) + 1 THEN duration_ms END) AS p50DurationMs,
              MAX(CASE WHEN rank = CAST(count * 0.9 AS INTEGER) + 1 THEN duration_ms END) AS p90DurationMs
            FROM durations GROUP BY category
          )
          SELECT t.category, COUNT(*) AS calls,
            SUM(CASE WHEN t.outcome = 'success' THEN 1 ELSE 0 END) AS successes,
            SUM(CASE WHEN t.outcome = 'error' THEN 1 ELSE 0 END) AS errors,
            SUM(CASE WHEN t.outcome = 'interrupted' THEN 1 ELSE 0 END) AS interrupted,
            SUM(CASE WHEN t.outcome = 'unknown' THEN 1 ELSE 0 END) AS unknown,
            SUM(CASE WHEN t.outcome = 'pending' THEN 1 ELSE 0 END) AS pending,
            AVG(CASE WHEN t.ended_at IS NOT NULL THEN t.ended_at - t.started_at END) AS averageDurationMs,
            ds.p50DurationMs, ds.p90DurationMs,
            MAX(CASE WHEN t.ended_at IS NOT NULL THEN t.ended_at - t.started_at END) AS maxDurationMs,
            COALESCE(SUM(t.result_chars), 0) AS resultChars,
            CAST((COALESCE(SUM(t.result_chars), 0) + 3) / 4 AS INTEGER) AS outputTokens,
            SUM(CASE WHEN t.result_chars IS NOT NULL THEN 1 ELSE 0 END) AS measuredCalls
          FROM tools t LEFT JOIN duration_stats ds ON ds.category = t.category
          WHERE t.started_at >= ? AND t.started_at < ? GROUP BY t.category ORDER BY t.category`,
          [query.from, query.to, query.from, query.to],
        )).map(row => ({
          category: row.category,
          calls: row.calls,
          successes: row.successes,
          errors: row.errors,
          interrupted: row.interrupted,
          unknown: row.unknown,
          pending: row.pending,
          successRate: row.calls === 0 ? 0 : row.successes / row.calls,
          outputTokens: row.outputTokens,
          measuredCalls: row.measuredCalls,
          durationMs: {
            averageMs: row.averageDurationMs === null ? null : Math.round(row.averageDurationMs),
            p50Ms: row.p50DurationMs,
            p90Ms: row.p90DurationMs,
            maxMs: row.maxDurationMs,
          },
        }))
        const timeline = yield* read(
          decode.timeline,
          `SELECT ${timelineBucketSql} AS start, category, COUNT(*) AS calls,
              SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END) AS errors,
              COALESCE(SUM(CASE WHEN ended_at IS NOT NULL THEN ended_at - started_at END), 0) AS durationMs,
              CAST((COALESCE(SUM(result_chars), 0) + 3) / 4 AS INTEGER) AS outputTokens
            FROM tools WHERE started_at >= ? AND started_at < ? AND (? IS NULL OR category = ?)
            GROUP BY start, category ORDER BY start, category`,
          [query.from, query.to, category, category],
        )
        const totals = yield* readFirst(
          decode.activityTotals,
          `SELECT COUNT(*) AS calls,
            COALESCE(SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END), 0) AS successes,
            COALESCE(SUM(CASE WHEN outcome = 'error' THEN 1 ELSE 0 END), 0) AS errors,
            COALESCE(SUM(CASE WHEN outcome = 'interrupted' THEN 1 ELSE 0 END), 0) AS interrupted,
            COALESCE(SUM(CASE WHEN outcome = 'unknown' THEN 1 ELSE 0 END), 0) AS unknown,
            COALESCE(SUM(CASE WHEN outcome = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
            COALESCE(SUM(CASE WHEN ended_at IS NOT NULL THEN ended_at - started_at END), 0) AS durationMs,
            CAST((COALESCE(SUM(result_chars), 0) + 3) / 4 AS INTEGER) AS outputTokens,
            COALESCE(SUM(CASE WHEN result_chars IS NOT NULL THEN 1 ELSE 0 END), 0) AS measuredCalls
          FROM tools WHERE started_at >= ? AND started_at < ? AND (? IS NULL OR category = ?)`,
          [query.from, query.to, category, category],
        )
        const jev = yield* readFirst(
          decode.jevActivity,
          `SELECT COUNT(*) AS calls,
          COALESCE(SUM(CASE WHEN outcome = 'success' THEN 1 ELSE 0 END), 0) AS successes,
          COALESCE(SUM(CASE WHEN outcome != 'success' THEN 1 ELSE 0 END), 0) AS failures,
          COALESCE(SUM(input_tokens), 0) AS inputTokens, COALESCE(SUM(output_tokens), 0) AS outputTokens,
          AVG(duration_ms) AS durationMs, MAX(duration_ms) AS maxDurationMs FROM jev_requests WHERE started_at >= ? AND started_at < ?`,
          [query.from, query.to],
        )
        const jevOutcomes = yield* read(
          decode.jevOutcomes,
          'SELECT outcome, COUNT(*) AS calls FROM jev_requests WHERE started_at >= ? AND started_at < ? GROUP BY outcome ORDER BY calls DESC, outcome',
          [query.from, query.to],
        )
        const jevSources = (yield* read(
          decode.jevSources,
          `WITH durations AS (
            SELECT source, duration_ms,
              ROW_NUMBER() OVER (PARTITION BY source ORDER BY duration_ms) AS rank,
              COUNT(*) OVER (PARTITION BY source) AS count
            FROM jev_requests WHERE started_at >= ? AND started_at < ?
          ), duration_stats AS (
            SELECT source,
              MAX(CASE WHEN rank = CAST(count * 0.5 AS INTEGER) + 1 THEN duration_ms END) AS p50DurationMs,
              MAX(CASE WHEN rank = CAST(count * 0.9 AS INTEGER) + 1 THEN duration_ms END) AS p90DurationMs
            FROM durations GROUP BY source
          )
          SELECT j.source, COUNT(*) AS calls,
            SUM(CASE WHEN j.outcome = 'success' THEN 1 ELSE 0 END) AS successes,
            SUM(CASE WHEN j.outcome != 'success' THEN 1 ELSE 0 END) AS failures,
            COALESCE(SUM(j.input_tokens), 0) AS inputTokens, COALESCE(SUM(j.output_tokens), 0) AS outputTokens,
            AVG(j.duration_ms) AS averageDurationMs, ds.p50DurationMs, ds.p90DurationMs, MAX(j.duration_ms) AS maxDurationMs
          FROM jev_requests j LEFT JOIN duration_stats ds ON ds.source = j.source
          WHERE j.started_at >= ? AND j.started_at < ? GROUP BY j.source ORDER BY j.source`,
          [query.from, query.to, query.from, query.to],
        )).map(row => ({
          source: row.source,
          calls: row.calls,
          successes: row.successes,
          failures: row.failures,
          successRate: row.calls === 0 ? 0 : row.successes / row.calls,
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          durationMs: {
            averageMs: row.averageDurationMs === null ? null : Math.round(row.averageDurationMs),
            p50Ms: row.p50DurationMs,
            p90Ms: row.p90DurationMs,
            maxMs: row.maxDurationMs,
          },
        }))
        const jevDurationStats = yield* readFirst(
          decode.jevDurationStats,
          `WITH durations AS (
          SELECT duration_ms, ROW_NUMBER() OVER (ORDER BY duration_ms) AS rank, COUNT(*) OVER () AS count
          FROM jev_requests WHERE started_at >= ? AND started_at < ?
        )
        SELECT MAX(CASE WHEN rank = CAST(count * 0.5 AS INTEGER) + 1 THEN duration_ms END) AS p50DurationMs,
          MAX(CASE WHEN rank = CAST(count * 0.9 AS INTEGER) + 1 THEN duration_ms END) AS p90DurationMs,
          MAX(duration_ms) AS maxDurationMs
        FROM durations`,
          [query.from, query.to],
        )

        return {
          range: { from: query.from, to: query.to },
          timelineBucket: query.bucket ?? 'day',
          categories: categoryOutcomes.map(row => ({ category: row.category, calls: row.calls, outputTokens: row.outputTokens })),
          categoryOutcomes,
          timeline: [...timeline],
          totals: { ...totals, successRate: totals.calls === 0 ? 0 : totals.successes / totals.calls },
          tools: toolRows.map(row => ({
            name: row.name,
            category: row.category,
            owner: row.owner,
            calls: row.calls,
            successes: row.successes,
            successRate: row.calls === 0 ? 0 : row.successes / row.calls,
            errors: row.errors,
            interrupted: row.interrupted,
            unknown: row.unknown,
            pending: row.pending,
            outcomes: { successes: row.successes, errors: row.errors, interrupted: row.interrupted, unknown: row.unknown, pending: row.pending },
            timestamps: { firstStarted: row.firstStartedAt, lastStarted: row.lastStartedAt, firstEnded: row.firstEndedAt, lastEnded: row.lastEndedAt },
            durationMs: {
              averageMs: row.averageDurationMs === null ? null : Math.round(row.averageDurationMs),
              p50Ms: row.p50DurationMs,
              p90Ms: row.p90DurationMs,
              maxMs: row.maxDurationMs,
            },
            averageDurationMs: row.averageDurationMs === null ? null : Math.round(row.averageDurationMs),
            totalDurationMs: row.totalDurationMs,
            outputTokens: row.outputTokens,
            measuredCalls: row.measuredCalls,
          })),
          commandDurationTotalMs,
          testRunDurationTotalMs,
          commandDistribution: commandRows.map(row => ({ command: row.identifier, calls: row.calls, totalDurationMs: row.totalDurationMs })),
          testRunDistribution: testRunRows.map(row => ({
            runner: row.identifier,
            calls: row.calls,
            totalDurationMs: row.totalDurationMs,
            successes: row.successes,
            errors: row.errors,
            interrupted: row.interrupted,
            unknown: row.unknown,
            pending: row.pending,
          })),
          events,
          jev: {
            calls: jev.calls,
            successes: jev.successes,
            failures: jev.failures,
            averageDurationMs: jev.durationMs === null ? null : Math.round(jev.durationMs),
            inputTokens: jev.inputTokens,
            outputTokens: jev.outputTokens,
            byOutcome: [...jevOutcomes],
            successRate: jev.calls === 0 ? 0 : jev.successes / jev.calls,
            bySource: jevSources,
            durationMs: {
              averageMs: jev.durationMs === null ? null : Math.round(jev.durationMs),
              p50Ms: jevDurationStats.p50DurationMs,
              p90Ms: jevDurationStats.p90DurationMs,
              maxMs: jevDurationStats.maxDurationMs,
            },
          },
        }
      },
      Effect.mapError(failed('activity')),
    )

    const otelMetrics = Effect.fn('usage otlp metrics read')(
      function* (range: OtelMetricsRange) {
        const window = [range.from, range.to]
        const modelCountRows = yield* read(
          decode.modelCounts,
          `SELECT r.provider, r.model, r.purpose, r.status, COUNT(*) AS calls FROM ${FROM_SQL}
              WHERE ${VISIBLE_SQL} AND r.started_at >= ? AND r.started_at < ?
              GROUP BY r.provider, r.model, r.purpose, r.status ORDER BY calls DESC LIMIT 1000`,
          window,
        )
        const modelTokenRows = yield* read(
          decode.modelTokens,
          `SELECT r.provider, r.model, r.purpose, COALESCE(SUM(r.input), 0) AS input,
                COALESCE(SUM(r.cache_read), 0) AS cacheRead, COALESCE(SUM(r.cache_write), 0) AS cacheWrite,
                COALESCE(SUM(r.output), 0) AS output, COALESCE(SUM(r.reasoning), 0) AS reasoning
              FROM ${FROM_SQL} WHERE ${VISIBLE_SQL} AND r.started_at >= ? AND r.started_at < ?
              GROUP BY r.provider, r.model, r.purpose ORDER BY SUM(COALESCE(r.input, 0) + COALESCE(r.cache_read, 0) + COALESCE(r.cache_write, 0) + COALESCE(r.output, 0) + COALESCE(r.reasoning, 0)) DESC LIMIT 1000`,
          window,
        )
        const modelDurationRows = yield* read(
          decode.modelDurations,
          `WITH duration_rows AS (
                SELECT r.provider, r.model, r.purpose, r.status, r.ended_at - r.started_at AS duration_ms FROM ${FROM_SQL}
                WHERE ${VISIBLE_SQL} AND r.started_at >= ? AND r.started_at < ? AND r.ended_at IS NOT NULL AND r.ended_at >= r.started_at
              )
              SELECT provider, model, purpose, status, COUNT(*) AS calls, SUM(duration_ms) AS durationSumMs, ${OTEL_BUCKET_SELECT}
              FROM duration_rows GROUP BY provider, model, purpose, status ORDER BY calls DESC LIMIT 1000`,
          window,
        )
        const toolCategoryRows = yield* read(
          decode.toolCategoryCounts,
          `SELECT category, outcome, COUNT(*) AS calls FROM tools WHERE started_at >= ? AND started_at < ?
              GROUP BY category, outcome ORDER BY category, outcome`,
          window,
        )
        const toolSourceRows = yield* read(
          decode.toolSourceCounts,
          `SELECT category, name, owner, COUNT(*) AS calls FROM tools WHERE started_at >= ? AND started_at < ?
              GROUP BY category, name, owner ORDER BY calls DESC, category, owner, name LIMIT 500`,
          window,
        )
        const toolDurationRows = yield* read(
          decode.toolDurations,
          `WITH duration_rows AS (
                SELECT category, outcome, ended_at - started_at AS duration_ms FROM tools
                WHERE started_at >= ? AND started_at < ? AND ended_at IS NOT NULL AND ended_at >= started_at
              )
              SELECT category, outcome, COUNT(*) AS calls, SUM(duration_ms) AS durationSumMs, ${OTEL_BUCKET_SELECT}
              FROM duration_rows GROUP BY category, outcome ORDER BY category, outcome`,
          window,
        )
        const jevCountRows = yield* read(
          decode.jevCounts,
          `SELECT source, outcome, COUNT(*) AS calls FROM jev_requests WHERE started_at >= ? AND started_at < ?
              GROUP BY source, outcome ORDER BY source, outcome`,
          window,
        )
        const jevTokenRows = yield* read(
          decode.jevTokens,
          `SELECT source, COALESCE(SUM(input_tokens), 0) AS input, COALESCE(SUM(output_tokens), 0) AS output
              FROM jev_requests WHERE started_at >= ? AND started_at < ? GROUP BY source ORDER BY source`,
          window,
        )
        const jevDurationRows = yield* read(
          decode.jevDurations,
          `WITH duration_rows AS (
                SELECT source, outcome, duration_ms FROM jev_requests WHERE started_at >= ? AND started_at < ?
              )
              SELECT source, outcome, COUNT(*) AS calls, SUM(duration_ms) AS durationSumMs, ${OTEL_BUCKET_SELECT}
              FROM duration_rows GROUP BY source, outcome ORDER BY source, outcome`,
          window,
        )
        return otlpRequestOf({
          range,
          modelCountRows,
          modelTokenRows,
          modelDurationRows,
          toolCategoryRows,
          toolSourceRows,
          toolDurationRows,
          jevCountRows,
          jevTokenRows,
          jevDurationRows,
        })
      },
      Effect.mapError(failed('OTLP metrics')),
    )

    const counts = readFirst(
      decode.storeCounts,
      `SELECT (SELECT COUNT(*) FROM files) AS files, (SELECT COUNT(*) FROM requests r WHERE ${VISIBLE_SQL}) AS requests`,
    ).pipe(Effect.mapError(failed('counts')))

    return UsageRepo.of({
      fileCursor,
      commitLogSlice,
      insertLiveCall,
      reconcileLiveCalls,
      pruneTelemetry,
      routeBands: () => allRouteBands.pipe(Effect.mapError(failed('route bands'))),
      unratedRouteBands: () => unratedRouteBands,
      writeRates,
      getMeta,
      setMeta,
      requests,
      charts,
      recordJevUsage,
      jevUsage,
      activity,
      otelMetrics,
      syncToolSources,
      counts: () => counts,
    })
  })
