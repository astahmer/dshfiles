import { tracerLayer } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Deferred, Duration, Effect, Ref } from 'effect'
import { TestClock } from 'effect/testing'
import { StatusSnapshotsModel } from '../src/status-snapshots.js'

// The stale-while-revalidate contract of the runtime status and resource snapshots, formerly pinned on
// runtime-status-snapshot-cache.ts: one refresh per runtime, results cached for 30 s, failures for 45 s, and an
// invalidation during a refresh discards that refresh.

type Status = { readonly ok: boolean; readonly value: string }

const snapshots = StatusSnapshotsModel.make<Status>({
  successTtl: Duration.seconds(30),
  failureTtl: Duration.seconds(45),
  capacity: 128,
  spanName: 'multi-host runtime status refresh',
})

/** Let forked refresh fibers run to their next suspension point. */
const settle = Effect.forEach(Array.from({ length: 10 }), () => Effect.yieldNow, { discard: true })

describe('status snapshots', () => {
  it.effect('coalesces refreshes, caches results, and traces the remote work unit', () =>
    Effect.scoped(
      Effect.gen(function* () {
        using recorder = recordSpans()
        const cache = yield* snapshots
        const loads = yield* Ref.make(0)
        const response = yield* Deferred.make<Status>()
        yield* cache.refresh(
          'runtime-a',
          Effect.andThen(
            Ref.update(loads, count => count + 1),
            Deferred.await(response),
          ),
        )
        yield* cache.refresh(
          'runtime-a',
          Effect.andThen(
            Ref.update(loads, count => count + 1),
            Effect.succeed({ ok: true, value: 'duplicate' }),
          ),
        )
        yield* settle
        expect(yield* Ref.get(loads)).toBe(1)
        expect(yield* cache.read('runtime-a')).toEqual({ status: undefined, stale: true, refreshing: true })
        yield* Deferred.succeed(response, { ok: true, value: 'ready' })
        yield* settle
        expect(yield* cache.read('runtime-a')).toEqual({ status: { ok: true, value: 'ready' }, stale: false, refreshing: false })
        expect(recorder.span('multi-host runtime status refresh').attributes).toMatchObject({ 'dshx.multi-host.runtime_id': 'runtime-a' })

        yield* TestClock.adjust(Duration.seconds(30))
        expect(yield* cache.read('runtime-a')).toMatchObject({ status: { ok: true, value: 'ready' }, stale: true, refreshing: false })
        yield* cache.invalidate('runtime-a')
        expect(yield* cache.read('runtime-a')).toEqual({ status: undefined, stale: true, refreshing: false })
      }),
    ).pipe(Effect.provide(tracerLayer)),
  )

  it.effect('keeps failures cached for the longer retry window', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cache = yield* snapshots
        yield* cache.refresh('runtime-a', Effect.succeed({ ok: false, value: 'offline' }))
        yield* settle
        yield* TestClock.adjust(Duration.millis(44_999))
        expect(yield* cache.read('runtime-a')).toMatchObject({ status: { ok: false, value: 'offline' }, stale: false, refreshing: false })
        yield* TestClock.adjust(Duration.millis(1))
        expect(yield* cache.read('runtime-a')).toMatchObject({ status: { ok: false, value: 'offline' }, stale: true, refreshing: false })
      }),
    ),
  )

  it.effect('discards an in-flight result after explicit invalidation', () =>
    Effect.scoped(
      Effect.gen(function* () {
        const cache = yield* snapshots
        const response = yield* Deferred.make<Status>()
        yield* cache.refresh('runtime-a', Deferred.await(response))
        yield* settle
        yield* cache.invalidate('runtime-a')
        yield* Deferred.succeed(response, { ok: true, value: 'obsolete' })
        yield* settle
        expect(yield* cache.read('runtime-a')).toEqual({ status: undefined, stale: true, refreshing: false })
      }),
    ),
  )
})
