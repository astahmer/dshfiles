import {
  BROWSER_TRACES_LIMITS,
  type BrowserAttributeValue,
  type BrowserEngine,
  type BrowserResource,
  type BrowserSpanEventRecord,
  type BrowserSpanKind,
  type BrowserSpanRecord,
  type BrowserStatusCode,
  type BrowserTracingStatus,
} from './browser-protocol.js'
import { BrowserTracingRegistryModel, type BrowserTraceTransport } from './browser-registry.js'
import { TraceparentModel, type SpanContext } from './traceparent.js'

export type BrowserSpanAttributes = Readonly<Record<string, BrowserAttributeValue | undefined>>

export interface BrowserSpan {
  /** False for the shared no-op span (export off, unsampled, rate-limited); skip attribute work on it. */
  readonly recording: boolean
  readonly context: SpanContext | undefined
  setAttribute(key: string, value: BrowserAttributeValue | undefined): void
  setAttributes(attributes: BrowserSpanAttributes): void
  addEvent(name: string, attributes?: BrowserSpanAttributes): void
  setStatus(code: BrowserStatusCode, message?: string): void
  /** Marks the span failed with the error's class (and string `code`); never its message. */
  recordFailure(error: unknown): void
  end(): void
}

/**
 * A user interaction measured from its trigger to the paint it caused. While open it is the ambient parent of every
 * span and dshx API call the page starts, across awaits and plugins, so the Host work it triggers joins its trace.
 */
export interface Interaction extends BrowserSpan {
  readonly name: string
  /** End after the browser painted the next frame: one animation frame, then one task. */
  endAfterPaint(attributes?: BrowserSpanAttributes): void
}

export interface BrowserStartSpanOptions {
  readonly kind?: BrowserSpanKind
  readonly attributes?: BrowserSpanAttributes
  /** Explicit parent; `null` starts a new trace. Defaults to the active span, else the open interaction. */
  readonly parent?: SpanContext | null
}

export interface StartInteractionOptions {
  readonly attributes?: BrowserSpanAttributes
  /** An interaction nobody ends is closed with outcome `timeout` after this long; default 10 s. */
  readonly timeoutMs?: number
}

export interface BrowserSpanRecorder {
  readonly spans: readonly BrowserSpanRecord[]
  span(name: string): BrowserSpanRecord
  named(name: string): readonly BrowserSpanRecord[]
  children(parent: BrowserSpanRecord): readonly BrowserSpanRecord[]
  stop(): void
  [Symbol.dispose](): void
}

export interface BrowserTracer {
  readonly enabled: boolean
  startSpan(name: string, options?: BrowserStartSpanOptions): BrowserSpan
  withSpan<T>(name: string, options: BrowserStartSpanOptions, run: (span: BrowserSpan) => T | Promise<T>): Promise<T>
  startInteraction(name: string, options?: StartInteractionOptions): Interaction
  interaction(name: string): Interaction | undefined
  activeContext(): SpanContext | undefined
  traceparent(): string | undefined
  attachTransport(transport: BrowserTraceTransport): () => void
  record(): BrowserSpanRecorder
  flush(): Promise<void>
}

export interface BrowserTracerOptions {
  /** Where attached transports live; the page tracer shares the registry's, so Clients attach before it exists. */
  readonly transports?: BrowserTraceTransport[]
  readonly now?: () => number
  readonly random?: () => number
  readonly scheduleDelayMs?: number
  readonly statusTtlMs?: number
  readonly maxQueueSize?: number
  readonly longTaskThresholdMs?: number
}

const DEFAULT_STATUS: BrowserTracingStatus = { enabled: false, sampleRatio: 0, maxRootSpansPerMinute: 0 }
const UNSAMPLED = Symbol('unsampled')
const MINUTE_MS = 60_000

const NOOP_SPAN: BrowserSpan = Object.freeze({
  recording: false,
  context: undefined,
  setAttribute: () => undefined,
  setAttributes: () => undefined,
  addEvent: () => undefined,
  setStatus: () => undefined,
  recordFailure: () => undefined,
  end: () => undefined,
})

const noopInteraction = (name: string): Interaction => Object.freeze({ ...NOOP_SPAN, name, endAfterPaint: () => undefined })

/**
 * The Host answer decoded by hand: this runs in every Client bundle, which carries no schema library. Anything
 * unexpected reads as disabled.
 */
const decodeStatus = (value: unknown): BrowserTracingStatus => {
  if (typeof value !== 'object' || value === null) return DEFAULT_STATUS
  const enabled = 'enabled' in value && value.enabled === true
  const ratio = 'sampleRatio' in value && typeof value.sampleRatio === 'number' ? value.sampleRatio : 0
  const roots = 'maxRootSpansPerMinute' in value && typeof value.maxRootSpansPerMinute === 'number' ? value.maxRootSpansPerMinute : 0
  return { enabled, sampleRatio: Math.min(1, Math.max(0, ratio)), maxRootSpansPerMinute: Math.max(0, Math.floor(roots)) }
}

const hexId = (bytes: number): string => {
  for (;;) {
    const values = globalThis.crypto.getRandomValues(new Uint8Array(bytes))
    const id = Array.from(values, byte => byte.toString(16).padStart(2, '0')).join('')
    if (/[^0]/u.test(id)) return id
  }
}

const boundedValue = (value: BrowserAttributeValue): BrowserAttributeValue | undefined => {
  if (typeof value === 'string') return value.slice(0, BROWSER_TRACES_LIMITS.stringLength)
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  return value
}

const errorType = (error: unknown): string => {
  const name = error instanceof Error ? error.name : 'NonError'
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined
  return (code === undefined ? name : `${name}:${code}`).slice(0, BROWSER_TRACES_LIMITS.statusMessageLength)
}

/** First match wins: Chromium user agents also name AppleWebKit, so it is tested before WebKit. */
const ENGINE_PATTERNS: ReadonlyArray<readonly [BrowserEngine, RegExp]> = [
  ['firefox', /Firefox\//u],
  ['chromium', /Chrome\/|Chromium\/|Edg\//u],
  ['webkit', /AppleWebKit\//u],
]

/** Engine class and a mobile flag from a coarse user-agent match; the user agent string itself never leaves. */
const browserResource = (): BrowserResource => {
  const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent
  const engine = ENGINE_PATTERNS.find(([, pattern]) => pattern.test(userAgent))?.[0] ?? 'other'
  return { engine, mobile: /Mobi|Android|iPhone|iPad/u.test(userAgent) }
}

/** After the browser painted the frame the current render produced; a test runtime without frames uses a task. */
const afterNextPaint = (run: () => void): void => {
  const nextTask = (): void => void setTimeout(run, 0)
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(nextTask)
  else setTimeout(nextTask, 16)
}

interface LongTaskEntry {
  readonly startTime: number
  readonly duration: number
}

const createBrowserTracer = (options: BrowserTracerOptions = {}): BrowserTracer => {
  const now = options.now ?? (() => performance.timeOrigin + performance.now())
  const random = options.random ?? Math.random
  const scheduleDelayMs = options.scheduleDelayMs ?? 5_000
  const statusTtlMs = options.statusTtlMs ?? 5 * MINUTE_MS
  const maxQueueSize = options.maxQueueSize ?? 512
  const longTaskThresholdMs = options.longTaskThresholdMs ?? 200

  const transports = options.transports ?? []
  const recorders = new Set<(record: BrowserSpanRecord) => void>()
  const stack: Array<SpanContext | typeof UNSAMPLED> = []
  const open = new Map<string, InteractionSpan>()
  const queue: BrowserSpanRecord[] = []
  const rootStarts: number[] = []
  let status: BrowserTracingStatus | undefined
  let statusReadAt = Number.NEGATIVE_INFINITY
  let statusSource: BrowserTraceTransport | undefined
  let statusLoad: Promise<void> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let observer: PerformanceObserver | undefined
  let pageListeners = false

  const transport = (): BrowserTraceTransport | undefined => transports.at(-1)

  const refreshStatus = (): Promise<void> => {
    const current = transport()
    if (current === undefined) return Promise.resolve()
    if (statusLoad !== undefined) return statusLoad
    if (current === statusSource && now() - statusReadAt < statusTtlMs) return Promise.resolve()
    statusLoad = current
      .status()
      .then(decodeStatus, () => DEFAULT_STATUS)
      .then(next => {
        status = next
        statusSource = current
        statusReadAt = now()
        if (!next.enabled) queue.length = 0
      })
      .finally(() => {
        statusLoad = undefined
      })
    return statusLoad
  }

  /** Before the first status answer spans are kept and dropped at flush if the Host says off; the first click counts. */
  const exporting = (): boolean => transport() !== undefined && status?.enabled !== false
  const isEnabled = (): boolean => exporting() || recorders.size > 0

  const flush = async (): Promise<void> => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    await refreshStatus()
    const current = transport()
    if (current === undefined || status?.enabled !== true) {
      queue.length = 0
      return
    }
    const resource = browserResource()
    while (queue.length > 0) {
      const spans = queue.splice(0, BROWSER_TRACES_LIMITS.spansPerExport)
      await current.export({ resource, spans }).catch(() => undefined)
    }
  }

  const schedule = (): void => {
    if (timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      void flush()
    }, scheduleDelayMs)
  }

  const listenToPage = (): void => {
    if (pageListeners || typeof document === 'undefined') return
    pageListeners = true
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flush()
    })
  }

  const deliver = (record: BrowserSpanRecord): void => {
    for (const recorder of recorders) recorder(record)
    if (!exporting()) return
    if (queue.length >= maxQueueSize) return
    queue.push(record)
    if (queue.length >= BROWSER_TRACES_LIMITS.spansPerExport) void flush()
    else schedule()
  }

  const rootAllowed = (): boolean => {
    if (recorders.size > 0 && !exporting()) return true
    const ratio = status?.sampleRatio ?? 1
    if (ratio <= 0 || random() >= ratio) return false
    const limit = status?.maxRootSpansPerMinute ?? 60
    const since = now() - MINUTE_MS
    while (rootStarts.length > 0 && (rootStarts[0] ?? 0) < since) rootStarts.shift()
    if (rootStarts.length >= limit) return false
    rootStarts.push(now())
    return true
  }

  class RecordingSpan implements BrowserSpan {
    readonly recording = true
    readonly context: SpanContext
    readonly startTimeMs = now()
    readonly #name: string
    readonly #kind: BrowserSpanKind
    readonly #parentSpanId: string | undefined
    readonly #attributes = new Map<string, BrowserAttributeValue>()
    readonly #events: BrowserSpanEventRecord[] = []
    #status: BrowserSpanRecord['status'] = { code: 'unset' }
    #ended = false

    constructor(input: { readonly name: string; readonly kind: BrowserSpanKind; readonly parent: SpanContext | undefined }) {
      this.#name = input.name.slice(0, BROWSER_TRACES_LIMITS.nameLength)
      this.#kind = input.kind
      this.#parentSpanId = input.parent?.spanId
      this.context = { traceId: input.parent?.traceId ?? hexId(16), spanId: hexId(8) }
    }

    get ended(): boolean {
      return this.#ended
    }

    setAttribute(key: string, value: BrowserAttributeValue | undefined): void {
      if (this.#ended || value === undefined) return
      const bounded = boundedValue(value)
      if (bounded === undefined) return
      if (!this.#attributes.has(key) && this.#attributes.size >= BROWSER_TRACES_LIMITS.attributesPerSpan) return
      this.#attributes.set(key, bounded)
    }

    setAttributes(attributes: BrowserSpanAttributes): void {
      for (const [key, value] of Object.entries(attributes)) this.setAttribute(key, value)
    }

    addEvent(name: string, attributes: BrowserSpanAttributes = {}, timeMs = now()): void {
      if (this.#ended || this.#events.length >= BROWSER_TRACES_LIMITS.eventsPerSpan) return
      const kept: Record<string, BrowserAttributeValue> = {}
      for (const [key, value] of Object.entries(attributes).slice(0, BROWSER_TRACES_LIMITS.attributesPerEvent)) {
        const bounded = value === undefined ? undefined : boundedValue(value)
        if (bounded !== undefined) kept[key] = bounded
      }
      this.#events.push({ name: name.slice(0, BROWSER_TRACES_LIMITS.nameLength), timeMs, attributes: kept })
    }

    setStatus(code: BrowserStatusCode, message?: string): void {
      if (this.#ended || this.#status.code === 'ok') return
      this.#status = code === 'error' && message !== undefined ? { code, message: message.slice(0, BROWSER_TRACES_LIMITS.statusMessageLength) } : { code }
    }

    recordFailure(error: unknown): void {
      const type = errorType(error)
      this.setAttribute('error.type', type)
      this.setStatus('error', type)
    }

    end(): void {
      if (this.#ended) return
      this.#ended = true
      const record: BrowserSpanRecord = {
        traceId: this.context.traceId,
        spanId: this.context.spanId,
        ...(this.#parentSpanId === undefined ? {} : { parentSpanId: this.#parentSpanId }),
        name: this.#name,
        kind: this.#kind,
        startTimeMs: this.startTimeMs,
        endTimeMs: Math.max(this.startTimeMs, now()),
        attributes: Object.fromEntries(this.#attributes),
        status: this.#status,
        events: this.#events,
      }
      try {
        deliver(record)
      } catch {
        return
      }
    }
  }

  class InteractionSpan extends RecordingSpan implements Interaction {
    readonly name: string
    #timeout: ReturnType<typeof setTimeout> | undefined
    #ending = false
    #longTasks = 0
    #longTaskMs = 0

    constructor(input: { readonly name: string; readonly timeoutMs: number }) {
      super({ name: input.name, kind: 'internal', parent: undefined })
      this.name = input.name
      this.#timeout = setTimeout(() => this.finish('timeout'), input.timeoutMs)
    }

    noteLongTask(entry: LongTaskEntry): void {
      const startMs = performance.timeOrigin + entry.startTime
      if (startMs + entry.duration < this.startTimeMs) return
      this.#longTasks += 1
      this.#longTaskMs += entry.duration
      this.addEvent('longtask', { 'browser.longtask.duration_ms': Math.round(entry.duration) }, Math.max(startMs, this.startTimeMs))
    }

    finish(outcome: 'completed' | 'superseded' | 'timeout'): void {
      if (this.ended) return
      if (this.#timeout !== undefined) clearTimeout(this.#timeout)
      this.#timeout = undefined
      drainLongTasks()
      if (open.get(this.name) === this) open.delete(this.name)
      this.setAttributes({
        'dshx.interaction.outcome': outcome,
        'dshx.interaction.long_tasks': this.#longTasks,
        'dshx.interaction.long_task_ms': Math.round(this.#longTaskMs),
      })
      super.end()
      if (open.size === 0) stopObserving()
    }

    override end(): void {
      this.finish('completed')
    }

    endAfterPaint(attributes: BrowserSpanAttributes = {}): void {
      if (this.#ending || this.ended) return
      this.#ending = true
      afterNextPaint(() => {
        this.setAttributes(attributes)
        this.finish('completed')
      })
    }
  }

  const noteLongTasks = (entries: readonly LongTaskEntry[]): void => {
    for (const entry of entries) {
      if (entry.duration < longTaskThresholdMs) continue
      for (const interaction of open.values()) interaction.noteLongTask(entry)
    }
  }

  /** A long task's entry arrives after the task; take the pending ones before an interaction closes. */
  const drainLongTasks = (): void => {
    if (observer !== undefined) noteLongTasks(observer.takeRecords())
  }

  const observeLongTasks = (): void => {
    if (observer !== undefined || typeof PerformanceObserver === 'undefined') return
    if (!(PerformanceObserver.supportedEntryTypes ?? []).includes('longtask')) return
    try {
      observer = new PerformanceObserver(list => noteLongTasks(list.getEntries()))
      observer.observe({ type: 'longtask', buffered: false })
    } catch {
      observer = undefined
    }
  }

  const stopObserving = (): void => {
    observer?.disconnect()
    observer = undefined
  }

  const ambient = (): SpanContext | undefined => [...open.values()].at(-1)?.context

  const activeContext = (): SpanContext | undefined => {
    const top = stack.at(-1)
    if (top === UNSAMPLED) return undefined
    return top ?? ambient()
  }

  const startSpan = (name: string, spanOptions: BrowserStartSpanOptions = {}): BrowserSpan => {
    if (!isEnabled()) return NOOP_SPAN
    void refreshStatus()
    const explicit = spanOptions.parent !== undefined
    if (!explicit && stack.at(-1) === UNSAMPLED) return NOOP_SPAN
    const parent = explicit ? (spanOptions.parent ?? undefined) : activeContext()
    if (parent === undefined && !rootAllowed()) return NOOP_SPAN
    try {
      const span = new RecordingSpan({ name, kind: spanOptions.kind ?? 'internal', parent })
      if (spanOptions.attributes !== undefined) span.setAttributes(spanOptions.attributes)
      return span
    } catch {
      return NOOP_SPAN
    }
  }

  const withSpan = async <T>(name: string, spanOptions: BrowserStartSpanOptions, run: (span: BrowserSpan) => T | Promise<T>): Promise<T> => {
    const span = startSpan(name, spanOptions)
    stack.push(span.context ?? UNSAMPLED)
    let result: T | Promise<T>
    try {
      result = run(span)
    } catch (error) {
      span.recordFailure(error)
      span.end()
      throw error
    } finally {
      stack.pop()
    }
    try {
      return await result
    } catch (error) {
      span.recordFailure(error)
      throw error
    } finally {
      span.end()
    }
  }

  const startInteraction = (name: string, interactionOptions: StartInteractionOptions = {}): Interaction => {
    open.get(name)?.finish('superseded')
    if (!isEnabled()) return noopInteraction(name)
    void refreshStatus()
    listenToPage()
    if (!rootAllowed()) return noopInteraction(name)
    try {
      const interaction = new InteractionSpan({ name, timeoutMs: interactionOptions.timeoutMs ?? 10_000 })
      interaction.setAttribute('dshx.interaction', true)
      if (interactionOptions.attributes !== undefined) interaction.setAttributes(interactionOptions.attributes)
      open.set(name, interaction)
      observeLongTasks()
      return interaction
    } catch {
      return noopInteraction(name)
    }
  }

  return {
    get enabled() {
      return isEnabled()
    },
    startSpan,
    withSpan,
    startInteraction,
    interaction: name => open.get(name),
    activeContext,
    traceparent: () => {
      const active = activeContext()
      return active === undefined ? undefined : TraceparentModel.format(active)
    },
    attachTransport: attached => {
      transports.push(attached)
      return () => {
        const index = transports.lastIndexOf(attached)
        if (index >= 0) transports.splice(index, 1)
      }
    },
    record: () => {
      const spans: BrowserSpanRecord[] = []
      const listener = (record: BrowserSpanRecord): void => void spans.push(record)
      recorders.add(listener)
      const named = (spanName: string): readonly BrowserSpanRecord[] => spans.filter(span => span.name === spanName)
      const stop = (): void => void recorders.delete(listener)
      return {
        spans,
        named,
        span: spanName => {
          const found = named(spanName)
          const [only] = found
          if (only === undefined || found.length !== 1)
            throw new Error(`expected one browser span named ${JSON.stringify(spanName)}, found ${String(found.length)}`)
          return only
        },
        children: parent => spans.filter(span => span.traceId === parent.traceId && span.parentSpanId === parent.spanId),
        stop,
        [Symbol.dispose]: stop,
      }
    },
    flush,
  }
}

/**
 * Every plugin bundles its own dshx copy, so the page tracer lives in the page-wide registry: all copies share one
 * interaction registry, one active-span stack, one export queue and the transports every Client attached.
 */
const pageTracer = (): BrowserTracer => {
  const registry = BrowserTracingRegistryModel.current()
  registry.tracer ??= createBrowserTracer({ transports: registry.transports })
  return registry.tracer
}

export class BrowserTracerModel {
  static readonly create = createBrowserTracer
  static readonly page = pageTracer
  static readonly decodeStatus = decodeStatus
  static readonly resource = browserResource
  static readonly noopSpan = NOOP_SPAN
}
