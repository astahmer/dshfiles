import { AsyncLocalStorage } from 'node:async_hooks'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { randomBytes } from 'node:crypto'
import { LocalOtlpEndpointRegistry } from './local-endpoint.js'
import { SpanRecorders } from './recorder.js'
import { TraceparentModel, type SpanContext } from './traceparent.js'
import {
  OtlpTraceExport,
  type BatchExporter,
  type ExportConfig,
  type FinishedSpan,
  type FinishedSpanEvent,
  type FinishedSpanLink,
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
  runWithParent<T, Args extends unknown[] = []>(parent: SpanContext | undefined, run: (...args: Args) => T, ...args: Args): T
  /** Start a span whose clock and lifetime another tracer drives (the Effect bridge); `parent` is already resolved. */
  createRecordingSpan<S extends RecordingSpan>(create: (onEnd: (span: FinishedSpan) => void) => S): S
  flush(): Promise<void>
}

const MAX_NAME = 128
const MAX_ATTRIBUTES = 64
const MAX_STRING = 1_024
const MAX_LIST = 64
const MAX_STATUS_MESSAGE = 256
const MAX_ERROR_TYPE = 128
const MAX_EVENTS = 128
const MAX_EVENT_ATTRIBUTES = 32
const MAX_LINKS = 32

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

const errorCodeSchema = Schema.Struct({ code: Schema.String })

const errorType = (error: unknown): string => {
  const code = Option.getOrUndefined(Schema.decodeUnknownOption(errorCodeSchema)(error))?.code
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

const boundedAttributes = (attributes: SpanAttributes | undefined): ReadonlyMap<string, SpanAttributeValue> => {
  const result = new Map<string, SpanAttributeValue>()
  if (attributes === undefined) return result
  for (const key in attributes) {
    const value = attributes[key]
    if (value === undefined) continue
    if (result.size >= MAX_EVENT_ATTRIBUTES) break
    result.set(key, bounded(value))
  }
  return result
}

export interface RecordingSpanInput {
  readonly name: string
  readonly kind: SpanKind
  readonly parent: SpanContext | undefined
  /** Unix epoch nanoseconds; now when omitted or `0n` (a tracer that does not time its spans). */
  readonly startTimeUnixNano?: bigint | undefined
  readonly onEnd: (span: FinishedSpan) => void
}

/**
 * A span that records and exports. Its `traceId`/`spanId` are the exported ids and it is its own `context`, so the
 * async context can hold the span itself and an identity check tells whether it is already the active parent.
 */
export class RecordingSpan implements Span, SpanContext {
  readonly recording = true
  readonly name: string
  readonly kind: SpanKind
  readonly traceId: string
  readonly spanId: string
  readonly #parentSpanId: string | undefined
  readonly #start: bigint
  readonly #attributes = new Map<string, SpanAttributeValue>()
  readonly #onEnd: (span: FinishedSpan) => void
  #events: FinishedSpanEvent[] | undefined
  #links: FinishedSpanLink[] | undefined
  #status: SpanStatus = { code: 'unset', message: undefined }
  #ended = false

  constructor(input: RecordingSpanInput) {
    this.name = input.name.slice(0, MAX_NAME)
    this.kind = input.kind
    this.#parentSpanId = input.parent?.spanId
    this.traceId = input.parent?.traceId ?? nonZeroHex(16)
    this.spanId = nonZeroHex(8)
    this.#start = input.startTimeUnixNano === undefined || input.startTimeUnixNano === 0n ? nowUnixNano() : input.startTimeUnixNano
    this.#onEnd = input.onEnd
  }

  get context(): SpanContext {
    return this
  }

  get attributes(): ReadonlyMap<string, SpanAttributeValue> {
    return this.#attributes
  }

  get ended(): boolean {
    return this.#ended
  }

  setAttribute(key: string, value: SpanAttributeValue | undefined): void {
    if (this.#ended || value === undefined) return
    if (!this.#attributes.has(key) && this.#attributes.size >= MAX_ATTRIBUTES) return
    this.#attributes.set(key, bounded(value))
  }

  addEvent(input: { readonly name: string; readonly timeUnixNano?: bigint | undefined; readonly attributes?: SpanAttributes | undefined }): void {
    if (this.#ended) return
    this.#events ??= []
    if (this.#events.length >= MAX_EVENTS) return
    this.#events.push({
      name: input.name.slice(0, MAX_NAME),
      timeUnixNano: input.timeUnixNano === undefined || input.timeUnixNano === 0n ? nowUnixNano() : input.timeUnixNano,
      attributes: boundedAttributes(input.attributes),
    })
  }

  addLink(input: { readonly context: SpanContext; readonly attributes?: SpanAttributes | undefined }): void {
    if (this.#ended) return
    this.#links ??= []
    if (this.#links.length >= MAX_LINKS) return
    this.#links.push({ traceId: input.context.traceId, spanId: input.context.spanId, attributes: boundedAttributes(input.attributes) })
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
    this.endAt(nowUnixNano())
  }

  /** End with the end time another clock measured; `0n` means now. */
  endAt(endTimeUnixNano: bigint): void {
    if (this.#ended) return
    this.#ended = true
    try {
      this.#onEnd({
        traceId: this.traceId,
        spanId: this.spanId,
        parentSpanId: this.#parentSpanId,
        name: this.name,
        kind: this.kind,
        startTimeUnixNano: this.#start,
        endTimeUnixNano: endTimeUnixNano === 0n ? nowUnixNano() : endTimeUnixNano,
        attributes: this.#attributes,
        status: this.#status,
        events: this.#events,
        links: this.#links,
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
  const activeContext = (): SpanContext | undefined => storage.getStore()
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
    activeContext,
    traceparent: () => {
      const active = storage.getStore()
      return active === undefined ? undefined : TraceparentModel.format(active)
    },
    runWithParent: (parent, run, ...args) => (parent === undefined || storage.getStore() === parent ? run(...args) : storage.run(parent, run, ...args)),
    createRecordingSpan: create => create(onEnd),
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
 * v3: `createRecordingSpan` lets the Effect bridge record spans whose ids Effect itself sees.
 */
const TRACER_KEY = Symbol.for('@dshfiles/dshx.tracing.v3')

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
