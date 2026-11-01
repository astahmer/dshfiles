import { defineApi } from '@dshfiles/dshx/api'
import * as Schema from 'effect/Schema'
import { method } from './api-schema.js'
import {
  errorGroupSchema,
  logListSchema,
  metricSeriesSchema,
  metricSummarySchema,
  receiverStatusSchema,
  serviceMapSchema,
  sessionSummarySchema,
  traceDetailSchema,
  traceListSchema,
  traceStatsSchema,
} from './types.js'

const finiteNumber = Schema.Number.check(Schema.isFinite())
const nonNegativeInt = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))

const windowMinutesSchema = Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(30 * 24 * 60))).annotate({
  description: 'Look-back window in minutes; defaults to 60.',
})

const traceIdSchema = Schema.String.check(Schema.isPattern(/^[0-9a-fA-F]{32}$/)).annotate({ description: '32-character hex trace id.' })

const listInputSchema = Schema.Struct({
  service: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))).annotate({
    description: 'Only traces with a span from this service.name.',
  }),
  operation: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))).annotate({
    description: 'Only traces with a span of exactly this name.',
  }),
  status: Schema.optional(Schema.Literals(['all', 'error', 'ok'])).annotate({
    description: 'error: traces with at least one error span; ok: none. Defaults to all.',
  }),
  minDurationMs: Schema.optional(finiteNumber.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(86_400_000))).annotate({
    description: 'Only traces at least this long, in milliseconds.',
  }),
  fromMs: Schema.optional(nonNegativeInt).annotate({ description: 'Only traces starting at or after this Unix time in milliseconds.' }),
  toMs: Schema.optional(nonNegativeInt).annotate({ description: 'Only traces starting before this Unix time in milliseconds.' }),
  search: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))).annotate({
    description: 'Literal text matched against a trace id, span names, attribute JSON and status messages.',
  }),
  sessionId: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))).annotate({
    description: 'Only traces whose spans carry this dsh.session.id.',
  }),
  turn: Schema.optional(nonNegativeInt).annotate({
    description: "Only traces with a span of this dsh.turn; with sessionId, that thread's turn (a subagent's turns share the parent's trace).",
  }),
  cursor: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))).annotate({ description: 'next_cursor from a previous page.' }),
  limit: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200))).annotate({
    description: 'Traces per page, 1 to 200; defaults to 50.',
  }),
})
export type ListInput = Schema.Schema.Type<typeof listInputSchema>

const hexId = (bytes: 8 | 16) =>
  Schema.String.check(Schema.isPattern(new RegExp(`^[0-9a-fA-F]{${String(bytes * 2)}}$`))).annotate({
    description: `${String(bytes * 2)}-character hex ${bytes === 16 ? 'trace' : 'span'} id.`,
  })

const logsInputSchema = Schema.Struct({
  service: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))).annotate({
    description: 'Only records from this service.name.',
  }),
  minSeverity: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(24))).annotate({
    description: 'Only records at or above this OTLP severity number: 5 debug, 9 info, 13 warn, 17 error, 21 fatal.',
  }),
  search: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))).annotate({
    description: 'Literal text matched against the body, attribute JSON and event name.',
  }),
  attribute: Schema.optional(
    Schema.Struct({
      key: Schema.String.check(Schema.isPattern(/^[\w.:/-]{1,128}$/)).annotate({ description: 'Attribute key, e.g. http.route.' }),
      value: Schema.String.check(Schema.isMaxLength(512)).annotate({ description: 'Exact value, compared as text.' }),
    }),
  ).annotate({ description: 'Only records whose attribute equals this value.' }),
  traceId: Schema.optional(hexId(16)).annotate({ description: 'Only records correlated with this trace.' }),
  spanId: Schema.optional(hexId(8)).annotate({ description: 'Only records correlated with this span.' }),
  sessionId: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))).annotate({
    description: 'Only records of this DSH Session: correlated with one of its traces, or carrying its dsh.session.id attribute.',
  }),
  fromMs: Schema.optional(nonNegativeInt).annotate({ description: 'Only records at or after this Unix time in milliseconds.' }),
  toMs: Schema.optional(nonNegativeInt).annotate({ description: 'Only records before this Unix time in milliseconds.' }),
  cursor: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))).annotate({ description: 'next_cursor from a previous page.' }),
  limit: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(500))).annotate({
    description: 'Records per page, 1 to 500; defaults to 100.',
  }),
})
export type LogsInput = Schema.Schema.Type<typeof logsInputSchema>

const confirmSchema = Schema.Literal(true).annotate({ description: 'Must be true: deleting stored telemetry cannot be undone.' })

export const clearInputSchema = Schema.Struct({ confirm: confirmSchema })

const compactJson = <Output>(output: Output): string => JSON.stringify(output)

export const tracesApi = defineApi({
  id: 'traces',
  version: 1,
  owner: '@dshfiles/traces',
  methods: {
    list: method({
      input: listInputSchema,
      output: traceListSchema,
      description:
        'Search stored OpenTelemetry traces, newest first: root span, duration, span and error counts, services and list-price cost of their model calls. Filter by service, operation, error status, minimum duration, time range, text, DSH session or turn. Read-only.',
      tool: { name: 'traces_search', readOnly: true, render: compactJson },
    }),
    trace: method({
      input: Schema.Struct({ traceId: traceIdSchema }),
      output: traceDetailSchema,
      description:
        'One stored trace as a span tree in depth-first order: each span with depth, offset and duration in ms, service, kind, status, attributes, resource attributes and events. Read-only.',
      tool: { name: 'traces_get', readOnly: true, render: compactJson },
    }),
    stats: method({
      input: Schema.Struct({
        windowMinutes: windowMinutesSchema,
        service: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))).annotate({ description: 'Only this service.name.' }),
        limit: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(500))).annotate({
          description: 'Operations to return, most frequent first; defaults to 100.',
        }),
      }),
      output: traceStatsSchema,
      description:
        'Per service and per operation (span name) over a window: span count, error count and rate, p50/p95/p99 and max duration in ms; plus model calls per service and model with token sums and list-price cost (dshx.cost.usd). Read-only.',
      tool: { name: 'traces_list_services', readOnly: true, render: compactJson },
    }),
    metrics: method({
      input: Schema.Struct({
        windowMinutes: windowMinutesSchema,
        service: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))).annotate({
          description: 'Only metrics from this service.name.',
        }),
        search: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200))).annotate({
          description: 'Literal text matched against metric names and descriptions.',
        }),
      }),
      output: Schema.Struct({ metrics: Schema.Array(metricSummarySchema) }),
      description:
        'Stored OpenTelemetry metrics received on /v1/metrics, per service and name: type, unit, description, point and series counts, last time, and the last value when the metric has a single series. Read-only.',
      tool: { name: 'traces_list_metrics', readOnly: true, render: compactJson },
    }),
    metric: method({
      input: Schema.Struct({
        name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)).annotate({ description: 'Metric name as listed by traces_list_metrics.' }),
        service: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)).annotate({ description: 'The service.name that reported it.' }),
        windowMinutes: windowMinutesSchema,
      }),
      output: metricSeriesSchema,
      description:
        'One metric over a window as series per attribute set (at most 20 series of 500 points): gauges and sums as their value, cumulative counters as their increase between points, histograms and summaries as their mean. Read-only.',
      tool: { name: 'traces_get_metric', readOnly: true, render: compactJson },
    }),
    serviceMap: method({
      input: Schema.Struct({ windowMinutes: windowMinutesSchema }),
      output: serviceMapSchema,
      description:
        'Service dependency map over a window: each service with its span count, error rate and latency, and each edge where a span of one service is the parent of a span of another, with call count, error rate and p50/p95/p99 of the callee spans. Read-only.',
      tool: { name: 'traces_service_map', readOnly: true, render: compactJson },
    }),
    errors: method({
      input: Schema.Struct({
        windowMinutes: windowMinutesSchema,
        limit: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1), Schema.isLessThanOrEqualTo(200))).annotate({
          description: 'Groups to return, largest first; defaults to 50.',
        }),
      }),
      output: Schema.Struct({ groups: Schema.Array(errorGroupSchema) }),
      description:
        'Error spans grouped by service, span name, error.type (or exception.type) and status message shape: count, first and last seen, and a sample trace id. Read-only.',
      tool: { name: 'traces_error_groups', readOnly: true, render: compactJson },
    }),
    logs: method({
      input: logsInputSchema,
      output: logListSchema,
      description:
        'Search stored OpenTelemetry log records, newest first: time, severity, body, service, scope, attributes, resource and the trace/span they belong to. Filter by service, minimum severity, text, one attribute value, trace or span id and time range. Read-only.',
      tool: { name: 'traces_search_logs', readOnly: true, render: compactJson },
    }),
    sessionSummary: method({
      input: Schema.Struct({
        sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256)).annotate({
          description: 'DSH Session id, matched against dsh.session.id on any span of a trace.',
        }),
      }),
      output: sessionSummarySchema,
      description:
        "One DSH thread's telemetry at a glance: traces and spans carrying its dsh.session.id (plugin spans nested under them included), error spans, turns, model and tool calls, first and last time, total and percentile trace durations, model-call latency, gen_ai.usage token totals over model calls, and list-price cost (dshx.cost.usd) in total and per turn. Pair with traces_search sessionId for the traces and traces_search_logs sessionId for its logs. Read-only.",
      tool: { name: 'traces_session_summary', readOnly: true, render: compactJson },
    }),
    status: method({
      input: Schema.Struct({}),
      output: receiverStatusSchema,
      description:
        'The OTLP receiver: viewer mode, listen address and state (listening, port in use, off), request and item counters, forwarding, what the store retains, where this DSH process exports its own spans and metrics, and a diagnosis of why telemetry does or does not arrive. Read-only.',
      tool: { name: 'traces_status', readOnly: true, render: compactJson },
    }),
    clear: method({
      input: clearInputSchema,
      output: Schema.Struct({ removedSpans: nonNegativeInt, removedTraces: nonNegativeInt, removedLogs: nonNegativeInt, removedMetricPoints: nonNegativeInt }),
      description:
        'Delete every stored trace, log record and metric point. Run only when the user asked to clear stored telemetry, and pass confirm: true; the receiver keeps running.',
      tool: { name: 'traces_clear', readOnly: false, render: compactJson },
    }),
  },
})
