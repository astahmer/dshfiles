import { HostContext } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer, Tracer } from 'effect'
import { TestClock } from 'effect/testing'
import { PricingCatalog } from './pricing-promise.js'

const recordSpanNames = () => {
  const names: string[] = []
  const tracer = Tracer.make({
    span: options => {
      names.push(options.name)
      return new Tracer.NativeSpan(options)
    },
  })
  return { reloads: () => names.filter(name => name === 'agent telemetry pricing reload').length, tracer }
}

const catalogWithoutCache = Effect.gen(function* () {
  const host = yield* Effect.acquireRelease(
    Effect.promise(() => createTestHost()),
    created => Effect.promise(() => created.dispose()),
  )
  const services = yield* Layer.build(
    PricingCatalog.layerFrom({ path: '/nonexistent/agent-telemetry/pricing.json' }).pipe(
      Layer.provide(HostApis.layer),
      Layer.provide(HostContext.layer({ ctx: host.ctx, packageId: '@dshfiles/agent-telemetry' })),
    ),
  )
  return Context.get(services, PricingCatalog)
})

describe('PricingCatalog', () => {
  it.effect('reloads at once, then on a cache miss at most every 30 seconds', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const recorder = recordSpanNames()
        const pricing = yield* Effect.withTracer(catalogWithoutCache, recorder.tracer)
        yield* TestClock.adjust(0)
        expect(recorder.reloads()).toBe(1)

        expect(pricing.current()).toBeNull()
        yield* TestClock.adjust(0)
        expect(recorder.reloads()).toBe(2)

        expect(pricing.current()).toBeNull()
        yield* TestClock.adjust(29_000)
        expect(recorder.reloads()).toBe(2)

        yield* TestClock.adjust(1_000)
        expect(pricing.current()).toBeNull()
        yield* TestClock.adjust(0)
        expect(recorder.reloads()).toBe(3)
        expect(pricing.accountKind('openai')).toBeUndefined()
      }),
    ),
  )
})
