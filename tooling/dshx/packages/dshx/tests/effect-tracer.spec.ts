import { Data, Effect, Exit, Fiber, Layer, Tracer } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import { DshxEffectTracer, tracerLayer } from '../src/effect/tracer.js'
import { activeSpanContext, recordSpans, traceparent, withSpan, type SpanRecorder } from '../src/tracing/index.js'
import { TracerModel } from '../src/tracing/tracer.js'

class QuotaExceeded extends Data.TaggedError('QuotaExceeded')<{}> {}

const withRecorder = <A, E, R>(use: (recorder: SpanRecorder) => Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(Effect.sync(recordSpans), use, recorder => Effect.sync(() => recorder.stop()))

const spanIdsOf = Effect.fn('read span')(function* () {
  const span = yield* Effect.currentSpan
  return { traceId: span.traceId, spanId: span.spanId }
})

describe('dshx Effect tracer', () => {
  it.effect('exports the ids Effect.currentSpan sees, with Effect.fn parents', () =>
    withRecorder(recorder =>
      Effect.gen(function* () {
        const outer = yield* Effect.fn('outer')(function* () {
          const self = yield* Effect.currentSpan
          const inner = yield* spanIdsOf()
          return { self: { traceId: self.traceId, spanId: self.spanId }, inner }
        })()
        const recordedOuter = recorder.span('outer')
        const recordedInner = recorder.span('read span')
        expect({ traceId: recordedOuter.traceId, spanId: recordedOuter.spanId }).toEqual(outer.self)
        expect({ traceId: recordedInner.traceId, spanId: recordedInner.spanId }).toEqual(outer.inner)
        expect(recordedInner.parentSpanId).toBe(recordedOuter.spanId)
        expect(recordedInner.traceId).toBe(recordedOuter.traceId)
      }).pipe(Effect.provide(tracerLayer)),
    ),
  )

  it.effect('nests Effect spans under a dshx withSpan parent and dshx spans under an Effect span', () =>
    withRecorder(recorder =>
      Effect.gen(function* () {
        const effectChild = yield* Effect.promise(() => withSpan('promise parent', () => Effect.runPromise(spanIdsOf().pipe(Effect.provide(tracerLayer)))))
        const promiseParent = recorder.span('promise parent')
        expect(recorder.span('read span').parentSpanId).toBe(promiseParent.spanId)
        expect(effectChild.traceId).toBe(promiseParent.traceId)

        const effectParent = yield* Effect.fn('effect parent')(function* () {
          const header = yield* Effect.promise(() => withSpan('promise child', async () => traceparent()))
          const active = yield* Effect.sync(activeSpanContext)
          return { header, active, span: yield* Effect.currentSpan }
        })()
        const promiseChild = recorder.span('promise child')
        expect(promiseChild.parentSpanId).toBe(effectParent.span.spanId)
        expect(promiseChild.traceId).toBe(effectParent.span.traceId)
        expect(effectParent.header).toBe(`00-${promiseChild.traceId}-${promiseChild.spanId}-01`)
        expect(effectParent.active).toBe(effectParent.span)
      }).pipe(Effect.provide(tracerLayer)),
    ),
  )

  it.effect('honors root over an active dshx parent', () =>
    withRecorder(recorder =>
      Effect.promise(() =>
        withSpan('ambient', () => Effect.runPromise(Effect.void.pipe(Effect.withSpan('detached', { root: true }), Effect.provide(tracerLayer)))),
      ).pipe(
        Effect.map(() => {
          const detached = recorder.span('detached')
          expect(detached.parentSpanId).toBeUndefined()
          expect(detached.traceId).not.toBe(recorder.span('ambient').traceId)
        }),
      ),
    ),
  )

  it.live('forwards events, links and the Effect clock times', () =>
    withRecorder(recorder =>
      Effect.gen(function* () {
        const linked = Tracer.externalSpan({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) })
        const span = yield* Effect.gen(function* () {
          yield* Effect.log('cache warmed')
          const current = yield* Effect.currentSpan
          current.event('checkpoint', 0n, { 'dshx.test.count': 2, ignored: { nested: true } })
          return current
        }).pipe(Effect.withSpan('evented', { links: [{ span: linked, attributes: { 'link.kind': 'follows-from' } }] }))
        const recorded = recorder.span('evented')
        expect(recorded.events.map(event => event.name)).toEqual(['cache warmed', 'checkpoint'])
        expect(recorded.events[0]?.attributes['effect.logLevel']).toBe('INFO')
        expect(recorded.events[1]?.attributes).toEqual({ 'dshx.test.count': 2 })
        expect(recorded.links).toEqual([{ traceId: linked.traceId, spanId: linked.spanId, attributes: { 'link.kind': 'follows-from' } }])
        expect(span.status._tag).toBe('Ended')
        if (span.status._tag !== 'Ended') return
        expect(recorded.startTimeUnixNano).toBe(span.status.startTime)
        expect(recorded.endTimeUnixNano).toBe(span.status.endTime)
      }).pipe(Effect.provide(tracerLayer)),
    ),
  )

  it.effect('marks interruption without an error status and records failures by tag', () =>
    withRecorder(recorder =>
      Effect.gen(function* () {
        const fiber = yield* Effect.never.pipe(Effect.withSpan('interrupted'), Effect.forkChild)
        yield* Effect.yieldNow
        yield* Fiber.interrupt(fiber)
        const interrupted = recorder.span('interrupted')
        expect(interrupted.status).toEqual({ code: 'unset', message: undefined })
        expect(interrupted.attributes['dshx.interrupted']).toBe(true)

        const failed = yield* Effect.exit(Effect.fail(new QuotaExceeded()).pipe(Effect.withSpan('failed')))
        expect(Exit.isFailure(failed)).toBe(true)
        expect(recorder.span('failed').status).toEqual({ code: 'error', message: 'QuotaExceeded' })
        expect(recorder.span('failed').attributes['error.type']).toBe('QuotaExceeded')

        yield* Effect.exit(Effect.die(new RangeError('secret detail')).pipe(Effect.withSpan('defect')))
        const defect = recorder.span('defect')
        expect(defect.status).toEqual({ code: 'error', message: 'RangeError' })
        expect(defect.attributes['dshx.defect']).toBe(true)
        expect(JSON.stringify({ attributes: defect.attributes, status: defect.status })).not.toContain('secret detail')

        yield* Effect.void.pipe(Effect.withSpan('succeeded'))
        expect(recorder.span('succeeded').status.code).toBe('unset')
      }).pipe(Effect.provide(tracerLayer)),
    ),
  )

  it.effect('records spans opened while a layer is built under the tracer', () =>
    withRecorder(recorder =>
      Effect.gen(function* () {
        const built = Layer.effectDiscard(Effect.void.pipe(Effect.withSpan('layer build'))).pipe(Layer.provideMerge(tracerLayer))
        yield* Effect.void.pipe(Effect.provide(built))
        expect(recorder.span('layer build').name).toBe('layer build')
      }),
    ),
  )

  it.effect('hands out unsampled spans and leaves the async context alone while recording is off', () => {
    const dshxTracer = TracerModel.create({ env: {} })
    return Effect.gen(function* () {
      expect(dshxTracer.enabled).toBe(false)
      const span = yield* Effect.currentSpan.pipe(Effect.withSpan('unrecorded'))
      const active = yield* Effect.sync(() => dshxTracer.activeContext()).pipe(Effect.withSpan('unrecorded parent'))
      expect(span.sampled).toBe(false)
      expect(active).toBeUndefined()
    }).pipe(Effect.provideService(Tracer.Tracer, DshxEffectTracer.make(dshxTracer)))
  })
})
