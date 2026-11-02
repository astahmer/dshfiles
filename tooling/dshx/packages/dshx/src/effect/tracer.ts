import { Cause, Effect, Exit, Layer, Option, Tracer } from 'effect'
import { TracerModel, type SpanContext } from '../tracing/tracer.js'
import type { SpanAttributeValue } from '../tracing/otlp-exporter.js'

const spanContexts = new WeakMap<Tracer.AnySpan, SpanContext>()

const spanAttribute = (value: unknown): SpanAttributeValue | undefined => {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (!Array.isArray(value)) return undefined
  const values: Array<string | number | boolean> = []
  for (const item of value) {
    if (typeof item !== 'string' && typeof item !== 'number' && typeof item !== 'boolean') return undefined
    values.push(item)
  }
  return values
}

const effectSpan = (options: Parameters<Tracer.Tracer['span']>[0]): Tracer.Span => {
  const activeTracer = TracerModel.process()
  const parent = Option.getOrUndefined(options.parent)
  const parentContext = parent === undefined ? undefined : (spanContexts.get(parent) ?? { traceId: parent.traceId, spanId: parent.spanId })
  const dshxSpan = activeTracer.startSpan(options.name, {
    kind: options.kind,
    ...(options.root ? { parent: null } : parentContext === undefined ? {} : { parent: parentContext }),
  })
  const dshxContext = dshxSpan.context ?? parentContext ?? activeTracer.activeContext()
  const effectParent =
    dshxContext === undefined ? Option.none<Tracer.AnySpan>() : Option.some(Tracer.externalSpan({ traceId: dshxContext.traceId, spanId: dshxContext.spanId }))
  const native = new Tracer.NativeSpan({ ...options, parent: effectParent })
  const span: Tracer.Span = {
    _tag: 'Span',
    name: native.name,
    spanId: native.spanId,
    traceId: native.traceId,
    parent: native.parent,
    annotations: native.annotations,
    get status() {
      return native.status
    },
    attributes: native.attributes,
    links: native.links,
    sampled: native.sampled,
    kind: native.kind,
    end(endTime, exit) {
      native.end(endTime, exit)
      if (Exit.isFailure(exit)) dshxSpan.recordFailure(Cause.squash(exit.cause))
      dshxSpan.end()
    },
    attribute(key, value) {
      native.attribute(key, value)
      dshxSpan.setAttribute(key, spanAttribute(value))
    },
    event(name, startTime, eventAttributes) {
      native.event(name, startTime, eventAttributes)
    },
    addLinks(links) {
      native.addLinks(links)
    },
  }
  if (dshxContext !== undefined) spanContexts.set(span, dshxContext)
  return span
}

const tracer = Tracer.make({
  span: effectSpan,
  context(primitive, fiber) {
    const span = fiber.cache.span
    const parent = span === undefined ? undefined : spanContexts.get(span)
    return TracerModel.process().runWithParent(parent, () => primitive['~effect/Effect/evaluate'](fiber))
  },
})

export const tracerLayer = Layer.succeed(Tracer.Tracer, tracer)

export const provideDshxTracer = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => Effect.provideService(effect, Tracer.Tracer, tracer)
