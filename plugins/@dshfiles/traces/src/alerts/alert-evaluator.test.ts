import { describe, expect, test } from 'vitest'
import { AlertEvaluator, initialAlertState, RESOLVE_AFTER_EVALUATIONS, type AlertSample } from './alert-evaluator.js'
import type { AlertRule, AlertState } from './alert-types.js'

const rule = (overrides: Partial<AlertRule>): AlertRule => ({
  id: 'rule-test',
  name: 'Test rule',
  kind: 'error-rate',
  filter: { service: null, operation: null, attribute: null },
  windowMinutes: 10,
  threshold: 0.2,
  comparator: 'above',
  percentile: 95,
  minSamples: 1,
  severity: 'warning',
  enabled: true,
  notify: true,
  markThreads: true,
  mutedUntil: null,
  builtin: false,
  createdAt: 0,
  updatedAt: 0,
  ...overrides,
})

const sample = (durationMs: number, error = false, sessionId: string | null = null, traceId = 'trace'): AlertSample => ({
  traceId,
  durationMs,
  error,
  sessionId,
})

describe('alert measurement', () => {
  test('error rate is the failed share and waits for the minimum samples', () => {
    const samples = [sample(1, true, 'session-a', 'trace-a'), sample(1), sample(1), sample(1)]
    expect(AlertEvaluator.measure(rule({ minSamples: 4 }), samples)).toEqual({
      value: 0.25,
      sampleCount: 4,
      breached: true,
      sessionIds: ['session-a'],
      sampleTraceId: 'trace-a',
    })
    expect(AlertEvaluator.measure(rule({ minSamples: 5 }), samples).breached).toBe(false)
    expect(AlertEvaluator.measure(rule({}), []).value).toBeNull()
  })

  test('latency uses the nearest-rank percentile and names the slow spans', () => {
    const samples = [10, 20, 30, 40, 50, 60, 70, 80, 90, 1_000].map((duration, index) => sample(duration, false, `session-${String(index)}`))
    const p50 = AlertEvaluator.measure(rule({ kind: 'latency', percentile: 50, threshold: 100 }), samples)
    expect(p50.value).toBe(50)
    expect(p50.breached).toBe(false)
    const p95 = AlertEvaluator.measure(rule({ kind: 'latency', percentile: 95, threshold: 100 }), samples)
    expect(p95.value).toBe(1_000)
    expect(p95.breached).toBe(true)
    expect(p95.sessionIds).toEqual(['session-9'])
  })

  test('throughput is spans per minute and a below rule trips on silence', () => {
    const silent = rule({ kind: 'throughput', comparator: 'below', threshold: 1, windowMinutes: 5 })
    expect(AlertEvaluator.measure(silent, [])).toMatchObject({ value: 0, breached: true, sessionIds: [] })
    expect(
      AlertEvaluator.measure(
        silent,
        Array.from({ length: 10 }, () => sample(1)),
      ),
    ).toMatchObject({ value: 2, breached: false })
  })

  test('span count compares the number of matching spans', () => {
    const samples = Array.from({ length: 3 }, (_, index) => sample(1, false, `session-${String(index % 2)}`))
    expect(AlertEvaluator.measure(rule({ kind: 'span-count', threshold: 2 }), samples)).toMatchObject({
      value: 3,
      breached: true,
      sessionIds: ['session-0', 'session-1'],
    })
  })

  test('duration fires on any span over the threshold, longest first', () => {
    const samples = [sample(100, false, 'short'), sample(20_000, false, 'long', 'trace-long'), sample(16_000, false, 'longish')]
    const measured = AlertEvaluator.measure(rule({ kind: 'duration', threshold: 15_000 }), samples)
    expect(measured).toMatchObject({ value: 20_000, breached: true, sessionIds: ['long', 'longish'], sampleTraceId: 'trace-long' })
    expect(AlertEvaluator.measure(rule({ kind: 'duration', threshold: 30_000 }), samples).breached).toBe(false)
  })
})

describe('alert state transitions', () => {
  const breach = { value: 1, sampleCount: 5, breached: true, sessionIds: [], sampleTraceId: null }
  const clear = { ...breach, value: 0, breached: false }

  const run = (measurements: readonly (typeof breach)[]) => {
    let state = initialAlertState
    const states: AlertState[] = []
    const events: (string | null)[] = []
    measurements.forEach((measurement, index) => {
      const next = AlertEvaluator.transition({ previous: state, measurement, now: (index + 1) * 60_000 })
      state = next.state
      states.push(state)
      events.push(next.event)
    })
    return { states, events }
  }

  test('fires on the first breach and keeps its start while it lasts', () => {
    const { states, events } = run([clear, breach, breach])
    expect(events).toEqual([null, 'firing', null])
    expect(states.at(-1)).toMatchObject({ status: 'firing', since: 120_000, evaluatedAt: 180_000 })
  })

  test('resolves only after 2 clear evaluations in a row', () => {
    expect(RESOLVE_AFTER_EVALUATIONS).toBe(2)
    const { states, events } = run([breach, clear, clear])
    expect(events).toEqual(['firing', null, 'resolved'])
    expect(states[1]).toMatchObject({ status: 'firing', clearEvaluations: 1 })
    expect(states[2]).toMatchObject({ status: 'ok', since: null, clearEvaluations: 0 })
  })

  test('a flapping signal fires once instead of on every swing', () => {
    const { events } = run([breach, clear, breach, clear, breach, clear, clear])
    expect(events.filter(event => event === 'firing')).toHaveLength(1)
    expect(events.filter(event => event === 'resolved')).toHaveLength(1)
    expect(events.at(-1)).toBe('resolved')
  })

  test('muting lasts until its time passes', () => {
    expect(AlertEvaluator.isMuted({ mutedUntil: 2_000 }, 1_000)).toBe(true)
    expect(AlertEvaluator.isMuted({ mutedUntil: 2_000 }, 2_000)).toBe(false)
    expect(AlertEvaluator.isMuted({ mutedUntil: null }, 1_000)).toBe(false)
  })
})
