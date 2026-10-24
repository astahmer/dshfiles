/**
 * OTLP/HTTP JSON trace export, written against the OTLP 1.x specification
 * (https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding): trace and span ids are lowercase hex,
 * 64-bit integers (timestamps, intValue) are decimal strings, and enums (span kind, status code) are integers.
 */

export type SpanKind = 'internal' | 'server' | 'client' | 'producer' | 'consumer'
export type SpanStatusCode = 'unset' | 'ok' | 'error'
export type SpanAttributeScalar = string | number | boolean
export type SpanAttributeValue = SpanAttributeScalar | readonly SpanAttributeScalar[]

/** One ended span, ready to encode. Times are Unix epoch nanoseconds. */
export interface FinishedSpan {
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId: string | undefined
  readonly name: string
  readonly kind: SpanKind
  readonly startTimeUnixNano: bigint
  readonly endTimeUnixNano: bigint
  readonly attributes: ReadonlyMap<string, SpanAttributeValue>
  readonly status: SpanStatus
  readonly events?: readonly FinishedSpanEvent[]
}

/** A timestamped point inside a span (a long task during a browser interaction). */
export interface FinishedSpanEvent {
  readonly name: string
  readonly timeUnixNano: bigint
  readonly attributes: ReadonlyMap<string, SpanAttributeValue>
}

export interface SpanStatus {
  readonly code: SpanStatusCode
  readonly message: string | undefined
}

export interface ExportConfig {
  readonly url: string
  readonly headers: ReadonlyMap<string, string>
  readonly serviceName: string
}

type OtlpAnyValue =
  | { readonly stringValue: string }
  | { readonly boolValue: boolean }
  | { readonly intValue: string }
  | { readonly doubleValue: number }
  | { readonly arrayValue: { readonly values: readonly OtlpAnyValue[] } }

interface OtlpKeyValue {
  readonly key: string
  readonly value: OtlpAnyValue
}

interface OtlpStatus {
  readonly code: number
  message?: string
}

interface OtlpSpan {
  readonly traceId: string
  readonly spanId: string
  parentSpanId?: string
  readonly name: string
  readonly kind: number
  readonly startTimeUnixNano: string
  readonly endTimeUnixNano: string
  readonly attributes: readonly OtlpKeyValue[]
  readonly status: OtlpStatus
  events?: readonly OtlpEvent[]
}

interface OtlpEvent {
  readonly name: string
  readonly timeUnixNano: string
  readonly attributes: readonly OtlpKeyValue[]
}

const SPAN_KIND_CODES = { internal: 1, server: 2, client: 3, producer: 4, consumer: 5 } as const satisfies Record<SpanKind, number>
const STATUS_CODES = { unset: 0, ok: 1, error: 2 } as const satisfies Record<SpanStatusCode, number>

const scalarValue = (value: SpanAttributeScalar): OtlpAnyValue | undefined => {
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { boolValue: value }
  if (!Number.isFinite(value)) return undefined
  return Number.isSafeInteger(value) ? { intValue: String(value) } : { doubleValue: value }
}

const anyValue = (value: SpanAttributeValue): OtlpAnyValue | undefined => {
  if (typeof value !== 'object') return scalarValue(value)
  const values = value.flatMap(item => {
    const encoded = scalarValue(item)
    return encoded === undefined ? [] : [encoded]
  })
  return { arrayValue: { values } }
}

const keyValues = (attributes: ReadonlyMap<string, SpanAttributeValue>): OtlpKeyValue[] =>
  [...attributes].flatMap(([key, value]) => {
    const encoded = anyValue(value)
    return encoded === undefined ? [] : [{ key, value: encoded }]
  })

/** A root span and an unset status message are omitted, not sent empty. */
const encodeSpan = (span: FinishedSpan): OtlpSpan => {
  const status: OtlpStatus = { code: STATUS_CODES[span.status.code] }
  if (span.status.message !== undefined) status.message = span.status.message
  const encoded: OtlpSpan = {
    traceId: span.traceId,
    spanId: span.spanId,
    name: span.name,
    kind: SPAN_KIND_CODES[span.kind],
    startTimeUnixNano: span.startTimeUnixNano.toString(),
    endTimeUnixNano: span.endTimeUnixNano.toString(),
    attributes: keyValues(span.attributes),
    status,
  }
  if (span.parentSpanId !== undefined) encoded.parentSpanId = span.parentSpanId
  if (span.events !== undefined && span.events.length > 0) {
    encoded.events = span.events.map(event => ({
      name: event.name,
      timeUnixNano: event.timeUnixNano.toString(),
      attributes: keyValues(event.attributes),
    }))
  }
  return encoded
}

const SCOPE = { name: '@dshfiles/dshx', version: '1' } as const

const hostResource = (): ReadonlyMap<string, SpanAttributeValue> =>
  new Map<string, SpanAttributeValue>([
    ['telemetry.sdk.name', SCOPE.name],
    ['telemetry.sdk.language', 'nodejs'],
    ['process.pid', process.pid],
  ])

/**
 * The `ExportTraceServiceRequest` body for one batch. `resource` replaces the Host process resource (pid, nodejs) for
 * spans another runtime produced, such as the browser spans the Host forwards; `service.name` always comes first.
 */
const encodeTraceRequest = (input: {
  readonly serviceName: string
  readonly spans: readonly FinishedSpan[]
  readonly resource?: ReadonlyMap<string, SpanAttributeValue> | undefined
}) => ({
  resourceSpans: [
    {
      resource: {
        attributes: keyValues(new Map<string, SpanAttributeValue>([['service.name', input.serviceName], ...(input.resource ?? hostResource())])),
      },
      scopeSpans: [{ scope: SCOPE, spans: input.spans.map(encodeSpan) }],
    },
  ],
})

type Environment = Readonly<Record<string, string | undefined>>

const parseHeaders = (raw: string | undefined) => {
  const headers = new Map<string, string>()
  for (const pair of (raw ?? '').split(',')) {
    const separator = pair.indexOf('=')
    if (separator <= 0) continue
    try {
      const key = decodeURIComponent(pair.slice(0, separator).trim()).toLowerCase()
      const value = decodeURIComponent(pair.slice(separator + 1).trim())
      if (key !== '' && key !== 'content-type') headers.set(key, value)
    } catch {
      continue
    }
  }
  return headers
}

const httpUrl = (raw: string): string | undefined => {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined
  } catch {
    return undefined
  }
}

const sdkDisabled = (env: Environment): boolean =>
  env.OTEL_SDK_DISABLED?.trim().toLowerCase() === 'true' || env.OTEL_TRACES_EXPORTER?.trim().toLowerCase() === 'none'

const serviceNameOf = (env: Environment): string => env.OTEL_SERVICE_NAME?.trim() || 'dshfiles'

/**
 * The standard OTLP environment variables configure export: the signal-specific endpoint is used as given; the general
 * one gets `/v1/traces` appended, as the specification requires. Without either, `localBaseUrl` (this process's own
 * receiver, see `LocalOtlpEndpointRegistry`) is the target, without the environment's headers, which belong to a
 * configured collector. No endpoint at all, or `OTEL_SDK_DISABLED=true`, means no export.
 */
const exportConfigFrom = (env: Environment, localBaseUrl?: string): ExportConfig | undefined => {
  if (sdkDisabled(env)) return undefined
  const tracesEndpoint = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim()
  const baseEndpoint = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim()
  const raw =
    tracesEndpoint !== undefined && tracesEndpoint !== ''
      ? tracesEndpoint
      : baseEndpoint !== undefined && baseEndpoint !== ''
        ? `${baseEndpoint.replace(/\/+$/u, '')}/v1/traces`
        : undefined
  if (raw === undefined) {
    const localUrl = localBaseUrl === undefined ? undefined : httpUrl(`${localBaseUrl.replace(/\/+$/u, '')}/v1/traces`)
    return localUrl === undefined ? undefined : { url: localUrl, headers: new Map(), serviceName: serviceNameOf(env) }
  }
  const url = httpUrl(raw)
  if (url === undefined) return undefined
  return {
    url,
    headers: new Map([...parseHeaders(env.OTEL_EXPORTER_OTLP_HEADERS), ...parseHeaders(env.OTEL_EXPORTER_OTLP_TRACES_HEADERS)]),
    serviceName: serviceNameOf(env),
  }
}

/** True when the environment names a traces endpoint, valid or not: it then owns export and the local receiver is ignored. */
const environmentEndpointSet = (env: Environment): boolean =>
  [env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, env.OTEL_EXPORTER_OTLP_ENDPOINT].some(value => value !== undefined && value.trim() !== '')

export interface BatchExporterOptions {
  /** Read before every request, so the target can appear, move or vanish; `undefined` drops the batch. */
  readonly config: () => ExportConfig | undefined
  /** Resource attributes besides `service.name`; the Host process resource by default. */
  readonly resource?: ReadonlyMap<string, SpanAttributeValue> | undefined
  readonly fetch?: typeof fetch | undefined
  readonly maxQueueSize?: number
  readonly maxBatchSize?: number
  readonly scheduleDelayMs?: number | undefined
  readonly exportTimeoutMs?: number
  readonly initialBackoffMs?: number
  readonly maxBackoffMs?: number
  readonly maxAttempts?: number
}

export interface BatchExporterStats {
  readonly queued: number
  readonly dropped: number
  readonly exported: number
}

export interface BatchExporter {
  enqueue(span: FinishedSpan): void
  /** Send everything queued now, once per batch and without backoff; never rejects. */
  flush(): Promise<void>
  stats(): BatchExporterStats
}

/** HTTP statuses the OTLP specification lists as retryable. */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504])

type SendOutcome = 'sent' | 'retry' | 'drop'

/**
 * Bounded batching exporter: a full queue drops the new span, a retryable failure re-queues its batch behind an
 * exponential, jittered backoff, and nothing it does ever throws into the code that ended the span.
 */
const createBatchExporter = (options: BatchExporterOptions): BatchExporter => {
  const maxQueueSize = options.maxQueueSize ?? 2048
  const maxBatchSize = options.maxBatchSize ?? 512
  const scheduleDelayMs = options.scheduleDelayMs ?? 5_000
  const exportTimeoutMs = options.exportTimeoutMs ?? 10_000
  const initialBackoffMs = options.initialBackoffMs ?? 1_000
  const maxBackoffMs = options.maxBackoffMs ?? 60_000
  const maxAttempts = options.maxAttempts ?? 5
  const send = options.fetch ?? globalThis.fetch
  const queue: FinishedSpan[] = []
  let dropped = 0
  let exported = 0
  let attempt = 0
  let backoffUntil = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> | undefined

  const post = async (batch: readonly FinishedSpan[]): Promise<SendOutcome> => {
    try {
      const config = options.config()
      if (config === undefined) return 'drop'
      const headers = new Headers([...config.headers])
      headers.set('content-type', 'application/json')
      const response = await send(config.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(encodeTraceRequest({ serviceName: config.serviceName, spans: batch, resource: options.resource })),
        signal: AbortSignal.timeout(exportTimeoutMs),
      })
      await response.body?.cancel().catch(() => undefined)
      if (response.ok) return 'sent'
      return RETRYABLE_STATUSES.has(response.status) ? 'retry' : 'drop'
    } catch {
      return 'retry'
    }
  }

  const schedule = (delayMs: number): void => {
    if (timer !== undefined || inFlight !== undefined || queue.length === 0) return
    timer = setTimeout(
      () => {
        timer = undefined
        void drain()
      },
      Math.max(delayMs, backoffUntil - Date.now()),
    )
    timer.unref?.()
  }

  const exportBatch = async (): Promise<void> => {
    const batch = queue.splice(0, maxBatchSize)
    const outcome = await post(batch)
    if (outcome === 'sent') {
      exported += batch.length
      attempt = 0
      return
    }
    if (outcome === 'drop' || attempt + 1 >= maxAttempts) {
      dropped += batch.length
      attempt = 0
      return
    }
    attempt += 1
    const room = Math.max(0, maxQueueSize - queue.length)
    dropped += batch.length - Math.min(room, batch.length)
    queue.unshift(...batch.slice(0, room))
    const delay = Math.min(maxBackoffMs, initialBackoffMs * 2 ** (attempt - 1))
    backoffUntil = Date.now() + delay / 2 + Math.random() * (delay / 2)
  }

  const drain = (): Promise<void> => {
    if (inFlight !== undefined) return inFlight
    inFlight = exportBatch()
      .catch(() => undefined)
      .finally(() => {
        inFlight = undefined
        schedule(queue.length >= maxBatchSize ? 0 : scheduleDelayMs)
      })
    return inFlight
  }

  return {
    enqueue: span => {
      if (queue.length >= maxQueueSize) {
        dropped += 1
        return
      }
      queue.push(span)
      if (queue.length >= maxBatchSize && Date.now() >= backoffUntil) {
        if (timer !== undefined) clearTimeout(timer)
        timer = undefined
        void drain()
        return
      }
      schedule(scheduleDelayMs)
    },
    flush: async () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      try {
        await inFlight
        while (queue.length > 0) {
          const batch = queue.splice(0, maxBatchSize)
          if ((await post(batch)) === 'sent') exported += batch.length
          else dropped += batch.length
        }
      } catch {
        return
      }
    },
    stats: () => ({ queued: queue.length, dropped, exported }),
  }
}

export class OtlpTraceExport {
  static readonly configFrom = exportConfigFrom
  static readonly sdkDisabled = sdkDisabled
  static readonly environmentEndpointSet = environmentEndpointSet
  static readonly encode = encodeTraceRequest
  static readonly createBatchExporter = createBatchExporter
}
