import { isRoutineAlertEvaluation } from '../alerts/alert-engine.js'
import type { AttributeValue } from '../types.js'
import type {
  OtlpAnyValue,
  OtlpKeyValue,
  OtlpLogRecord,
  OtlpLogsRequest,
  OtlpMetric,
  OtlpMetricPoint,
  OtlpMetricsRequest,
  OtlpSpan,
  OtlpTraceRequest,
} from './json-schema.js'

export const SPAN_BOUNDS = {
  name: 256,
  attributeKey: 128,
  attributes: 128,
  stringValue: 2_048,
  listItems: 64,
  events: 32,
  statusMessage: 512,
} as const

/**
 * Message, prompt and tool-payload attributes the GenAI conventions define. Exporters leave them off unless content
 * capture is opted into; with `redactContent` (the default setting) the store keeps only their size even then.
 */
const CONTENT_ATTRIBUTE_KEYS = new Set([
  'gen_ai.input.messages',
  'gen_ai.output.messages',
  'gen_ai.system_instructions',
  'gen_ai.tool.call.arguments',
  'gen_ai.tool.call.result',
  'gen_ai.tool.definitions',
  'gen_ai.prompt',
  'gen_ai.completion',
  'input.value',
  'output.value',
])
const CONTENT_ATTRIBUTE_PREFIXES = ['gen_ai.prompt.', 'gen_ai.completion.']

const isContentAttribute = (key: string): boolean => CONTENT_ATTRIBUTE_KEYS.has(key) || CONTENT_ATTRIBUTE_PREFIXES.some(prefix => key.startsWith(prefix))

/** The traces API's own dispatch spans: storing them would make every panel poll a trace of itself. */
export const SELF_API_ID = 'traces'
const SELF_API_IDS = new Set([SELF_API_ID, 'traces-alerts'])

export type NormalizedEvent = {
  readonly name: string
  readonly timeUs: number
  readonly attributes: Readonly<Record<string, AttributeValue>>
}

export type NormalizedSpan = {
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId: string | null
  readonly name: string
  readonly service: string
  readonly scope: string | null
  readonly kind: number
  readonly startUs: number
  readonly endUs: number
  readonly statusCode: 0 | 1 | 2
  readonly statusMessage: string | null
  readonly sessionId: string | null
  readonly attributes: Readonly<Record<string, AttributeValue>>
  readonly resource: Readonly<Record<string, AttributeValue>>
  readonly events: readonly NormalizedEvent[]
  readonly linkCount: number
}

export type NormalizeResult = { readonly spans: readonly NormalizedSpan[]; readonly rejected: number; readonly skippedSelf: number }

const truncate = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, max - 1)}…`)

const HEX_ID = /^[0-9a-f]+$/
const BASE64_ID = /^[A-Za-z0-9+/]+={0,2}$/

/** OTLP JSON says lowercase hex; some exporters still send the proto3 default base64. */
const normalizeId = (value: string | undefined, bytes: 8 | 16): string | null => {
  if (value === undefined || value.length === 0) return null
  const lower = value.toLowerCase()
  if (lower.length === bytes * 2 && HEX_ID.test(lower)) return /^0+$/.test(lower) ? null : lower
  if (BASE64_ID.test(value)) {
    const decoded = Buffer.from(value, 'base64')
    if (decoded.length === bytes) {
      const hex = decoded.toString('hex')
      return /^0+$/.test(hex) ? null : hex
    }
  }
  return null
}

const nanosToMicros = (value: string | number | undefined): number | null => {
  if (value === undefined) return null
  try {
    const micros = BigInt(value) / 1000n
    return micros > 0n ? Number(micros) : null
  } catch {
    return null
  }
}

const scalarOf = (value: OtlpAnyValue | undefined): AttributeValue => {
  if (value === undefined) return ''
  if (value.stringValue !== undefined) return truncate(value.stringValue, SPAN_BOUNDS.stringValue)
  if (value.boolValue !== undefined) return value.boolValue
  if (value.intValue !== undefined) {
    const parsed = Number(value.intValue)
    return Number.isSafeInteger(parsed) ? parsed : String(value.intValue)
  }
  if (value.doubleValue !== undefined) return typeof value.doubleValue === 'number' ? value.doubleValue : String(value.doubleValue)
  if (value.bytesValue !== undefined) return truncate(value.bytesValue, SPAN_BOUNDS.stringValue)
  if (value.arrayValue !== undefined) {
    const items = (value.arrayValue.values ?? []).slice(0, SPAN_BOUNDS.listItems).map(item => {
      const scalar = scalarOf(item)
      return Array.isArray(scalar) ? JSON.stringify(scalar) : scalar
    })
    return items.every(item => typeof item === 'string') || items.every(item => typeof item === 'number') || items.every(item => typeof item === 'boolean')
      ? items
      : items.map(String)
  }
  if (value.kvlistValue !== undefined)
    return truncate(
      JSON.stringify(Object.fromEntries((value.kvlistValue.values ?? []).slice(0, SPAN_BOUNDS.listItems).map(entry => [entry.key, scalarOf(entry.value)]))),
      SPAN_BOUNDS.stringValue,
    )
  return ''
}

const contentPlaceholder = (value: AttributeValue): string => {
  const size = typeof value === 'string' ? value.length : JSON.stringify(value).length
  return `[redacted: ${String(size)} chars]`
}

export type NormalizeOptions = { readonly redactContent: boolean }

type SpanAttributes = Record<string, AttributeValue>

const attributesOf = (attributes: readonly OtlpKeyValue[] | undefined, options: NormalizeOptions): SpanAttributes => {
  const result: SpanAttributes = {}
  let count = 0
  for (const attribute of attributes ?? []) {
    if (count >= SPAN_BOUNDS.attributes) break
    const key = truncate(attribute.key, SPAN_BOUNDS.attributeKey)
    if (key.length === 0 || Object.hasOwn(result, key)) continue
    const value = scalarOf(attribute.value)
    result[key] = options.redactContent && isContentAttribute(key) ? contentPlaceholder(value) : value
    count += 1
  }
  return result
}

const KIND_NAMES = new Map([
  ['SPAN_KIND_UNSPECIFIED', 0],
  ['SPAN_KIND_INTERNAL', 1],
  ['SPAN_KIND_SERVER', 2],
  ['SPAN_KIND_CLIENT', 3],
  ['SPAN_KIND_PRODUCER', 4],
  ['SPAN_KIND_CONSUMER', 5],
])

const kindOf = (kind: number | string | undefined): number => {
  const numeric = typeof kind === 'string' ? (KIND_NAMES.get(kind) ?? 0) : (kind ?? 0)
  return numeric >= 0 && numeric <= 5 ? numeric : 0
}

const STATUS_NAMES = new Map<string, 0 | 1 | 2>([
  ['STATUS_CODE_UNSET', 0],
  ['STATUS_CODE_OK', 1],
  ['STATUS_CODE_ERROR', 2],
])

const statusOf = (code: number | string | undefined): 0 | 1 | 2 => {
  if (typeof code === 'string') return STATUS_NAMES.get(code) ?? 0
  return code === 1 || code === 2 ? code : 0
}

const stringAttribute = (attributes: Readonly<Record<string, AttributeValue>>, key: string): string | null => {
  const value = attributes[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}

const normalizeSpan = (
  span: OtlpSpan,
  context: {
    readonly service: string
    readonly scope: string | null
    readonly resource: Readonly<Record<string, AttributeValue>>
    readonly options: NormalizeOptions
  },
): NormalizedSpan | null => {
  const traceId = normalizeId(span.traceId, 16)
  const spanId = normalizeId(span.spanId, 8)
  const startUs = nanosToMicros(span.startTimeUnixNano)
  if (traceId === null || spanId === null || startUs === null) return null
  const endUs = Math.max(startUs, nanosToMicros(span.endTimeUnixNano) ?? startUs)
  const attributes = attributesOf(span.attributes, context.options)
  const statusCode = statusOf(span.status?.code)
  const statusMessage = span.status?.message === undefined || span.status.message.length === 0 ? null : truncate(span.status.message, SPAN_BOUNDS.statusMessage)
  return {
    traceId,
    spanId,
    parentSpanId: normalizeId(span.parentSpanId, 8),
    name: truncate(span.name ?? '', SPAN_BOUNDS.name) || '(unnamed)',
    service: context.service,
    scope: context.scope,
    kind: kindOf(span.kind),
    startUs,
    endUs,
    statusCode,
    statusMessage,
    sessionId: stringAttribute(attributes, 'dsh.session.id'),
    attributes,
    resource: context.resource,
    events: (span.events ?? []).slice(0, SPAN_BOUNDS.events).map(event => ({
      name: truncate(event.name ?? '', SPAN_BOUNDS.name),
      timeUs: nanosToMicros(event.timeUnixNano) ?? startUs,
      attributes: attributesOf(event.attributes, context.options),
    })),
    linkCount: span.links?.length ?? 0,
  }
}

const normalizeTraceRequest = (request: OtlpTraceRequest, options: NormalizeOptions): NormalizeResult => {
  const spans: NormalizedSpan[] = []
  let rejected = 0
  let skippedSelf = 0
  for (const resourceSpans of request.resourceSpans ?? []) {
    const resource = attributesOf(resourceSpans.resource?.attributes, options)
    const service = truncate(stringAttribute(resource, 'service.name') ?? 'unknown_service', SPAN_BOUNDS.name)
    for (const scopeSpans of resourceSpans.scopeSpans ?? []) {
      const scope = scopeSpans.scope?.name === undefined || scopeSpans.scope.name.length === 0 ? null : truncate(scopeSpans.scope.name, SPAN_BOUNDS.name)
      for (const span of scopeSpans.spans ?? []) {
        const normalized = normalizeSpan(span, { service, scope, resource, options })
        if (normalized === null) {
          rejected += 1
          continue
        }
        const apiId = normalized.attributes['dshx.api.id']
        if ((typeof apiId === 'string' && SELF_API_IDS.has(apiId)) || isRoutineAlertEvaluation(normalized)) {
          skippedSelf += 1
          continue
        }
        spans.push(normalized)
      }
    }
  }
  return { spans, rejected, skippedSelf }
}

export const LOG_BODY_BOUND = 8_192

export type NormalizedLog = {
  readonly timeUs: number
  readonly severityNumber: number
  readonly severityText: string | null
  readonly body: string
  readonly service: string
  readonly scope: string | null
  readonly traceId: string | null
  readonly spanId: string | null
  readonly eventName: string | null
  readonly attributes: Readonly<Record<string, AttributeValue>>
  readonly resource: Readonly<Record<string, AttributeValue>>
}

export type NormalizeLogsResult = { readonly logs: readonly NormalizedLog[]; readonly rejected: number }

const SEVERITY_NAMES = new Map([
  ['SEVERITY_NUMBER_UNSPECIFIED', 0],
  ['SEVERITY_NUMBER_TRACE', 1],
  ['SEVERITY_NUMBER_DEBUG', 5],
  ['SEVERITY_NUMBER_INFO', 9],
  ['SEVERITY_NUMBER_WARN', 13],
  ['SEVERITY_NUMBER_ERROR', 17],
  ['SEVERITY_NUMBER_FATAL', 21],
])

const severityOf = (severity: number | string | undefined): number => {
  const numeric = typeof severity === 'string' ? (SEVERITY_NAMES.get(severity) ?? 0) : (severity ?? 0)
  return numeric >= 0 && numeric <= 24 ? numeric : 0
}

const bodyText = (body: OtlpAnyValue | undefined): string => {
  if (body === undefined) return ''
  if (body.stringValue !== undefined) return truncate(body.stringValue, LOG_BODY_BOUND)
  const scalar = scalarOf(body)
  return truncate(typeof scalar === 'string' ? scalar : JSON.stringify(scalar), LOG_BODY_BOUND)
}

/** GenAI content events (`gen_ai.user.message`, `gen_ai.choice`, …) carry prompts and completions in their body. */
const isGenAiEvent = (eventName: string | null, attributes: Readonly<Record<string, AttributeValue>>): boolean => {
  const name = eventName ?? attributes['event.name']
  return typeof name === 'string' && name.startsWith('gen_ai.')
}

const normalizeLog = (
  record: OtlpLogRecord,
  context: {
    readonly service: string
    readonly scope: string | null
    readonly resource: Readonly<Record<string, AttributeValue>>
    readonly options: NormalizeOptions
  },
): NormalizedLog | null => {
  const timeUs = nanosToMicros(record.timeUnixNano) ?? nanosToMicros(record.observedTimeUnixNano)
  if (timeUs === null) return null
  const attributes = attributesOf(record.attributes, context.options)
  const severityText = record.severityText === undefined || record.severityText.length === 0 ? null : truncate(record.severityText, 32)
  const eventName = record.eventName === undefined || record.eventName.length === 0 ? null : truncate(record.eventName, SPAN_BOUNDS.name)
  const body = bodyText(record.body)
  return {
    timeUs,
    severityNumber: severityOf(record.severityNumber),
    severityText,
    body: context.options.redactContent && body.length > 0 && isGenAiEvent(eventName, attributes) ? `[redacted: ${String(body.length)} chars]` : body,
    service: context.service,
    scope: context.scope,
    traceId: normalizeId(record.traceId, 16),
    spanId: normalizeId(record.spanId, 8),
    eventName,
    attributes,
    resource: context.resource,
  }
}

const normalizeLogsRequest = (request: OtlpLogsRequest, options: NormalizeOptions): NormalizeLogsResult => {
  const logs: NormalizedLog[] = []
  let rejected = 0
  for (const resourceLogs of request.resourceLogs ?? []) {
    const resource = attributesOf(resourceLogs.resource?.attributes, options)
    const service = truncate(stringAttribute(resource, 'service.name') ?? 'unknown_service', SPAN_BOUNDS.name)
    for (const scopeLogs of resourceLogs.scopeLogs ?? []) {
      const scope = scopeLogs.scope?.name === undefined || scopeLogs.scope.name.length === 0 ? null : truncate(scopeLogs.scope.name, SPAN_BOUNDS.name)
      for (const record of scopeLogs.logRecords ?? []) {
        const normalized = normalizeLog(record, { service, scope, resource, options })
        if (normalized === null) rejected += 1
        else logs.push(normalized)
      }
    }
  }
  return { logs, rejected }
}

export type MetricType = 'gauge' | 'sum' | 'histogram' | 'exponentialHistogram' | 'summary'
export type MetricTemporality = 'unspecified' | 'delta' | 'cumulative'

export type NormalizedMetricPoint = {
  readonly name: string
  readonly description: string | null
  readonly unit: string | null
  readonly type: MetricType
  readonly monotonic: boolean
  readonly temporality: MetricTemporality
  readonly service: string
  readonly scope: string | null
  readonly timeUs: number
  readonly value: number | null
  readonly count: number | null
  readonly sum: number | null
  readonly min: number | null
  readonly max: number | null
  readonly attributes: Readonly<Record<string, AttributeValue>>
}

export type NormalizeMetricsResult = { readonly points: readonly NormalizedMetricPoint[]; readonly rejected: number }

const finiteOf = (value: number | string | undefined): number | null => {
  if (value === undefined) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

const temporalityOf = (value: number | string | undefined): MetricTemporality => {
  if (value === 1 || value === 'AGGREGATION_TEMPORALITY_DELTA') return 'delta'
  if (value === 2 || value === 'AGGREGATION_TEMPORALITY_CUMULATIVE') return 'cumulative'
  return 'unspecified'
}

const metricData = (metric: OtlpMetric) => {
  if (metric.gauge !== undefined) return { type: 'gauge' as const, data: metric.gauge }
  if (metric.sum !== undefined) return { type: 'sum' as const, data: metric.sum }
  if (metric.histogram !== undefined) return { type: 'histogram' as const, data: metric.histogram }
  if (metric.exponentialHistogram !== undefined) return { type: 'exponentialHistogram' as const, data: metric.exponentialHistogram }
  if (metric.summary !== undefined) return { type: 'summary' as const, data: metric.summary }
  return null
}

/** A number point's value; for a distribution, its mean (sum / count) so every metric charts as one line. */
const pointValue = (
  type: MetricType,
  point: OtlpMetricPoint,
): { readonly value: number | null; readonly count: number | null; readonly sum: number | null } => {
  if (type === 'gauge' || type === 'sum') return { value: finiteOf(point.asDouble) ?? finiteOf(point.asInt), count: null, sum: null }
  const count = finiteOf(point.count)
  const sum = finiteOf(point.sum)
  return { value: count !== null && count > 0 && sum !== null ? sum / count : null, count, sum }
}

const normalizeMetricsRequest = (request: OtlpMetricsRequest, options: NormalizeOptions): NormalizeMetricsResult => {
  const points: NormalizedMetricPoint[] = []
  let rejected = 0
  for (const resourceMetrics of request.resourceMetrics ?? []) {
    const resource = attributesOf(resourceMetrics.resource?.attributes, options)
    const service = truncate(stringAttribute(resource, 'service.name') ?? 'unknown_service', SPAN_BOUNDS.name)
    for (const scopeMetrics of resourceMetrics.scopeMetrics ?? []) {
      const scope = scopeMetrics.scope?.name === undefined || scopeMetrics.scope.name.length === 0 ? null : truncate(scopeMetrics.scope.name, SPAN_BOUNDS.name)
      for (const metric of scopeMetrics.metrics ?? []) {
        const data = metricData(metric)
        const name = truncate(metric.name ?? '', SPAN_BOUNDS.name)
        if (data === null || name.length === 0) {
          rejected += 1
          continue
        }
        for (const point of data.data.dataPoints ?? []) {
          const timeUs = nanosToMicros(point.timeUnixNano)
          if (timeUs === null) {
            rejected += 1
            continue
          }
          points.push({
            name,
            description: metric.description === undefined || metric.description.length === 0 ? null : truncate(metric.description, SPAN_BOUNDS.statusMessage),
            unit: metric.unit === undefined || metric.unit.length === 0 ? null : truncate(metric.unit, 32),
            type: data.type,
            monotonic: data.data.isMonotonic ?? false,
            temporality: temporalityOf(data.data.aggregationTemporality),
            service,
            scope,
            timeUs,
            ...pointValue(data.type, point),
            min: finiteOf(point.min),
            max: finiteOf(point.max),
            attributes: attributesOf(point.attributes, options),
          })
        }
      }
    }
  }
  return { points, rejected }
}

export class SpanNormalizer {
  static readonly normalizeMetrics = normalizeMetricsRequest
  static readonly normalizeTraces = normalizeTraceRequest
  static readonly normalizeLogs = normalizeLogsRequest
  static readonly isContentAttribute = isContentAttribute
}
