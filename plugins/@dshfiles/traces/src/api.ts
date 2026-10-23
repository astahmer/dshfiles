import { defineApi, method } from '@dshfiles/dshx/api'
import { z } from 'zod'
import {
  errorGroupSchema,
  logListSchema,
  metricSeriesSchema,
  metricSummarySchema,
  receiverStatusSchema,
  serviceMapSchema,
  traceDetailSchema,
  traceListSchema,
  traceStatsSchema,
} from './types.js'

const windowMinutesSchema = z
  .number()
  .int()
  .min(1)
  .max(30 * 24 * 60)
  .optional()
  .describe('Look-back window in minutes; defaults to 60.')

const traceIdSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{32}$/)
  .describe('32-character hex trace id.')

export const listInputSchema = z
  .object({
    service: z.string().min(1).max(256).optional().describe('Only traces with a span from this service.name.'),
    operation: z.string().min(1).max(256).optional().describe('Only traces with a span of exactly this name.'),
    status: z.enum(['all', 'error', 'ok']).optional().describe('error: traces with at least one error span; ok: none. Defaults to all.'),
    minDurationMs: z.number().nonnegative().max(86_400_000).optional().describe('Only traces at least this long, in milliseconds.'),
    fromMs: z.number().int().nonnegative().optional().describe('Only traces starting at or after this Unix time in milliseconds.'),
    toMs: z.number().int().nonnegative().optional().describe('Only traces starting before this Unix time in milliseconds.'),
    search: z.string().trim().min(1).max(200).optional().describe('Literal text matched against a trace id, span names, attribute JSON and status messages.'),
    sessionId: z.string().min(1).max(256).optional().describe('Only traces whose spans carry this dsh.session.id.'),
    cursor: z.string().min(1).max(64).optional().describe('next_cursor from a previous page.'),
    limit: z.number().int().min(1).max(200).optional().describe('Traces per page, 1 to 200; defaults to 50.'),
  })
  .strict()
export type ListInput = z.infer<typeof listInputSchema>

const hexId = (bytes: 8 | 16) =>
  z
    .string()
    .regex(new RegExp(`^[0-9a-fA-F]{${String(bytes * 2)}}$`))
    .describe(`${String(bytes * 2)}-character hex ${bytes === 16 ? 'trace' : 'span'} id.`)

export const logsInputSchema = z
  .object({
    service: z.string().min(1).max(256).optional().describe('Only records from this service.name.'),
    minSeverity: z
      .number()
      .int()
      .min(0)
      .max(24)
      .optional()
      .describe('Only records at or above this OTLP severity number: 5 debug, 9 info, 13 warn, 17 error, 21 fatal.'),
    search: z.string().trim().min(1).max(200).optional().describe('Literal text matched against the body, attribute JSON and event name.'),
    attribute: z
      .object({
        key: z
          .string()
          .regex(/^[\w.:/-]{1,128}$/)
          .describe('Attribute key, e.g. http.route.'),
        value: z.string().max(512).describe('Exact value, compared as text.'),
      })
      .strict()
      .optional()
      .describe('Only records whose attribute equals this value.'),
    traceId: hexId(16).optional().describe('Only records correlated with this trace.'),
    spanId: hexId(8).optional().describe('Only records correlated with this span.'),
    fromMs: z.number().int().nonnegative().optional().describe('Only records at or after this Unix time in milliseconds.'),
    toMs: z.number().int().nonnegative().optional().describe('Only records before this Unix time in milliseconds.'),
    cursor: z.string().min(1).max(64).optional().describe('next_cursor from a previous page.'),
    limit: z.number().int().min(1).max(500).optional().describe('Records per page, 1 to 500; defaults to 100.'),
  })
  .strict()
export type LogsInput = z.infer<typeof logsInputSchema>

export const clearInputSchema = z.object({ confirm: z.literal(true).describe('Must be true: deleting stored telemetry cannot be undone.') }).strict()

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
        'Search stored OpenTelemetry traces, newest first: root span, duration, span and error counts, services. Filter by service, operation, error status, minimum duration, time range, text or DSH session. Read-only.',
      tool: { name: 'traces_search', readOnly: true, render: compactJson },
    }),
    trace: method({
      input: z.object({ traceId: traceIdSchema }).strict(),
      output: traceDetailSchema,
      description:
        'One stored trace as a span tree in depth-first order: each span with depth, offset and duration in ms, service, kind, status, attributes, resource attributes and events. Read-only.',
      tool: { name: 'traces_get', readOnly: true, render: compactJson },
    }),
    stats: method({
      input: z
        .object({
          windowMinutes: windowMinutesSchema,
          service: z.string().min(1).max(256).optional().describe('Only this service.name.'),
          limit: z.number().int().min(1).max(500).optional().describe('Operations to return, most frequent first; defaults to 100.'),
        })
        .strict(),
      output: traceStatsSchema,
      description: 'Per service and per operation (span name) over a window: span count, error count and rate, p50/p95/p99 and max duration in ms. Read-only.',
      tool: { name: 'traces_list_services', readOnly: true, render: compactJson },
    }),
    metrics: method({
      input: z
        .object({
          windowMinutes: windowMinutesSchema,
          service: z.string().min(1).max(256).optional().describe('Only metrics from this service.name.'),
          search: z.string().trim().min(1).max(200).optional().describe('Literal text matched against metric names and descriptions.'),
        })
        .strict(),
      output: z.object({ metrics: z.array(metricSummarySchema) }).strict(),
      description:
        'Stored OpenTelemetry metrics received on /v1/metrics, per service and name: type, unit, description, point and series counts, last time and last value. Read-only.',
      tool: { name: 'traces_list_metrics', readOnly: true, render: compactJson },
    }),
    metric: method({
      input: z
        .object({
          name: z.string().min(1).max(256).describe('Metric name as listed by traces_list_metrics.'),
          service: z.string().min(1).max(256).describe('The service.name that reported it.'),
          windowMinutes: windowMinutesSchema,
        })
        .strict(),
      output: metricSeriesSchema,
      description:
        'One metric over a window as series per attribute set (at most 20 series of 500 points): gauges and sums as their value, cumulative counters as their increase between points, histograms and summaries as their mean. Read-only.',
      tool: { name: 'traces_get_metric', readOnly: true, render: compactJson },
    }),
    serviceMap: method({
      input: z.object({ windowMinutes: windowMinutesSchema }).strict(),
      output: serviceMapSchema,
      description:
        'Service dependency map over a window: each service with its span count, error rate and latency, and each edge where a span of one service is the parent of a span of another, with call count, error rate and p50/p95/p99 of the callee spans. Read-only.',
      tool: { name: 'traces_service_map', readOnly: true, render: compactJson },
    }),
    errors: method({
      input: z
        .object({
          windowMinutes: windowMinutesSchema,
          limit: z.number().int().min(1).max(200).optional().describe('Groups to return, largest first; defaults to 50.'),
        })
        .strict(),
      output: z.object({ groups: z.array(errorGroupSchema) }).strict(),
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
    status: method({
      input: z.object({}).strict(),
      output: receiverStatusSchema,
      description:
        'The OTLP receiver: viewer mode, listen address and state (listening, port in use, off), request and item counters, forwarding, and what the store retains. Read-only.',
      tool: { name: 'traces_status', readOnly: true, render: compactJson },
    }),
    clear: method({
      input: z.object({ confirm: z.literal(true).describe('Must be true: deleting stored telemetry cannot be undone.') }).strict(),
      output: z
        .object({
          removedSpans: z.number().int().nonnegative(),
          removedTraces: z.number().int().nonnegative(),
          removedLogs: z.number().int().nonnegative(),
          removedMetricPoints: z.number().int().nonnegative(),
        })
        .strict(),
      description:
        'Delete every stored trace, log record and metric point. Run only when the user asked to clear stored telemetry, and pass confirm: true; the receiver keeps running.',
      tool: { name: 'traces_clear', readOnly: false, render: compactJson },
    }),
  },
})
