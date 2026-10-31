import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { AgentTelemetryPricingError, reloadAgentTelemetryPricing } from './telemetry-effect.js'

describe('agent telemetry pricing Effect', () => {
  it('records a reload span through the dshx tracer bridge', async () => {
    const recorder = recordSpans()
    try {
      await Effect.runPromise(reloadAgentTelemetryPricing({ load: async () => undefined }).pipe(Effect.provide(DshxEffect.tracerLayer)))
      expect(recorder.span('agent telemetry pricing reload')).toBeDefined()
    } finally {
      recorder.stop()
    }
  })

  it('turns catalog failures into a tagged error without exposing the cause', async () => {
    let failure: unknown
    try {
      await Effect.runPromise(
        reloadAgentTelemetryPricing({ load: async () => Promise.reject(new Error('private path')) }).pipe(Effect.provide(DshxEffect.tracerLayer)),
      )
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(AgentTelemetryPricingError)
    if (!(failure instanceof AgentTelemetryPricingError)) return
    expect(failure._tag).toBe('AgentTelemetryPricingError')
    expect(failure.operation).toBe('catalog')
    expect(failure.message).not.toContain('private path')
  })
})
