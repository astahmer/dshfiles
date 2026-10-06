import { describe, expect, it } from 'vitest'
import { hookEventSchema } from './api.js'

describe('Project Checks hook event contract', () => {
  it('accepts fractional durations recorded by the native Hook Protocol', () => {
    const event = hookEventSchema.parse({
      seq: 12,
      time: 1_234,
      kind: 'result',
      turn: 1,
      point: 'Stop',
      dialect: null,
      decision: 'pass',
      exitCode: 7,
      durationMs: 0.375,
      stderrPresent: true,
    })

    expect(event.durationMs).toBe(0.375)
  })
})
