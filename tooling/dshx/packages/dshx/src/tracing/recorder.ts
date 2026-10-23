import type { FinishedSpan, SpanAttributeValue, SpanKind, SpanStatusCode } from './otlp-exporter.js'

/** One ended span as a test sees it: plain values, attributes as a record. */
export interface RecordedSpan {
  readonly name: string
  readonly kind: SpanKind
  readonly traceId: string
  readonly spanId: string
  readonly parentSpanId: string | undefined
  readonly attributes: Readonly<Record<string, SpanAttributeValue>>
  readonly status: { readonly code: SpanStatusCode; readonly message: string | undefined }
  readonly startTimeUnixNano: bigint
  readonly endTimeUnixNano: bigint
}

export interface SpanRecorder extends Disposable {
  /** Every span ended since `recordSpans()`, in end order. */
  readonly spans: readonly RecordedSpan[]
  /** The first ended span with this name; throws when there is none, so a missing span fails loudly. */
  span(name: string): RecordedSpan
  /** Ended spans whose name equals `name` or matches the pattern. */
  named(name: string | RegExp): readonly RecordedSpan[]
  /** Direct children of `parent`, in end order. */
  children(parent: RecordedSpan): readonly RecordedSpan[]
  /** Stop recording; spans already recorded stay readable. Same as `[Symbol.dispose]()`. */
  stop(): void
}

type Listener = (span: FinishedSpan) => void

const RECORDERS_KEY = Symbol.for('@dshfiles/dshx.tracing-recorders.v1')

// SAFETY: only this module writes the versioned symbol, and always a Set of listeners.
const holder = globalThis as { [RECORDERS_KEY]?: Set<Listener> }

const listeners = (): Set<Listener> => {
  holder[RECORDERS_KEY] ??= new Set()
  return holder[RECORDERS_KEY]
}

const toRecorded = (span: FinishedSpan): RecordedSpan => ({
  name: span.name,
  kind: span.kind,
  traceId: span.traceId,
  spanId: span.spanId,
  parentSpanId: span.parentSpanId,
  attributes: Object.fromEntries(span.attributes),
  status: { code: span.status.code, message: span.status.message },
  startTimeUnixNano: span.startTimeUnixNano,
  endTimeUnixNano: span.endTimeUnixNano,
})

const record = (): SpanRecorder => {
  const spans: RecordedSpan[] = []
  const listener: Listener = span => {
    spans.push(toRecorded(span))
  }
  listeners().add(listener)
  const stop = (): void => {
    listeners().delete(listener)
  }
  const named = (name: string | RegExp): readonly RecordedSpan[] => spans.filter(span => (typeof name === 'string' ? span.name === name : name.test(span.name)))
  return {
    spans,
    span: name => {
      const found = spans.find(span => span.name === name)
      if (found === undefined) throw new Error(`no ended span named ${JSON.stringify(name)}; recorded: ${spans.map(span => span.name).join(', ') || 'none'}`)
      return found
    },
    named,
    children: parent => spans.filter(span => span.traceId === parent.traceId && span.parentSpanId === parent.spanId),
    stop,
    [Symbol.dispose]: stop,
  }
}

/** Shared by every dshx copy in the process, like the tracer itself. */
export class SpanRecorders {
  static readonly record = record
  static readonly active = (): boolean => listeners().size > 0
  static readonly deliver = (span: FinishedSpan): void => {
    for (const listener of listeners()) {
      try {
        listener(span)
      } catch {
        continue
      }
    }
  }
}
