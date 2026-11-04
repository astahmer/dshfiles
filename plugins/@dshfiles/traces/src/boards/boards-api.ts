import { defineApi, method } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { attributeKeySchema, spanFilterSchema } from '../alerts/alert-types.js'

const finiteNumber = Schema.Number.check(Schema.isFinite())

export const breakdownInputSchema = Schema.Struct({
  windowMinutes: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(30 * 24 * 60)).annotate({
    description: 'Spans that ended within this many minutes.',
  }),
  filter: spanFilterSchema,
  groupBy: Schema.Union([
    Schema.Struct({ kind: Schema.Literal('service') }),
    Schema.Struct({ kind: Schema.Literal('operation') }),
    Schema.Struct({ kind: Schema.Literal('attribute'), key: attributeKeySchema }),
  ]).annotate({ description: 'One row per service, per span name, or per value of one attribute (spans without it group as null).' }),
  measure: Schema.optional(
    Schema.Struct({
      key: attributeKeySchema.annotate({ description: 'A numeric span attribute, e.g. gen_ai.response.time_to_first_token.' }),
      divisor: finiteNumber.check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(1e12)).annotate({
        description: 'Divide the raw value by this to get milliseconds (1e6 for nanoseconds).',
      }),
    }),
  ).annotate({ description: 'Also report p50/p95 of one numeric attribute, in milliseconds.' }),
  sortBy: Schema.optional(Schema.Literals(['count', 'errorRate', 'p95'])).annotate({ description: 'Row order; defaults to count.' }),
  limit: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(100))).annotate({
    description: 'Rows to return; defaults to 25.',
  }),
})
export type BreakdownInput = Schema.Schema.Type<typeof breakdownInputSchema>

const nonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

const breakdownRowSchema = Schema.Struct({
  key: Schema.NullOr(Schema.String),
  count: nonNegativeInt,
  errorCount: nonNegativeInt,
  errorRate: finiteNumber.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1)),
  p50Ms: Schema.NullOr(finiteNumber),
  p95Ms: Schema.NullOr(finiteNumber),
  p99Ms: Schema.NullOr(finiteNumber),
  maxMs: Schema.NullOr(finiteNumber),
  measureP50Ms: Schema.NullOr(finiteNumber),
  measureP95Ms: Schema.NullOr(finiteNumber),
})
export type BreakdownRow = Schema.Schema.Type<typeof breakdownRowSchema>

const breakdownSchema = Schema.Struct({
  windowMinutes: Schema.Int.check(Schema.isGreaterThan(0)),
  spans: nonNegativeInt,
  truncated: Schema.Boolean.annotate({ description: 'More spans matched than were sampled (the newest 50,000 count).' }),
  rows: Schema.Array(breakdownRowSchema),
})
export type Breakdown = Schema.Schema.Type<typeof breakdownSchema>

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
