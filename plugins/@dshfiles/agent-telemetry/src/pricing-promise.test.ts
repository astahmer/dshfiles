import { HostContext, tracerLayer } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { createTestHost } from '@dshfiles/dshx/testing'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import { PricingCatalog } from './pricing-promise.js'

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

const settleReload = Effect.promise(() => new Promise<void>(resolve => setTimeout(resolve, 50)))

describe('PricingCatalog', () => {
  it.effect('reloads at once, then on a cache miss at most every 30 seconds', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const recorder = yield* Effect.acquireRelease(
          Effect.sync(() => recordSpans()),
          spans => Effect.sync(() => spans.stop()),
        )
        const reloads = () => recorder.named('agent telemetry pricing reload').length
        const pricing = yield* catalogWithoutCache.pipe(Effect.provide(tracerLayer))
        yield* TestClock.adjust(0)
        yield* settleReload
        expect(reloads()).toBe(1)

        expect(pricing.current()).toBeNull()
        yield* TestClock.adjust(0)
        yield* settleReload
        expect(reloads()).toBe(2)

        expect(pricing.current()).toBeNull()
        yield* TestClock.adjust(29_000)
        yield* settleReload
        expect(reloads()).toBe(2)

        yield* TestClock.adjust(1_000)
        expect(pricing.current()).toBeNull()
        yield* TestClock.adjust(0)
        yield* settleReload
        expect(reloads()).toBe(3)
        expect(pricing.accountKind('openai')).toBeUndefined()
        expect(recorder.span('agent telemetry pricing reload').attributes).toEqual({
          'dshx.agent-telemetry.cached': false,
          'dshx.agent-telemetry.accounts': 0,
        })
      }),
    ),
  )
})
