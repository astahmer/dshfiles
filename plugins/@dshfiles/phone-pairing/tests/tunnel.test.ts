import { tracerLayer } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { NodeServices } from '@effect/platform-node'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vitest'
import { startTunnel } from '../src/tunnel.ts'

describe('startTunnel', () => {
  it('records one bounded tunnel span and starts no provider for a manual origin', async () => {
    using recorder = recordSpans()
    const tunnel = await Effect.runPromise(startTunnel(3447, 'manual').pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, tracerLayer))))
    expect(tunnel).toBeUndefined()
    expect(recorder.named('phone pairing tunnel')).toHaveLength(1)
    const metadata = JSON.stringify(recorder.spans.map(span => ({ attributes: span.attributes, status: span.status })))
    expect(metadata).not.toContain('3447')
  })
})
