import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import { spanFilterSchema } from '../alerts/alert-types.js'

const attributeKeySchema = z.string().regex(/^[\w.:/-]{1,128}$/)

export const breakdownInputSchema = z
  .object({
    windowMinutes: z
      .number()
      .int()
      .min(1)
      .max(30 * 24 * 60)
      .describe('Spans that ended within this many minutes.'),
    filter: spanFilterSchema,
    groupBy: z
      .union([
        z.object({ kind: z.literal('service') }).strict(),
        z.object({ kind: z.literal('operation') }).strict(),
        z.object({ kind: z.literal('attribute'), key: attributeKeySchema }).strict(),
      ])
      .describe('One row per service, per span name, or per value of one attribute (spans without it group as null).'),
    measure: z
      .object({
        key: attributeKeySchema.describe('A numeric span attribute, e.g. gen_ai.response.time_to_first_token.'),
        divisor: z.number().positive().max(1e12).describe('Divide the raw value by this to get milliseconds (1e6 for nanoseconds).'),
      })
      .strict()
      .optional()
      .describe('Also report p50/p95 of one numeric attribute, in milliseconds.'),
    sortBy: z.enum(['count', 'errorRate', 'p95']).optional().describe('Row order; defaults to count.'),
    limit: z.number().int().min(1).max(100).optional().describe('Rows to return; defaults to 25.'),
  })
  .strict()
export type BreakdownInput = z.infer<typeof breakdownInputSchema>

export const breakdownRowSchema = z
  .object({
    key: z.string().nullable(),
    count: z.number().int().nonnegative(),
    errorCount: z.number().int().nonnegative(),
    errorRate: z.number().min(0).max(1),
    p50Ms: z.number().nullable(),
    p95Ms: z.number().nullable(),
    p99Ms: z.number().nullable(),
    maxMs: z.number().nullable(),
    measureP50Ms: z.number().nullable(),
    measureP95Ms: z.number().nullable(),
  })
  .strict()
export type BreakdownRow = z.infer<typeof breakdownRowSchema>

export const breakdownSchema = z
  .object({
    windowMinutes: z.number().int().positive(),
    spans: z.number().int().nonnegative(),
    truncated: z.boolean().describe('More spans matched than were sampled (the newest 50,000 count).'),
    rows: z.array(breakdownRowSchema),
  })
  .strict()
export type Breakdown = z.infer<typeof breakdownSchema>

export const tracesBoardsApi = defineApi({
  id: 'traces-boards',
  version: 1,
  owner: '@dshfiles/traces',
  methods: {
    breakdown: method({
      input: breakdownInputSchema,
      output: breakdownSchema,
      description:
        'Group the spans of a window by service, span name or one attribute value, with count, error rate, p50/p95/p99 and max duration per group, optionally p50/p95 of a numeric attribute; the Boards tab (slow tools by gen_ai.tool.name, failing plugins by dshx.plugin.package, model latency by gen_ai.provider.name, jobs by dsh.job.kind) reads it. Read-only.',
      tool: { name: 'traces_breakdown', readOnly: true, render: output => JSON.stringify(output) },
    }),
  },
})
