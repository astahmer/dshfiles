// @vitest-environment node
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Duration, Effect } from 'effect'
import { FetchHttpClient } from 'effect/http'
import { listPages, openCdp } from '../src/chrome-cdp.js'

describe('chrome cdp spans', () => {
  it.live('records the cdp open span when the socket is refused', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans.stop()),
      )
      const error = yield* Effect.flip(Effect.scoped(openCdp({ wsUrl: 'ws://127.0.0.1:1', timeout: Duration.seconds(2) })))
      expect(error._tag).toBe('CdpUnavailable')
      const opens = recorder.named('annotations open cdp')
      expect(opens).toHaveLength(1)
      expect(opens[0]?.status.code).toBe('error')
    }).pipe(Effect.scoped, Effect.provide(DshxEffect.tracerLayer)),
  )

  it.live('records the cdp list span when the endpoint is refused', () =>
    Effect.gen(function* () {
      const recorder = yield* Effect.acquireRelease(
        Effect.sync(() => recordSpans()),
        spans => Effect.sync(() => spans.stop()),
      )
      expect(yield* listPages({ endpoint: 'http://127.0.0.1:1' })).toEqual([])
      expect(recorder.named('annotations list cdp pages')).toHaveLength(1)
      expect(recorder.span('annotations list cdp pages').attributes).toEqual({ 'dshx.annotations.pages': 0 })
    }).pipe(Effect.scoped, Effect.provide([DshxEffect.tracerLayer, FetchHttpClient.layer])),
  )
})
