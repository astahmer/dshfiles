import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { UsageFoldModel } from './fold.js'

export const purposeSchema = z.enum(UsageFoldModel.REQUEST_PURPOSES)
export const statusSchema = z.enum(UsageFoldModel.REQUEST_STATUSES)

const rangeShape = {
  from: z.number().int().min(0).describe('Range start, Unix milliseconds.'),
  to: z.number().int().min(0).describe('Range end, Unix milliseconds.'),
  purposes: z.array(purposeSchema).max(UsageFoldModel.REQUEST_PURPOSES.length).optional(),
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
  rows: z.array(requestViewSchema).max(500),
  /** Requests matching every filter except the status chip. */
  total: z.number().int().min(0),
  statusCounts: countsSchema,
  purposeCounts: countsSchema,
})

export type RequestPage = z.infer<typeof requestPageSchema>

export const GROUP_DIMENSIONS = ['model', 'provider', 'project'] as const

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

const breakdownSchema = z.object({ key: z.string(), cost: z.number(), requests: z.number().int(), tokens: z.number() })

export const chartViewSchema = z.object({
  summary: z.object({
    cost: z.number(),
    requests: z.number().int(),
    failed: z.number().int(),
    aborted: z.number().int(),
    ...tokenTotals,
    /** Requests whose route has no catalog price, so `cost` is a lower bound. */
    unpriced: z.number().int(),
    previous: z.object({ cost: z.number(), requests: z.number().int(), tokens: z.number() }),
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
      description: 'Page through recorded LLM requests between two Unix-ms timestamps: model, provider, tokens, cache, latency and list-price cost. Read-only.',
      tool: { name: 'usage_requests', readOnly: true, render: output => JSON.stringify(output) },
    }),
    charts: method({
      input: chartQuerySchema,
      output: chartViewSchema,
      description:
        'Cost, token, cache and latency totals between two Unix-ms timestamps, bucketed by hour or day, with breakdowns by model, provider and project and the costliest sessions. Costs are list-price estimates. Read-only.',
      tool: { name: 'usage_report', readOnly: true, render: output => JSON.stringify(output) },
    }),
    status: method({
      input: z.object({}).strict(),
      output: indexStatusSchema,
      description: 'How far the request index has read the session logs, and when prices were fetched. Read-only.',
      tool: { name: 'usage_status', readOnly: true, render: compactJson },
    }),
    /** Index whatever the session logs gained since the last pass, then report. */
    refresh: method({
      input: z.object({}).strict(),
      output: indexStatusSchema,
      description: 'Index whatever the session logs gained since the last pass, then report the new status. Call only when the user asked to re-index.',
      tool: { name: 'usage_reindex', render: compactJson },
    }),
  },
})
