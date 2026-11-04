import { Cause, Effect, Exit, Layer, Option, Tracer, type Context } from 'effect'
import { RecordingSpan, TracerModel, type SpanAttributes, type Tracer as DshxTracer } from '../tracing/tracer.js'
import type { FinishedSpan, SpanAttributeValue } from '../tracing/otlp-exporter.js'

type EffectSpanOptions = Parameters<Tracer.Tracer['span']>[0]

const attributeValue = (value: unknown): SpanAttributeValue | undefined => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return value.toString()
  if (!Array.isArray(value)) return undefined
  const values: Array<string | number | boolean> = []
  for (const item of value) {
    if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') return undefined
    values.push(item)
  }
  return values
}

const attributesOf = (record: Readonly<Record<string, unknown>> | undefined): SpanAttributes | undefined => {
  if (record === undefined) return undefined
  const attributes: Record<string, SpanAttributeValue | undefined> = {}
  for (const key in record) attributes[key] = attributeValue(record[key])
  return attributes
}

/**
 * Failures carry their class (or tag) only, never a message; interruption is how Effect cancels work, so it is
 * marked rather than reported as an error.
 */
const recordCause = (span: RecordingSpan, cause: Cause.Cause<unknown>): void => {
  if (Cause.hasInterruptsOnly(cause)) {
    span.setAttribute('dshx.interrupted', true)
    return
  }
  const failure = Cause.findErrorOption(cause)
  if (Option.isSome(failure)) {
    span.recordFailure(failure.value)
    return
  }
  span.setAttribute('dshx.defect', true)
  span.recordFailure(Cause.squash(cause))
}

/** One object for both tracers: the ids Effect sees (`Effect.currentSpan`, log spans, propagation) are the exported ids. */
class DshxEffectSpan extends RecordingSpan implements Tracer.Span {
  readonly _tag = 'Span'
  readonly sampled = true
  readonly parent: Option.Option<Tracer.AnySpan>
  readonly annotations: Context.Context<never>
  readonly links: Array<Tracer.SpanLink>
  readonly #timed: boolean
  #effectStatus: Tracer.SpanStatus

  constructor(input: { readonly options: EffectSpanOptions; readonly parent: Option.Option<Tracer.AnySpan>; readonly onEnd: (span: FinishedSpan) => void }) {
    super({
      name: input.options.name,
      kind: input.options.kind,
      parent: Option.getOrUndefined(input.parent),
      startTimeUnixNano: input.options.startTime,
      onEnd: input.onEnd,
    })
    this.parent = input.parent
    this.annotations = input.options.annotations
    this.links = input.options.links
    this.#timed = input.options.startTime !== 0n
    this.#effectStatus = { _tag: 'Started', startTime: input.options.startTime }
    for (const link of this.links) this.addLink({ context: link.span, attributes: attributesOf(link.attributes) })
  }

  get status(): Tracer.SpanStatus {
    return this.#effectStatus
  }

  override end(endTime: bigint = 0n, exit: Exit.Exit<unknown, unknown> = Exit.void): void {
    if (this.ended) return
    const failed = Exit.isFailure(exit)
    this.#effectStatus = { _tag: 'Ended', startTime: this.#effectStatus.startTime, endTime, exit: failed ? exit : Exit.void }
    if (failed) recordCause(this, exit.cause)
    this.endAt(this.#timed ? endTime : 0n)
  }

  attribute(key: string, value: unknown): void {
    this.setAttribute(key, attributeValue(value))
  }

  event(name: string, startTime: bigint, attributes?: Record<string, unknown>): void {
    this.addEvent({ name, timeUnixNano: startTime, attributes: attributesOf(attributes) })
  }

  addLinks(links: ReadonlyArray<Tracer.SpanLink>): void {
    if (this.ended) return
    for (const link of links) {
      this.links.push(link)
      this.addLink({ context: link.span, attributes: attributesOf(link.attributes) })
    }
  }
}

const evaluate = '~effect/Effect/evaluate' as const

const evaluatePrimitive = <X>(primitive: Tracer.EffectPrimitive<X>, fiber: Parameters<Tracer.EffectPrimitive<X>[typeof evaluate]>[0]): X =>
  primitive[evaluate](fiber)

/**
 * An Effect `Tracer` that records into `dshxTracer`. Parent: the Effect parent span (internal or external), none for
 * `root`, else the dshx span active in the async context. While the dshx tracer records nothing, spans are unsampled
 * native spans and nothing enters the async context.
 */
const makeDshxEffectTracer = (dshxTracer: DshxTracer): Tracer.Tracer => {
  const parentOf = (options: EffectSpanOptions): Option.Option<Tracer.AnySpan> => {
    if (Option.isSome(options.parent) || options.root) return options.parent
    const active = dshxTracer.activeContext()
    if (active === undefined) return options.parent
    if (active instanceof DshxEffectSpan) return Option.some(active)
    return Option.some(Tracer.externalSpan({ traceId: active.traceId, spanId: active.spanId }))
  }
  return Tracer.make({
    span: options => {
      if (!options.sampled || !dshxTracer.enabled) return new Tracer.NativeSpan({ ...options, sampled: false })
      const parent = parentOf(options)
      return dshxTracer.createRecordingSpan(onEnd => new DshxEffectSpan({ options, parent, onEnd }))
    },
    context: (primitive, fiber) => {
      const span = fiber.cache.span
      if (span === undefined || !span.sampled) return primitive[evaluate](fiber)
      return dshxTracer.runWithParent(span, evaluatePrimitive, primitive, fiber)
    },
  })
}

const effectTracers = new WeakMap<DshxTracer, Tracer.Tracer>()

const processEffectTracer = (): Tracer.Tracer => {
  const dshxTracer = TracerModel.process()
  const cached = effectTracers.get(dshxTracer)
  if (cached !== undefined) return cached
  const tracer = makeDshxEffectTracer(dshxTracer)
  effectTracers.set(dshxTracer, tracer)
  return tracer
}

/** The process dshx tracer as Effect's `Tracer`, resolved once when the layer is built. */
export const tracerLayer: Layer.Layer<never> = Layer.sync(Tracer.Tracer, processEffectTracer)

export const provideDshxTracer = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.suspend(() => Effect.provideService(effect, Tracer.Tracer, processEffectTracer()))

export class DshxEffectTracer {
  static readonly make = makeDshxEffectTracer
  static readonly process = processEffectTracer
  static readonly layer = tracerLayer
  static readonly provide = provideDshxTracer
}
