import { defineApi } from '@dshfiles/dshx/api'
import { Effect } from 'effect'
import type * as SchemaTypes from 'effect/Schema'
import * as Schema from 'effect/Schema'
import { REQUEST_PURPOSES, REQUEST_STATUSES } from './fold-contracts.js'
import { jevUsageOutcomeSchema, jevUsageQuerySchema, jevUsageRecordSchema, jevUsageSourceSchema, jevUsageViewSchema } from './jev-usage.js'
import { otlpMetricsRequestSchema } from './otel-metrics.js'
import { UsageSchema } from './schema.js'

export { JEV_INPUT_USD_PER_MILLION } from './jev-usage.js'
export type { JevUsageBreakdown, JevUsageQuery, JevUsageRecord, JevUsageView } from './jev-usage.js'

const nonNegativeInteger = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const nonNegativeNumber = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))
const integer = Schema.Number.check(Schema.isFinite(), Schema.isInt())

const withDefault = <ValueSchema extends SchemaTypes.Top>(schema: ValueSchema, fallback: ValueSchema['Type']) =>
  schema.pipe(Schema.withDecodingDefault(Effect.succeed(fallback)))

export const purposeSchema = Schema.Literals(REQUEST_PURPOSES)
export const statusSchema = Schema.Literals(REQUEST_STATUSES)

const rangeShape = {
  from: nonNegativeInteger.pipe(Schema.annotate({ description: 'Range start, Unix milliseconds.' })),
  to: nonNegativeInteger.pipe(Schema.annotate({ description: 'Range end, Unix milliseconds.' })),
  purposes: Schema.optional(Schema.Array(purposeSchema).check(Schema.isMaxLength(REQUEST_PURPOSES.length))),
  provider: Schema.optional(
    Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)).pipe(
      Schema.annotate({ description: 'Exact, case-sensitive recorded provider route id (including the account instance id).' }),
    ),
  ),
}

export const SORT_COLUMNS = ['startedAt', 'cost', 'input', 'cacheRead', 'output', 'durationMs', 'ttftMs'] as const

export const requestQuerySchema = Schema.Struct({
  ...rangeShape,
  search: Schema.optional(UsageSchema.trimmedText.check(Schema.isMinLength(1), Schema.isMaxLength(120))),
  status: Schema.optional(statusSchema),
  sessionId: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))),
  sort: Schema.Literals(SORT_COLUMNS),
  direction: Schema.Literals(['asc', 'desc']),
  limit: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(500)),
})

export type RequestQuery = typeof requestQuerySchema.Type

const nullableCount = Schema.NullOr(nonNegativeInteger)

export const requestViewSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  sessionTitle: Schema.NullOr(Schema.String),
  /** The parent thread of a subagent session, opened when the subagent has no thread of its own. */
  parentSessionId: Schema.NullOr(Schema.String),
  project: Schema.NullOr(Schema.String),
  cwd: Schema.NullOr(Schema.String),
  seq: Schema.NullOr(integer),
  messageId: Schema.NullOr(Schema.String),
  turn: Schema.NullOr(integer),
  step: Schema.NullOr(integer),
  purpose: purposeSchema,
  provider: Schema.String,
  model: Schema.String,
  startedAt: Schema.Number,
  durationMs: Schema.NullOr(Schema.Number),
  ttftMs: Schema.NullOr(Schema.Number),
  input: nullableCount,
  cacheRead: nullableCount,
  cacheWrite: nullableCount,
  output: nullableCount,
  cost: Schema.NullOr(Schema.Number),
  status: statusSchema,
  stopReason: Schema.NullOr(Schema.String),
  errorCode: Schema.NullOr(Schema.String),
})

export type RequestView = typeof requestViewSchema.Type

const countsSchema = Schema.Record(Schema.String, nonNegativeInteger)

export const requestPageSchema = Schema.Struct({
  /** Echoed only after the Host applies the exact provider filter. Older Hosts omit it. */
  appliedProvider: Schema.optional(Schema.String),
  rows: Schema.Array(requestViewSchema).check(Schema.isMaxLength(500)),
  /** Requests matching every filter except the status chip. */
  total: nonNegativeInteger,
  statusCounts: countsSchema,
  purposeCounts: countsSchema,
})

export type RequestPage = typeof requestPageSchema.Type

export const GROUP_DIMENSIONS = ['model', 'provider', 'project', 'purpose'] as const

export const chartQuerySchema = Schema.Struct({
  ...rangeShape,
  bucket: Schema.Literals(['hour', 'day']),
  groupBy: Schema.Literals(GROUP_DIMENSIONS),
  /** Minutes east of UTC in the viewer's zone, so day buckets start at local midnight. */
  tzOffsetMinutes: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(-900), Schema.isLessThanOrEqualTo(900)),
})

export type ChartQuery = typeof chartQuerySchema.Type

const tokenTotals = {
  input: nonNegativeNumber,
  cacheRead: nonNegativeNumber,
  cacheWrite: nonNegativeNumber,
  output: nonNegativeNumber,
}

const completenessShape = {
  /** Requests without token counts; aggregate token/cost sums are only known subtotals. */
  missingUsage: Schema.optional(nonNegativeInteger),
  /** Requests with token counts but no applicable catalog price. */
  unpriced: Schema.optional(nonNegativeInteger),
}

const breakdownSchema = Schema.Struct({
  key: Schema.String,
  cost: Schema.Number,
  requests: integer,
  sessions: Schema.optional(integer),
  input: Schema.optional(nonNegativeNumber),
  cacheRead: Schema.optional(nonNegativeNumber),
  cacheWrite: Schema.optional(nonNegativeNumber),
  output: Schema.optional(nonNegativeNumber),
  tokens: Schema.Number,
  ...completenessShape,
})

const latencyStatsSchema = Schema.Struct({
  averageMs: Schema.NullOr(integer),
  p50Ms: Schema.NullOr(integer),
  p90Ms: Schema.NullOr(integer),
  maxMs: Schema.NullOr(integer),
})

const maybeAverageDuration = Schema.optional(Schema.NullOr(nonNegativeNumber))
const averageDurationField = maybeAverageDuration.pipe(Schema.withDecodingDefault(Effect.succeed(null)))

export const chartViewSchema = Schema.Struct({
  /** Echoed only after the Host applies the exact provider filter. Older Hosts omit it. */
  appliedProvider: Schema.optional(Schema.String),
  summary: Schema.Struct({
    cost: Schema.Number,
    requests: integer,
    failed: integer,
    aborted: integer,
    ...tokenTotals,
    /** Requests whose route has no catalog price, so `cost` is a lower bound. */
    unpriced: integer,
    missingUsage: Schema.optional(nonNegativeInteger),
    /** Mean of all completed request durations, not a mean of bucket percentiles. */
    averageDurationMs: averageDurationField,
    /** USD the cache-read traffic would have cost at the uncached input rate, per list price. */
    cacheSavings: withDefault(Schema.Number, 0),
    /** Distinct thread turns that made a request, for cost per turn. */
    turns: withDefault(nonNegativeInteger, 0),
    previous: Schema.Struct({
      cost: Schema.Number,
      requests: integer,
      tokens: Schema.Number,
      ...completenessShape,
      averageDurationMs: averageDurationField,
      cacheSavings: withDefault(Schema.Number, 0),
      turns: withDefault(nonNegativeInteger, 0),
    }),
  }),
  /** Grouped series keys in display order: the largest by cost, then `Other`. */
  keys: Schema.Array(Schema.String).check(Schema.isMaxLength(8)),
  buckets: Schema.Array(
    Schema.Struct({
      start: Schema.Number,
      key: Schema.String,
      cost: Schema.Number,
      requests: integer,
      failed: integer,
      ...tokenTotals,
      ...completenessShape,
    }),
  ),
  breakdown: Schema.Struct({
    model: Schema.Array(breakdownSchema),
    provider: Schema.Array(breakdownSchema),
    project: Schema.Array(breakdownSchema),
    purpose: Schema.optional(Schema.Array(breakdownSchema)),
  }),
  latency: Schema.Array(
    Schema.Struct({
      start: Schema.Number,
      ttftP50: Schema.NullOr(Schema.Number),
      ttftP90: Schema.NullOr(Schema.Number),
      durationP50: Schema.NullOr(Schema.Number),
      durationP90: Schema.NullOr(Schema.Number),
    }),
  ),
  topThreads: Schema.Array(
    Schema.Struct({
      sessionId: Schema.String,
      title: Schema.NullOr(Schema.String),
      project: Schema.NullOr(Schema.String),
      cost: Schema.Number,
      requests: integer,
    }),
  ),
})

export type ChartView = typeof chartViewSchema.Type

/** The range a caller asked for cannot be resolved; the tool surfaces the message and the caller's next step. */
export class UsageRangeError extends Schema.TaggedError<UsageRangeError>()('UsageRangeError', {
  message: Schema.String,
}) {}

const DAY_MS = 24 * 60 * 60 * 1_000
const TOOL_CATEGORIES = ['api', 'mcp', 'plugin', 'tool', 'skill', 'other'] as const
const toolCategorySchema = Schema.Literals(TOOL_CATEGORIES)

const boundedOptionalInteger = (minimum: number, maximum: number, description: string) =>
  Schema.optional(
    Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(minimum), Schema.isLessThanOrEqualTo(maximum)).pipe(
      Schema.annotate({ description }),
    ),
  )

export const activityInputSchema = Schema.Struct({
  from: boundedOptionalInteger(0, Number.MAX_SAFE_INTEGER, 'Optional range start, Unix milliseconds. Omit from and to to use a rolling range.'),
  to: boundedOptionalInteger(0, Number.MAX_SAFE_INTEGER, 'Optional range end, Unix milliseconds. Omit from and to to use a rolling range.'),
  days: boundedOptionalInteger(1, 365, 'Rolling range length when from and to are omitted; defaults to 30 days.'),
  category: Schema.optional(toolCategorySchema.pipe(Schema.annotate({ description: 'Optionally limit ranked tool rows to a source category.' }))),
  limit: boundedOptionalInteger(1, 100, 'Maximum ranked tool rows; defaults to 10.'),
  eventLimit: boundedOptionalInteger(1, 200, 'Maximum recent tool and Jev event rows; defaults to 50.'),
  bucket: Schema.optional(
    Schema.Literals(['hour', 'day']).pipe(
      Schema.annotate({ description: 'Optional timeline bucket; defaults to day, and an hourly request coarsens to day beyond two days.' }),
    ),
  ),
  tzOffsetMinutes: boundedOptionalInteger(-900, 900, 'Minutes east of UTC, so day buckets start at local midnight; defaults to 0.'),
})

type ResolvedActivityQuery = {
  from: number
  to: number
  category?: typeof toolCategorySchema.Type
  limit: number
  eventLimit?: number
  bucket: 'hour' | 'day'
  tzOffsetMinutes: number
}

export const resolveActivityQuery = (input: typeof activityInputSchema.Type, now = Date.now()): ResolvedActivityQuery => {
  if (input.days !== undefined && (input.from !== undefined || input.to !== undefined))
    throw new UsageRangeError({ message: 'days cannot be combined with from/to.' })
  if ((input.from === undefined) !== (input.to === undefined)) throw new UsageRangeError({ message: 'Provide both from and to, or neither.' })
  const to = input.to ?? now
  if (to < (input.from ?? 0)) throw new UsageRangeError({ message: 'to must be at or after from.' })
  const from = input.from ?? to - (input.days ?? 30) * DAY_MS
  // An hourly timeline over a long window would return tens of thousands of rows; a day bucket stays bounded.
  const bucket = input.bucket === 'hour' && to - from > 2 * DAY_MS ? 'day' : (input.bucket ?? 'day')
  const query: ResolvedActivityQuery = { from, to, bucket, tzOffsetMinutes: input.tzOffsetMinutes ?? 0, limit: input.limit ?? 10 }
  if (input.category !== undefined) query.category = input.category
  if (input.eventLimit !== undefined) query.eventLimit = input.eventLimit
  return query
}

const activityOutcomeSchema = Schema.Struct({
  successes: integer,
  errors: integer,
  interrupted: integer,
  unknown: integer,
  pending: integer,
})

const successRate = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1))

export const activityReportSchema = Schema.Struct({
  range: Schema.optional(Schema.Struct({ from: integer, to: integer })),
  timelineBucket: Schema.Literals(['hour', 'day']).pipe(Schema.withDecodingDefault(Effect.succeed('day'))),
  /** Tool calls, errors, wall time and returned tokens per bucket and category, oldest first. */
  timeline: withDefault(
    Schema.Array(
      Schema.Struct({
        start: integer,
        category: toolCategorySchema,
        calls: integer,
        errors: integer,
        durationMs: nonNegativeInteger,
        outputTokens: nonNegativeInteger,
      }),
    ).check(Schema.isMaxLength(3000)),
    [],
  ),
  categories: withDefault(
    Schema.Array(
      Schema.Struct({
        category: toolCategorySchema,
        calls: integer,
        outputTokens: withDefault(nonNegativeInteger, 0),
      }),
    ).check(Schema.isMaxLength(6)),
    [],
  ),
  /** Whole-range tool totals, independent of the ranked-row limit. */
  totals: Schema.optional(
    Schema.Struct({
      calls: integer,
      successes: integer,
      errors: integer,
      interrupted: integer,
      unknown: integer,
      pending: integer,
      durationMs: nonNegativeInteger,
      outputTokens: nonNegativeInteger,
      measuredCalls: nonNegativeInteger,
      successRate,
    }),
  ),
  categoryOutcomes: withDefault(
    Schema.Array(
      Schema.Struct({
        category: toolCategorySchema,
        calls: integer,
        successes: integer,
        errors: integer,
        interrupted: integer,
        unknown: integer,
        pending: integer,
        successRate,
        durationMs: latencyStatsSchema,
        outputTokens: withDefault(nonNegativeInteger, 0),
        measuredCalls: withDefault(nonNegativeInteger, 0),
      }),
    ).check(Schema.isMaxLength(6)),
    [],
  ),
  tools: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      category: Schema.Literals(TOOL_CATEGORIES).pipe(Schema.withDecodingDefault(Effect.succeed('other'))),
      owner: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefault(Effect.succeed(null))),
      calls: integer,
      successes: withDefault(integer, 0),
      successRate: Schema.optional(successRate),
      errors: integer,
      interrupted: integer,
      unknown: integer,
      pending: withDefault(integer, 0),
      outcomes: Schema.optional(activityOutcomeSchema),
      timestamps: Schema.optional(
        Schema.Struct({
          firstStarted: Schema.NullOr(integer),
          lastStarted: Schema.NullOr(integer),
          firstEnded: Schema.NullOr(integer),
          lastEnded: Schema.NullOr(integer),
        }),
      ),
      durationMs: Schema.optional(latencyStatsSchema),
      averageDurationMs: Schema.NullOr(integer),
      totalDurationMs: withDefault(nonNegativeInteger, 0),
      /** Estimated tokens the tool returned (text characters / 4); 0 when no call was measured. */
      outputTokens: withDefault(nonNegativeInteger, 0),
      /** Calls whose result size was recorded; older rows and dispatches carry none. */
      measuredCalls: withDefault(nonNegativeInteger, 0),
    }),
  ).check(Schema.isMaxLength(100)),
  commandDurationTotalMs: withDefault(nonNegativeInteger, 0),
  testRunDurationTotalMs: withDefault(nonNegativeInteger, 0),
  commandDistribution: withDefault(
    Schema.Array(
      Schema.Struct({
        command: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
        calls: integer,
        totalDurationMs: nonNegativeInteger,
      }),
    ).check(Schema.isMaxLength(10)),
    [],
  ),
  testRunDistribution: withDefault(
    Schema.Array(
      Schema.Struct({
        runner: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(80)),
        calls: integer,
        totalDurationMs: nonNegativeInteger,
        successes: integer,
        errors: integer,
        interrupted: integer,
        unknown: integer,
        pending: integer,
      }),
    ).check(Schema.isMaxLength(10)),
    [],
  ),
  events: withDefault(
    Schema.Array(
      Schema.Union([
        Schema.Struct({
          kind: Schema.Literal('tool'),
          at: integer,
          endedAt: Schema.NullOr(integer),
          durationMs: Schema.NullOr(integer),
          category: toolCategorySchema,
          name: Schema.String,
          owner: Schema.NullOr(Schema.String),
          outcome: Schema.Literals(['success', 'error', 'interrupted', 'unknown', 'pending']),
          turn: Schema.NullOr(integer),
          step: Schema.NullOr(integer),
        }),
        Schema.Struct({
          kind: Schema.Literal('jev'),
          at: integer,
          endedAt: integer,
          durationMs: integer,
          source: jevUsageSourceSchema,
          outcome: jevUsageOutcomeSchema,
        }),
      ]),
    ).check(Schema.isMaxLength(200)),
    [],
  ),
  jev: Schema.Struct({
    calls: integer,
    successes: integer,
    failures: integer,
    averageDurationMs: Schema.NullOr(integer),
    inputTokens: withDefault(integer, 0),
    outputTokens: withDefault(integer, 0),
    byOutcome: withDefault(Schema.Array(Schema.Struct({ outcome: jevUsageOutcomeSchema, calls: integer })), []),
    successRate: Schema.optional(successRate),
    bySource: withDefault(
      Schema.Array(
        Schema.Struct({
          source: jevUsageSourceSchema,
          calls: integer,
          successes: integer,
          failures: integer,
          successRate,
          inputTokens: integer,
          outputTokens: integer,
          durationMs: latencyStatsSchema,
        }),
      ),
      [],
    ),
    durationMs: Schema.optional(latencyStatsSchema),
  }).check(Schema.makeFilter(report => (report.calls === report.successes + report.failures ? true : 'Jev calls must equal successes plus failures.'))),
})
export type ActivityReport = typeof activityReportSchema.Type

const optionalUnixMilliseconds = Schema.optional(
  Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(Number.MAX_SAFE_INTEGER)),
)

export const otelMetricsInputSchema = Schema.Struct({
  from: optionalUnixMilliseconds,
  to: optionalUnixMilliseconds,
  days: Schema.optional(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(365))),
})

export const resolveOtelMetricsRange = (input: typeof otelMetricsInputSchema.Type, now = Date.now()) => {
  if (input.days !== undefined && (input.from !== undefined || input.to !== undefined))
    throw new UsageRangeError({ message: 'days cannot be combined with from/to.' })
  if ((input.from === undefined) !== (input.to === undefined)) throw new UsageRangeError({ message: 'Provide both from and to, or neither.' })
  const to = input.to ?? now
  const from = input.from ?? Math.max(0, to - (input.days ?? 30) * DAY_MS)
  if (to <= from) throw new UsageRangeError({ message: 'to must be after from.' })
  if (to - from > 365 * DAY_MS) throw new UsageRangeError({ message: 'OTLP export range cannot exceed 365 days.' })
  return { from, to }
}

export const otelMetricsOutputSchema = otlpMetricsRequestSchema

export const indexStatusSchema = Schema.Struct({
  indexedFiles: integer,
  requests: integer,
  lastIndexedAt: Schema.NullOr(Schema.Number),
  indexing: Schema.Boolean,
  pricingFetchedAt: Schema.NullOr(Schema.Number),
  lastError: Schema.NullOr(Schema.String),
})

/** Model-facing text for a structured tool result. */
const compactJson = <Output>(output: Output): string => JSON.stringify(output)

export const usageApi = defineApi({
  id: 'dshfiles-usage',
  version: 1,
  owner: '@dshfiles/usage',
  methods: {
    requests: UsageSchema.method({
      input: requestQuerySchema,
      output: requestPageSchema,
      description:
        'Page through recorded LLM requests between two Unix-ms timestamps: model, provider, tokens, cache, latency and list-price cost. Optional provider is an exact, case-sensitive account route filter applied before counting and limiting. Read-only.',
      tool: { name: 'usage_requests', readOnly: true, render: output => JSON.stringify(output) },
    }),
    charts: UsageSchema.method({
      input: chartQuerySchema,
      output: chartViewSchema,
      description:
        'Cost, token, cache and latency totals between two Unix-ms timestamps, bucketed by hour or day, with breakdowns by model, provider and project, the costliest sessions, estimated cache savings and turn count. Grouping by purpose shows where tokens went (agent, subagent, compaction, title, memory, other). Optional provider scopes all aggregates and previous-period comparisons to that exact, case-sensitive account route. Costs are list-price estimates. Read-only.',
      tool: { name: 'usage_report', readOnly: true, render: output => JSON.stringify(output) },
    }),
    status: UsageSchema.method({
      input: Schema.Struct({}),
      output: indexStatusSchema,
      description: 'How far the request index has read the session logs, and when prices were fetched. Read-only.',
      tool: { name: 'usage_status', readOnly: true, render: compactJson },
    }),
    jevUsage: UsageSchema.method({
      input: jevUsageQuerySchema,
      output: jevUsageViewSchema,
      description:
        'Read Jev API calls made by DSH between two Unix-ms timestamps, grouped by the local secret-reference label or environment-variable name, including provider-reported tokens and a list-price estimate. Labels are not provider-verified billing identity. Does not include calls outside DSH or TypeSafe account balance. Read-only.',
      tool: { name: 'usage_jev_report', readOnly: true, render: compactJson },
    }),
    recordJevUsage: UsageSchema.method({
      input: jevUsageRecordSchema,
      output: Schema.Struct({ accepted: Schema.Literal(true) }),
      description:
        'Record one DSH Jev request observation with only caller, timing, outcome and token counts. No API key, prompt or response text is accepted.',
    }),
    /** Index whatever the session logs gained since the last pass, then report. */
    refresh: UsageSchema.method({
      input: Schema.Struct({}),
      output: indexStatusSchema,
      description: 'Index whatever the session logs gained since the last pass, then report the new status. Call only when the user asked to re-index.',
      tool: { name: 'usage_reindex', render: compactJson },
    }),
    activity: UsageSchema.method({
      input: activityInputSchema,
      output: activityReportSchema,
      description:
        'Read local tool-use statistics: a per-bucket timeline of calls, errors, wall time and returned tokens, ranked tools and skills with outcomes and latency percentiles, estimated tokens each tool returned, normalized shell command and test-runner time distributions, Jev request totals by calling plugin (backlog, memory), and recent tool/Jev events. Omit inputs for the last 30 days, or specify days (1–365), or from/to Unix milliseconds. Token counts for tools are characters/4 estimates of returned text, never the text itself. Shell command arguments, paths, outputs, test case names and secrets are never stored; compound/ambiguous shell commands are omitted. Use this to answer “which tools or skills do I use most, and which return the most text?” or “what failed recently?”. Tool times are filtered by start time in the half-open [from, to) range; recent tool and Jev events are combined and capped by eventLimit.',
      tool: { name: 'usage_activity_report', readOnly: true, render: compactJson },
    }),
    otelMetrics: UsageSchema.method({
      input: otelMetricsInputSchema,
      output: otelMetricsOutputSchema,
      description:
        'Read an OTLP/HTTP JSON ExportMetricsServiceRequest built from the local SQLite usage ledger. Omit inputs for the last 30 days, specify days (1–365), or provide from/to Unix milliseconds. Returns aggregate model-request/token, tool-category/source and Jev request/token counters plus latency histograms; the 500 most-used tool sources are included, while category totals remain exact. Contains no session IDs, paths, prompts, arguments, results, credentials or raw errors. Read-only and makes no network request; SQLite remains the source of truth.',
      tool: { name: 'usage_otel_metrics', readOnly: true, render: compactJson },
    }),
  },
})
