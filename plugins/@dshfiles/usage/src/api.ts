import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { UsageFoldModel } from './fold.js'
import { jevUsageOutcomeSchema, jevUsageQuerySchema, jevUsageRecordSchema, jevUsageSourceSchema, jevUsageViewSchema } from './jev-usage.js'
import { otlpMetricsRequestSchema } from './otel-metrics.js'

export { JEV_INPUT_USD_PER_MILLION } from './jev-usage.js'
export type { JevUsageBreakdown, JevUsageQuery, JevUsageRecord, JevUsageView } from './jev-usage.js'

export const purposeSchema = z.enum(UsageFoldModel.REQUEST_PURPOSES)
export const statusSchema = z.enum(UsageFoldModel.REQUEST_STATUSES)

const rangeShape = {
  from: z.number().int().min(0).describe('Range start, Unix milliseconds.'),
  to: z.number().int().min(0).describe('Range end, Unix milliseconds.'),
  purposes: z.array(purposeSchema).max(UsageFoldModel.REQUEST_PURPOSES.length).optional(),
  provider: z.string().min(1).max(256).optional().describe('Exact, case-sensitive recorded provider route id (including the account instance id).'),
}

export const SORT_COLUMNS = ['startedAt', 'cost', 'input', 'cacheRead', 'output', 'durationMs', 'ttftMs'] as const

export const requestQuerySchema = z
  .object({
    ...rangeShape,
    search: z.string().trim().min(1).max(120).optional(),
    status: statusSchema.optional(),
    sessionId: z.string().min(1).max(256).optional(),
    sort: z.enum(SORT_COLUMNS),
    direction: z.enum(['asc', 'desc']),
    limit: z.number().int().min(1).max(500),
  })
  .strict()

export type RequestQuery = z.infer<typeof requestQuerySchema>

const nullableCount = z.number().int().min(0).nullable()

export const requestViewSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  sessionTitle: z.string().nullable(),
  /** The parent thread of a subagent session, opened when the subagent has no thread of its own. */
  parentSessionId: z.string().nullable(),
  project: z.string().nullable(),
  cwd: z.string().nullable(),
  seq: z.number().int().nullable(),
  messageId: z.string().nullable(),
  turn: z.number().int().nullable(),
  step: z.number().int().nullable(),
  purpose: purposeSchema,
  provider: z.string(),
  model: z.string(),
  startedAt: z.number(),
  durationMs: z.number().nullable(),
  ttftMs: z.number().nullable(),
  input: nullableCount,
  cacheRead: nullableCount,
  cacheWrite: nullableCount,
  output: nullableCount,
  cost: z.number().nullable(),
  status: statusSchema,
  stopReason: z.string().nullable(),
  errorCode: z.string().nullable(),
})

export type RequestView = z.infer<typeof requestViewSchema>

const countsSchema = z.record(z.string(), z.number().int().min(0))

export const requestPageSchema = z.object({
  /** Echoed only after the Host applies the exact provider filter. Older Hosts omit it. */
  appliedProvider: z.string().optional(),
  rows: z.array(requestViewSchema).max(500),
  /** Requests matching every filter except the status chip. */
  total: z.number().int().min(0),
  statusCounts: countsSchema,
  purposeCounts: countsSchema,
})

export type RequestPage = z.infer<typeof requestPageSchema>

export const GROUP_DIMENSIONS = ['model', 'provider', 'project', 'purpose'] as const

export const chartQuerySchema = z
  .object({
    ...rangeShape,
    bucket: z.enum(['hour', 'day']),
    groupBy: z.enum(GROUP_DIMENSIONS),
    /** Minutes east of UTC in the viewer's zone, so day buckets start at local midnight. */
    tzOffsetMinutes: z.number().int().min(-900).max(900),
  })
  .strict()

export type ChartQuery = z.infer<typeof chartQuerySchema>

const tokenTotals = {
  input: z.number().min(0),
  cacheRead: z.number().min(0),
  cacheWrite: z.number().min(0),
  output: z.number().min(0),
}

const completenessShape = {
  /** Requests without token counts; aggregate token/cost sums are only known subtotals. */
  missingUsage: z.number().int().min(0).optional(),
  /** Requests with token counts but no applicable catalog price. */
  unpriced: z.number().int().min(0).optional(),
}
const breakdownSchema = z.object({ key: z.string(), cost: z.number(), requests: z.number().int(), tokens: z.number(), ...completenessShape })

export const chartViewSchema = z.object({
  /** Echoed only after the Host applies the exact provider filter. Older Hosts omit it. */
  appliedProvider: z.string().optional(),
  summary: z.object({
    cost: z.number(),
    requests: z.number().int(),
    failed: z.number().int(),
    aborted: z.number().int(),
    ...tokenTotals,
    /** Requests whose route has no catalog price, so `cost` is a lower bound. */
    unpriced: z.number().int(),
    missingUsage: z.number().int().min(0).optional(),
    /** Mean of all completed request durations, not a mean of bucket percentiles. */
    averageDurationMs: z.number().min(0).nullable().optional().default(null),
    /** USD the cache-read traffic would have cost at the uncached input rate, per list price. */
    cacheSavings: z.number().default(0),
    /** Distinct thread turns that made a request, for cost per turn. */
    turns: z.number().int().nonnegative().default(0),
    previous: z.object({
      cost: z.number(),
      requests: z.number().int(),
      tokens: z.number(),
      ...completenessShape,
      averageDurationMs: z.number().min(0).nullable().optional().default(null),
      cacheSavings: z.number().default(0),
      turns: z.number().int().nonnegative().default(0),
    }),
  }),
  /** Grouped series keys in display order: the largest by cost, then `Other`. */
  keys: z.array(z.string()).max(8),
  buckets: z.array(
    z.object({
      start: z.number(),
      key: z.string(),
      cost: z.number(),
      requests: z.number().int(),
      failed: z.number().int(),
      ...tokenTotals,
      ...completenessShape,
    }),
  ),
  breakdown: z.object({ model: z.array(breakdownSchema), provider: z.array(breakdownSchema), project: z.array(breakdownSchema) }),
  latency: z.array(
    z.object({
      start: z.number(),
      ttftP50: z.number().nullable(),
      ttftP90: z.number().nullable(),
      durationP50: z.number().nullable(),
      durationP90: z.number().nullable(),
    }),
  ),
  topThreads: z.array(
    z.object({ sessionId: z.string(), title: z.string().nullable(), project: z.string().nullable(), cost: z.number(), requests: z.number().int() }),
  ),
})

export type ChartView = z.infer<typeof chartViewSchema>

const DAY_MS = 24 * 60 * 60 * 1_000
const toolCategorySchema = z.enum(['api', 'mcp', 'plugin', 'tool', 'skill', 'other'])
export const activityInputSchema = z
  .object({
    from: z.number().int().min(0).optional().describe('Optional range start, Unix milliseconds. Omit from and to to use a rolling range.'),
    to: z.number().int().min(0).optional().describe('Optional range end, Unix milliseconds. Omit from and to to use a rolling range.'),
    days: z.number().int().min(1).max(365).optional().describe('Rolling range length when from and to are omitted; defaults to 30 days.'),
    category: toolCategorySchema.optional().describe('Optionally limit ranked tool rows to a source category.'),
    limit: z.number().int().min(1).max(100).optional().describe('Maximum ranked tool rows; defaults to 10.'),
    eventLimit: z.number().int().min(1).max(200).optional().describe('Maximum recent tool and Jev event rows; defaults to 50.'),
    bucket: z.enum(['hour', 'day']).optional().describe('Optional timeline bucket; defaults to day, and an hourly request coarsens to day beyond two days.'),
    tzOffsetMinutes: z.number().int().min(-900).max(900).optional().describe('Minutes east of UTC, so day buckets start at local midnight; defaults to 0.'),
  })
  .strict()

type ResolvedActivityQuery = {
  from: number
  to: number
  category?: z.infer<typeof toolCategorySchema>
  limit: number
  eventLimit?: number
  bucket: 'hour' | 'day'
  tzOffsetMinutes: number
}

export const resolveActivityQuery = (input: z.infer<typeof activityInputSchema>, now = Date.now()): ResolvedActivityQuery => {
  if (input.days !== undefined && (input.from !== undefined || input.to !== undefined)) throw new Error('days cannot be combined with from/to.')
  if ((input.from === undefined) !== (input.to === undefined)) throw new Error('Provide both from and to, or neither.')
  const to = input.to ?? now
  if (to < (input.from ?? 0)) throw new Error('to must be at or after from.')
  const from = input.from ?? to - (input.days ?? 30) * DAY_MS
  // An hourly timeline over a long window would return tens of thousands of rows; a day bucket stays bounded.
  const bucket = input.bucket === 'hour' && to - from > 2 * DAY_MS ? 'day' : (input.bucket ?? 'day')
  const query: ResolvedActivityQuery = { from, to, bucket, tzOffsetMinutes: input.tzOffsetMinutes ?? 0, limit: input.limit ?? 10 }
  if (input.category !== undefined) query.category = input.category
  if (input.eventLimit !== undefined) query.eventLimit = input.eventLimit
  return query
}

const latencyStatsSchema = z.object({
  averageMs: z.number().int().nullable(),
  p50Ms: z.number().int().nullable(),
  p90Ms: z.number().int().nullable(),
  maxMs: z.number().int().nullable(),
})
const activityOutcomeSchema = z.object({
  successes: z.number().int(),
  errors: z.number().int(),
  interrupted: z.number().int(),
  unknown: z.number().int(),
  pending: z.number().int(),
})

export const activityReportSchema = z.object({
  range: z.object({ from: z.number().int(), to: z.number().int() }).optional(),
  timelineBucket: z.enum(['hour', 'day']).default('day'),
  /** Tool calls, errors, wall time and returned tokens per bucket and category, oldest first. */
  timeline: z
    .array(
      z.object({
        start: z.number().int(),
        category: toolCategorySchema,
        calls: z.number().int(),
        errors: z.number().int(),
        durationMs: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative(),
      }),
    )
    .max(3000)
    .default([]),
  categories: z
    .array(z.object({ category: toolCategorySchema, calls: z.number().int(), outputTokens: z.number().int().nonnegative().default(0) }))
    .max(6)
    .default([]),
  /** Whole-range tool totals, independent of the ranked-row limit. */
  totals: z
    .object({
      calls: z.number().int(),
      successes: z.number().int(),
      errors: z.number().int(),
      interrupted: z.number().int(),
      unknown: z.number().int(),
      pending: z.number().int(),
      durationMs: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      measuredCalls: z.number().int().nonnegative(),
      successRate: z.number().min(0).max(1),
    })
    .optional(),
  categoryOutcomes: z
    .array(
      z.object({
        category: toolCategorySchema,
        calls: z.number().int(),
        successes: z.number().int(),
        errors: z.number().int(),
        interrupted: z.number().int(),
        unknown: z.number().int(),
        pending: z.number().int(),
        successRate: z.number().min(0).max(1),
        durationMs: latencyStatsSchema,
        outputTokens: z.number().int().nonnegative().default(0),
        measuredCalls: z.number().int().nonnegative().default(0),
      }),
    )
    .max(6)
    .default([]),
  tools: z
    .array(
      z.object({
        name: z.string(),
        category: z.enum(['api', 'mcp', 'plugin', 'tool', 'skill', 'other']).default('other'),
        owner: z.string().nullable().default(null),
        calls: z.number().int(),
        successes: z.number().int().default(0),
        successRate: z.number().min(0).max(1).optional(),
        errors: z.number().int(),
        interrupted: z.number().int(),
        unknown: z.number().int(),
        pending: z.number().int().default(0),
        outcomes: activityOutcomeSchema.optional(),
        timestamps: z
          .object({
            firstStarted: z.number().int().nullable(),
            lastStarted: z.number().int().nullable(),
            firstEnded: z.number().int().nullable(),
            lastEnded: z.number().int().nullable(),
          })
          .optional(),
        durationMs: latencyStatsSchema.optional(),
        averageDurationMs: z.number().int().nullable(),
        totalDurationMs: z.number().int().nonnegative().default(0),
        /** Estimated tokens the tool returned (text characters / 4); 0 when no call was measured. */
        outputTokens: z.number().int().nonnegative().default(0),
        /** Calls whose result size was recorded; older rows and dispatches carry none. */
        measuredCalls: z.number().int().nonnegative().default(0),
      }),
    )
    .max(100),
  commandDurationTotalMs: z.number().int().nonnegative().default(0),
  testRunDurationTotalMs: z.number().int().nonnegative().default(0),
  commandDistribution: z
    .array(z.object({ command: z.string().min(1).max(80), calls: z.number().int(), totalDurationMs: z.number().int().nonnegative() }))
    .max(10)
    .default([]),
  testRunDistribution: z
    .array(
      z.object({
        runner: z.string().min(1).max(80),
        calls: z.number().int(),
        totalDurationMs: z.number().int().nonnegative(),
        successes: z.number().int(),
        errors: z.number().int(),
        interrupted: z.number().int(),
        unknown: z.number().int(),
        pending: z.number().int(),
      }),
    )
    .max(10)
    .default([]),
  events: z
    .array(
      z.discriminatedUnion('kind', [
        z.object({
          kind: z.literal('tool'),
          at: z.number().int(),
          endedAt: z.number().int().nullable(),
          durationMs: z.number().int().nullable(),
          category: toolCategorySchema,
          name: z.string(),
          owner: z.string().nullable(),
          outcome: z.enum(['success', 'error', 'interrupted', 'unknown', 'pending']),
          turn: z.number().int().nullable(),
          step: z.number().int().nullable(),
        }),
        z.object({
          kind: z.literal('jev'),
          at: z.number().int(),
          endedAt: z.number().int(),
          durationMs: z.number().int(),
          source: jevUsageSourceSchema,
          outcome: jevUsageOutcomeSchema,
        }),
      ]),
    )
    .max(200)
    .default([]),
  jev: z
    .object({
      calls: z.number().int(),
      successes: z.number().int(),
      failures: z.number().int(),
      averageDurationMs: z.number().int().nullable(),
      inputTokens: z.number().int().default(0),
      outputTokens: z.number().int().default(0),
      byOutcome: z.array(z.object({ outcome: jevUsageOutcomeSchema, calls: z.number().int() })).default([]),
      successRate: z.number().min(0).max(1).optional(),
      bySource: z
        .array(
          z.object({
            source: jevUsageSourceSchema,
            calls: z.number().int(),
            successes: z.number().int(),
            failures: z.number().int(),
            successRate: z.number().min(0).max(1),
            inputTokens: z.number().int(),
            outputTokens: z.number().int(),
            durationMs: latencyStatsSchema,
          }),
        )
        .default([]),
      durationMs: latencyStatsSchema.optional(),
    })
    .refine(report => report.calls === report.successes + report.failures),
})
export type ActivityReport = z.infer<typeof activityReportSchema>

export const otelMetricsInputSchema = z
  .object({
    from: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    to: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
    days: z.number().int().min(1).max(365).optional(),
  })
  .strict()

export const resolveOtelMetricsRange = (input: z.infer<typeof otelMetricsInputSchema>, now = Date.now()) => {
  if (input.days !== undefined && (input.from !== undefined || input.to !== undefined)) throw new Error('days cannot be combined with from/to.')
  if ((input.from === undefined) !== (input.to === undefined)) throw new Error('Provide both from and to, or neither.')
  const to = input.to ?? now
  const from = input.from ?? Math.max(0, to - (input.days ?? 30) * DAY_MS)
  if (to <= from) throw new Error('to must be after from.')
  if (to - from > 365 * DAY_MS) throw new Error('OTLP export range cannot exceed 365 days.')
  return { from, to }
}

export const otelMetricsOutputSchema = otlpMetricsRequestSchema

export const indexStatusSchema = z.object({
  indexedFiles: z.number().int(),
  requests: z.number().int(),
  lastIndexedAt: z.number().nullable(),
  indexing: z.boolean(),
  pricingFetchedAt: z.number().nullable(),
  lastError: z.string().nullable(),
})

/** Model-facing text for a structured tool result. */
const compactJson = <Output>(output: Output): string => JSON.stringify(output)

export const usageApi = defineApi({
  id: 'dshfiles-usage',
  version: 1,
  owner: '@dshfiles/usage',
  methods: {
    requests: method({
      input: requestQuerySchema,
      output: requestPageSchema,
      description:
        'Page through recorded LLM requests between two Unix-ms timestamps: model, provider, tokens, cache, latency and list-price cost. Optional provider is an exact, case-sensitive account route filter applied before counting and limiting. Read-only.',
      tool: { name: 'usage_requests', readOnly: true, render: output => JSON.stringify(output) },
    }),
    charts: method({
      input: chartQuerySchema,
      output: chartViewSchema,
      description:
        'Cost, token, cache and latency totals between two Unix-ms timestamps, bucketed by hour or day, with breakdowns by model, provider and project, the costliest sessions, estimated cache savings and turn count. Grouping by purpose shows where tokens went (agent, subagent, compaction, title, memory, other). Optional provider scopes all aggregates and previous-period comparisons to that exact, case-sensitive account route. Costs are list-price estimates. Read-only.',
      tool: { name: 'usage_report', readOnly: true, render: output => JSON.stringify(output) },
    }),
    status: method({
      input: z.object({}).strict(),
      output: indexStatusSchema,
      description: 'How far the request index has read the session logs, and when prices were fetched. Read-only.',
      tool: { name: 'usage_status', readOnly: true, render: compactJson },
    }),
    jevUsage: method({
      input: jevUsageQuerySchema,
      output: jevUsageViewSchema,
      description:
        'Read Jev API calls made by DSH between two Unix-ms timestamps, grouped by the local secret-reference label or environment-variable name, including provider-reported tokens and a list-price estimate. Labels are not provider-verified billing identity. Does not include calls outside DSH or TypeSafe account balance. Read-only.',
      tool: { name: 'usage_jev_report', readOnly: true, render: compactJson },
    }),
    recordJevUsage: method({
      input: jevUsageRecordSchema,
      output: z.object({ accepted: z.literal(true) }).strict(),
      description:
        'Record one DSH Jev request observation with only caller, timing, outcome and token counts. No API key, prompt or response text is accepted.',
    }),
    /** Index whatever the session logs gained since the last pass, then report. */
    refresh: method({
      input: z.object({}).strict(),
      output: indexStatusSchema,
      description: 'Index whatever the session logs gained since the last pass, then report the new status. Call only when the user asked to re-index.',
      tool: { name: 'usage_reindex', render: compactJson },
    }),
    activity: method({
      input: activityInputSchema,
      output: activityReportSchema,
      description:
        'Read local tool-use statistics: a per-bucket timeline of calls, errors, wall time and returned tokens, ranked tools and skills with outcomes and latency percentiles, estimated tokens each tool returned, normalized shell command and test-runner time distributions, Jev request totals by calling plugin (backlog, memory), and recent tool/Jev events. Omit inputs for the last 30 days, or specify days (1–365), or from/to Unix milliseconds. Token counts for tools are characters/4 estimates of returned text, never the text itself. Shell command arguments, paths, outputs, test case names and secrets are never stored; compound/ambiguous shell commands are omitted. Use this to answer “which tools or skills do I use most, and which return the most text?” or “what failed recently?”. Tool times are filtered by start time in the half-open [from, to) range; recent tool and Jev events are combined and capped by eventLimit.',
      tool: { name: 'usage_activity_report', readOnly: true, render: compactJson },
    }),
    otelMetrics: method({
      input: otelMetricsInputSchema,
      output: otelMetricsOutputSchema,
      description:
        'Read an OTLP/HTTP JSON ExportMetricsServiceRequest built from the local SQLite usage ledger. Omit inputs for the last 30 days, specify days (1–365), or provide from/to Unix milliseconds. Returns aggregate model-request/token, tool-category/source and Jev request/token counters plus latency histograms; the 500 most-used tool sources are included, while category totals remain exact. Contains no session IDs, paths, prompts, arguments, results, credentials or raw errors. Read-only and makes no network request; SQLite remains the source of truth.',
      tool: { name: 'usage_otel_metrics', readOnly: true, render: compactJson },
    }),
  },
})
