import * as Schema from 'effect/Schema'
import { ApiDefinitionModel } from '../api/define.js'
import type { ApiHostRegistration } from '../api/types.js'
import {
  BROWSER_SERVICE_NAME,
  BROWSER_TRACES_API,
  BROWSER_TRACES_LIMITS,
  type BrowserResource,
  type BrowserSpanRecord,
  type BrowserTracesExportResult,
  type BrowserTracingStatus,
} from './browser-protocol.js'
import { LocalOtlpEndpointRegistry } from './local-endpoint.js'
import { OtlpTraceExport, type BatchExporter, type FinishedSpan, type SpanAttributeValue } from './otlp-exporter.js'

const attributeKeySchema = Schema.String.check(Schema.isMaxLength(128), Schema.isPattern(/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/u))
const attributeValueSchema = Schema.Union([
  Schema.String.check(Schema.isMaxLength(BROWSER_TRACES_LIMITS.stringLength)),
  Schema.Number.check(Schema.isFinite()),
  Schema.Boolean,
])
const attributesSchema = (max: number) =>
  Schema.Record(Schema.String, attributeValueSchema).check(
    Schema.makeFilter(
      attributes => Object.keys(attributes).every(key => Schema.is(attributeKeySchema)(key)) || 'Attribute keys do not match the browser telemetry contract.',
    ),
    Schema.makeFilter(attributes => Object.keys(attributes).length <= max),
  )
const timeSchema = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))

const spanSchema = Schema.Struct({
  traceId: Schema.String.check(Schema.isPattern(/^(?!0{32})[0-9a-f]{32}$/u)),
  spanId: Schema.String.check(Schema.isPattern(/^(?!0{16})[0-9a-f]{16}$/u)),
  parentSpanId: Schema.optional(Schema.String.check(Schema.isPattern(/^(?!0{16})[0-9a-f]{16}$/u))),
  name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(BROWSER_TRACES_LIMITS.nameLength)),
  kind: Schema.Literals(['internal', 'client']),
  startTimeMs: timeSchema,
  endTimeMs: timeSchema,
  attributes: attributesSchema(BROWSER_TRACES_LIMITS.attributesPerSpan),
  status: Schema.Struct({
    code: Schema.Literals(['unset', 'ok', 'error']),
    message: Schema.optional(Schema.String.check(Schema.isMaxLength(BROWSER_TRACES_LIMITS.statusMessageLength))),
  }),
  events: Schema.Array(
    Schema.Struct({
      name: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(BROWSER_TRACES_LIMITS.nameLength)),
      timeMs: timeSchema,
      attributes: attributesSchema(BROWSER_TRACES_LIMITS.attributesPerEvent),
    }),
  ).check(Schema.isMaxLength(BROWSER_TRACES_LIMITS.eventsPerSpan)),
})

const resourceSchema = Schema.Struct({ engine: Schema.Literals(['chromium', 'firefox', 'webkit', 'other']), mobile: Schema.Boolean })

const statusSchema = Schema.Struct({
  enabled: Schema.Boolean,
  sampleRatio: Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1)),
  maxRootSpansPerMinute: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
})
const apiSchema = <S extends Schema.ConstraintDecoder<unknown>>(schema: S) => Schema.toStandardSchemaV1(schema)

/**
 * The browser half's way out: the page never talks to an OTLP endpoint (no CORS, no collector credentials in the
 * page). The dshx registry leader serves this API; its dispatch is never traced itself, so forwarding cannot feed back.
 */
const browserTracesApi = ApiDefinitionModel.define({
  id: BROWSER_TRACES_API.id,
  version: BROWSER_TRACES_API.version,
  owner: BROWSER_TRACES_API.owner,
  methods: {
    status: ApiDefinitionModel.method({
      output: apiSchema(statusSchema),
      description: 'Whether browser spans are forwarded now, and the sampling the page applies.',
    }),
    export: ApiDefinitionModel.method({
      input: apiSchema(
        Schema.Struct({ resource: resourceSchema, spans: Schema.Array(spanSchema).check(Schema.isMaxLength(BROWSER_TRACES_LIMITS.spansPerExport)) }),
      ),
      output: apiSchema(
        Schema.Struct({
          accepted: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
          dropped: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
        }),
      ),
      description: 'Forward one batch of bounded, metadata-only browser spans to the Host OTLP traces target.',
    }),
  },
})

const BROWSER_SAMPLING = { sampleRatio: 1, maxRootSpansPerMinute: 60 } as const

const nanos = (milliseconds: number): bigint => BigInt(Math.round(milliseconds * 1_000)) * 1_000n

const attributeMap = (attributes: Readonly<Record<string, string | number | boolean>>): ReadonlyMap<string, SpanAttributeValue> =>
  new Map(Object.entries(attributes))

const finishedSpan = (span: BrowserSpanRecord): FinishedSpan => ({
  traceId: span.traceId,
  spanId: span.spanId,
  parentSpanId: span.parentSpanId,
  name: span.name,
  kind: span.kind,
  startTimeUnixNano: nanos(span.startTimeMs),
  endTimeUnixNano: nanos(span.endTimeMs),
  attributes: attributeMap(span.attributes),
  status: { code: span.status.code, message: span.status.code === 'error' ? span.status.message : undefined },
  events: span.events.map(event => ({ name: event.name, timeUnixNano: nanos(event.timeMs), attributes: attributeMap(event.attributes) })),
})

/** A span the Host will not forward: inverted, implausibly long, or on a clock far from the Host's. */
const plausible = (span: BrowserSpanRecord, nowMs: number): boolean =>
  span.endTimeMs >= span.startTimeMs &&
  span.endTimeMs - span.startTimeMs <= BROWSER_TRACES_LIMITS.spanDurationMs &&
  Math.abs(span.endTimeMs - nowMs) <= BROWSER_TRACES_LIMITS.clockSkewMs &&
  span.events.every(event => event.timeMs >= span.startTimeMs && event.timeMs <= span.endTimeMs)

const resourceAttributes = (resource: BrowserResource): ReadonlyMap<string, SpanAttributeValue> =>
  new Map<string, SpanAttributeValue>([
    ['telemetry.sdk.name', '@dshfiles/dshx'],
    ['telemetry.sdk.language', 'webjs'],
    ['browser.engine', resource.engine],
    ['browser.mobile', resource.mobile],
  ])

export interface BrowserTracesForwarderOptions {
  readonly env?: Readonly<Record<string, string | undefined>>
  readonly fetch?: typeof fetch
  readonly now?: () => number
  readonly scheduleDelayMs?: number
}

export interface BrowserTracesForwarder {
  readonly registration: ApiHostRegistration
  status(): BrowserTracingStatus
  forward(input: { readonly resource: BrowserResource; readonly spans: readonly BrowserSpanRecord[] }): BrowserTracesExportResult
  flush(): Promise<void>
}

/**
 * Browser spans join the Host's OTLP traces target (`otlpExportTarget({ signal: 'traces' })`: an environment endpoint,
 * else the in-process receiver) under `service.name=dshfiles-web`, with environment headers only for an environment
 * endpoint. One bounded exporter per browser resource class; a Host-wide per-minute budget drops the excess.
 */
const createForwarder = (options: BrowserTracesForwarderOptions = {}): BrowserTracesForwarder => {
  const env = options.env ?? process.env
  const now = options.now ?? Date.now
  const exporters = new Map<string, BatchExporter>()
  let windowStart = now()
  let windowCount = 0

  const target = () => {
    const config = OtlpTraceExport.configFrom(env, LocalOtlpEndpointRegistry.current()?.baseUrl)
    return config === undefined ? undefined : { ...config, serviceName: BROWSER_SERVICE_NAME }
  }

  const exporterFor = (resource: BrowserResource): BatchExporter => {
    const key = `${resource.engine}:${String(resource.mobile)}`
    const existing = exporters.get(key)
    if (existing !== undefined) return existing
    const created = OtlpTraceExport.createBatchExporter({
      config: target,
      resource: resourceAttributes(resource),
      fetch: options.fetch,
      scheduleDelayMs: options.scheduleDelayMs,
      maxQueueSize: 1_024,
    })
    exporters.set(key, created)
    return created
  }

  const budget = (wanted: number): number => {
    const current = now()
    if (current - windowStart >= 60_000) {
      windowStart = current
      windowCount = 0
    }
    const granted = Math.max(0, Math.min(wanted, BROWSER_TRACES_LIMITS.hostSpansPerMinute - windowCount))
    windowCount += granted
    return granted
  }

  const status = (): BrowserTracingStatus => ({ enabled: target() !== undefined, ...BROWSER_SAMPLING })

  const forward: BrowserTracesForwarder['forward'] = input => {
    if (target() === undefined) return { accepted: 0, dropped: input.spans.length }
    const current = now()
    const kept = input.spans.filter(span => plausible(span, current))
    const granted = budget(kept.length)
    const exporter = exporterFor(input.resource)
    for (const span of kept.slice(0, granted)) exporter.enqueue(finishedSpan(span))
    return { accepted: granted, dropped: input.spans.length - granted }
  }

  return {
    registration: browserTracesApi.host({
      status: async () => status(),
      export: async ({ input }) => forward(input),
    }),
    status,
    forward,
    flush: async () => {
      await Promise.all([...exporters.values()].map(exporter => exporter.flush()))
    },
  }
}

export class BrowserTracesIngest {
  static readonly api = browserTracesApi
  static readonly createForwarder = createForwarder
}
