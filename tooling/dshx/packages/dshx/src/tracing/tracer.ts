import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import { LocalOtlpEndpointRegistry } from './local-endpoint.js'
import { SpanRecorders } from './recorder.js'
import { TraceparentModel, type SpanContext } from './traceparent.js'
import {
  OtlpTraceExport,
  type BatchExporter,
  type ExportConfig,
  type FinishedSpan,
  type SpanAttributeValue,
  type SpanKind,
  type SpanStatus,
  type SpanStatusCode,
} from './otlp-exporter.js'

export type SpanAttributes = Readonly<Record<string, SpanAttributeValue | undefined>>

export type { SpanContext }

export interface Span {
  /** False for the no-op span handed out while export is off; skip expensive attribute work on it. */
  readonly recording: boolean
  readonly context: SpanContext | undefined
  setAttribute(key: string, value: SpanAttributeValue | undefined): void
  setAttributes(attributes: SpanAttributes): void
  setStatus(code: SpanStatusCode, message?: string): void
  /** Marks the span failed with the error's class (and string `code`, when it has one); never its message. */
  recordFailure(error: unknown): void
  end(): void
}

export interface StartSpanOptions {
  readonly kind?: SpanKind
  readonly attributes?: SpanAttributes
  /** Explicit parent; `null` starts a new trace. Defaults to the dshx span active in the current async context. */
  readonly parent?: SpanContext | null
}

export interface Tracer {
  readonly enabled: boolean
  startSpan(name: string, options?: StartSpanOptions): Span
  withSpan<T>(name: string, options: StartSpanOptions, run: (span: Span) => Promise<T>): Promise<T>
  activeContext(): SpanContext | undefined
  /** The W3C `traceparent` header for the active span, to continue the trace in another process. */
  traceparent(): string | undefined
  /**
   * Run `run` with `parent` (a remote span from an incoming `traceparent`, or a span this process started and owns) as
   * the parent of the spans it opens, synchronously or not; `undefined` runs it in the current context.
   */
  runWithParent<T>(parent: SpanContext | undefined, run: () => T): T
  flush(): Promise<void>
}

const MAX_NAME = 128
const MAX_ATTRIBUTES = 64
const MAX_STRING = 1_024
const MAX_LIST = 64
const MAX_STATUS_MESSAGE = 256
const MAX_ERROR_TYPE = 128

const NOOP_SPAN: Span = Object.freeze({
  recording: false,
  context: undefined,
  setAttribute: () => undefined,
  setAttributes: () => undefined,
  setStatus: () => undefined,
  recordFailure: () => undefined,
  end: () => undefined,
})

const bounded = (value: SpanAttributeValue): SpanAttributeValue => {
  if (typeof value === 'string') return value.slice(0, MAX_STRING)
  if (typeof value !== 'object') return value
  return value.slice(0, MAX_LIST).map(item => (typeof item === 'string' ? item.slice(0, MAX_STRING) : item))
}

const errorCodeSchema = z.object({ code: z.string() })

const errorType = (error: unknown): string => {
  const code = errorCodeSchema.safeParse(error).data?.code
  const name = error instanceof Error ? error.name : 'NonError'
  return (code === undefined ? name : `${name}:${code}`).slice(0, MAX_ERROR_TYPE)
}

const nowUnixNano = (): bigint => BigInt(Math.round((performance.timeOrigin + performance.now()) * 1_000)) * 1_000n

const nonZeroHex = (bytes: number): string => {
  for (;;) {
    const id = randomBytes(bytes).toString('hex')
    if (/[^0]/u.test(id)) return id
  }
}

class RecordingSpan implements Span {
  readonly recording = true
  readonly context: SpanContext
  readonly #name: string
  readonly #kind: SpanKind
  readonly #parentSpanId: string | undefined
  readonly #start = nowUnixNano()
  readonly #attributes = new Map<string, SpanAttributeValue>()
  readonly #onEnd: (span: FinishedSpan) => void
  #status: SpanStatus = { code: 'unset', message: undefined }
  #ended = false

  constructor(input: {
    readonly name: string
    readonly kind: SpanKind
    readonly parent: SpanContext | undefined
    readonly onEnd: (span: FinishedSpan) => void
  }) {
    this.#name = input.name.slice(0, MAX_NAME)
    this.#kind = input.kind
    this.#parentSpanId = input.parent?.spanId
    this.context = { traceId: input.parent?.traceId ?? nonZeroHex(16), spanId: nonZeroHex(8) }
    this.#onEnd = input.onEnd
  }

  setAttribute(key: string, value: SpanAttributeValue | undefined): void {
    if (this.#ended || value === undefined) return
    if (!this.#attributes.has(key) && this.#attributes.size >= MAX_ATTRIBUTES) return
    this.#attributes.set(key, bounded(value))
  }

  setAttributes(attributes: SpanAttributes): void {
    for (const [key, value] of Object.entries(attributes)) this.setAttribute(key, value)
  }

  setStatus(code: SpanStatusCode, message?: string): void {
    if (this.#ended || this.#status.code === 'ok') return
    this.#status = { code, message: code === 'error' ? message?.slice(0, MAX_STATUS_MESSAGE) : undefined }
  }

  recordFailure(error: unknown): void {
    const type = errorType(error)
    this.setAttribute('error.type', type)
    this.setStatus('error', type)
  }

  end(): void {
    if (this.#ended) return
    this.#ended = true
    try {
      this.#onEnd({
        traceId: this.context.traceId,
        spanId: this.context.spanId,
        parentSpanId: this.#parentSpanId,
        name: this.#name,
        kind: this.#kind,
        startTimeUnixNano: this.#start,
        endTimeUnixNano: nowUnixNano(),
        attributes: this.#attributes,
        status: this.#status,
      })
    } catch {
      return
    }
  }
}

/**
 * `exportEnabled` gates every new span, so a tracer waiting for an in-process receiver costs nothing until it appears.
 * An active `recordSpans()` recorder also turns spans on, and receives each ended span; only spans with an export
 * target are queued for export.
 */
const createRecordingTracer = (exporter: BatchExporter | undefined, exportEnabled: () => boolean): Tracer => {
  const storage = new AsyncLocalStorage<SpanContext>()
  const isEnabled = (): boolean => exportEnabled() || SpanRecorders.active()
  const onEnd = (finished: FinishedSpan): void => {
    if (exporter !== undefined && exportEnabled()) exporter.enqueue(finished)
    SpanRecorders.deliver(finished)
  }
  const startSpan = (name: string, options: StartSpanOptions = {}): Span => {
    if (!isEnabled()) return NOOP_SPAN
    try {
      const span = new RecordingSpan({
        name,
        kind: options.kind ?? 'internal',
        parent: options.parent === null ? undefined : (options.parent ?? storage.getStore()),
        onEnd,
      })
      if (options.attributes !== undefined) span.setAttributes(options.attributes)
      return span
    } catch {
      return NOOP_SPAN
    }
  }
  return {
    get enabled() {
      return isEnabled()
    },
    startSpan,
    withSpan: async (name, options, run) => {
      const span = startSpan(name, options)
      try {
        return span.context === undefined ? await run(span) : await storage.run(span.context, () => run(span))
      } catch (error) {
        span.recordFailure(error)
        throw error
      } finally {
        span.end()
      }
    },
    activeContext: () => storage.getStore(),
    traceparent: () => {
      const active = storage.getStore()
      return active === undefined ? undefined : TraceparentModel.format(active)
    },
    runWithParent: (parent, run) => (parent === undefined ? run() : storage.run(parent, run)),
    flush: async () => exporter?.flush(),
  }
}

/**
 * A tracer configured from OTLP environment variables. An environment endpoint always wins and is read once. Without
 * one, `localEndpoint` (this process's own receiver) is consulted on every span and every export, so a receiver that
 * binds after the first span still gets everything from then on; with neither, every span is a shared no-op.
 */
const createTracer = (input: {
  readonly env: Readonly<Record<string, string | undefined>>
  readonly localEndpoint?: (() => string | undefined) | undefined
  readonly fetch?: typeof fetch | undefined
  readonly scheduleDelayMs?: number | undefined
}): Tracer => {
  const disabled = (): Tracer => createRecordingTracer(undefined, () => false)
  if (OtlpTraceExport.sdkDisabled(input.env)) return disabled()
  const exporterOf = (config: () => ExportConfig | undefined) =>
    OtlpTraceExport.createBatchExporter({ config, fetch: input.fetch, scheduleDelayMs: input.scheduleDelayMs })
  if (OtlpTraceExport.environmentEndpointSet(input.env)) {
    const config = OtlpTraceExport.configFrom(input.env)
    if (config === undefined) return disabled()
    return createRecordingTracer(
      exporterOf(() => config),
      () => true,
    )
  }
  const localEndpoint = input.localEndpoint
  if (localEndpoint === undefined) return disabled()
  return createRecordingTracer(
    exporterOf(() => OtlpTraceExport.configFrom(input.env, localEndpoint())),
    () => localEndpoint() !== undefined,
  )
}

/**
 * Every plugin bundles its own copy of dshx, so the process tracer lives on globalThis under a versioned symbol:
 * all copies share one exporter queue and one async context, and a span opened in one plugin parents the spans
 * another plugin opens while serving that call. v2: the tracer can start recording after creation (local receiver).
 */
const TRACER_KEY = Symbol.for('@dshfiles/dshx.tracing.v2')

const processTracer = (): Tracer => {
  // SAFETY: only this module writes the versioned symbol, and always a Tracer.
  const holder = globalThis as { [TRACER_KEY]?: Tracer }
  if (holder[TRACER_KEY] !== undefined) return holder[TRACER_KEY]
  const tracer = createTracer({ env: process.env, localEndpoint: () => LocalOtlpEndpointRegistry.current()?.baseUrl })
  holder[TRACER_KEY] = tracer
  process.once('beforeExit', () => void tracer.flush())
  return tracer
}

export class TracerModel {
  static readonly create = createTracer
  static readonly process = processTracer
  static readonly parseTraceparent = (header: string | null | undefined): SpanContext | undefined => TraceparentModel.parse(header)
  static readonly noopSpan = NOOP_SPAN
}
