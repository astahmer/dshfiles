import { LatencyStats } from '../stats.js'
import type { AlertRule, AlertState } from './alert-types.js'

/** One stored span as an alert rule sees it. */
export type AlertSample = {
  readonly traceId: string
  readonly durationMs: number
  readonly error: boolean
  readonly sessionId: string | null
}

export type AlertMeasurement = {
  readonly value: number | null
  readonly sampleCount: number
  readonly breached: boolean
  readonly sessionIds: readonly string[]
  readonly sampleTraceId: string | null
}

export type AlertTransition = {
  readonly state: AlertState
  readonly event: 'firing' | 'resolved' | null
}

/** A firing rule resolves only after this many evaluations in a row under its threshold, so one quiet minute does not flap it. */
export const RESOLVE_AFTER_EVALUATIONS = 2

const MAX_EVENT_SESSIONS = 10

export const initialAlertState: AlertState = { status: 'ok', since: null, value: null, sampleCount: 0, evaluatedAt: null, clearEvaluations: 0 }

const compare = (rule: Pick<AlertRule, 'comparator'>, value: number, threshold: number): boolean =>
  rule.comparator === 'below' ? value < threshold : value > threshold

const sessionsOf = (samples: readonly AlertSample[]): string[] => [...new Set(samples.flatMap(sample => (sample.sessionId === null ? [] : [sample.sessionId])))]

const measured = (input: {
  readonly value: number | null
  readonly count: number
  readonly breached: boolean
  readonly offenders: readonly AlertSample[]
}) => ({
  value: input.value,
  sampleCount: input.count,
  breached: input.breached,
  sessionIds: input.breached ? sessionsOf(input.offenders).slice(0, MAX_EVENT_SESSIONS) : [],
  sampleTraceId: input.breached ? (input.offenders[0]?.traceId ?? null) : null,
})

/**
 * The value a rule watches over the samples of its window, and whether it crosses the threshold. Error-rate and latency
 * stay quiet below `minSamples`, so a single failed span is not a 100% error rate; throughput and span count do not, so a
 * silent service still trips a "below" rule.
 */
const measure = (rule: AlertRule, samples: readonly AlertSample[]): AlertMeasurement => {
  const count = samples.length
  if (rule.kind === 'error-rate') {
    const errors = samples.filter(sample => sample.error)
    const value = count === 0 ? null : errors.length / count
    return measured({ value, count, breached: value !== null && count >= rule.minSamples && compare(rule, value, rule.threshold), offenders: errors })
  }
  if (rule.kind === 'latency') {
    const sorted = samples.map(sample => sample.durationMs).sort((left, right) => left - right)
    const value = LatencyStats.percentile(sorted, rule.percentile / 100)
    const breached = value !== null && count >= rule.minSamples && compare(rule, value, rule.threshold)
    const offenders = samples.filter(sample => compare(rule, sample.durationMs, rule.threshold))
    return measured({ value, count, breached, offenders: [...offenders].sort((left, right) => right.durationMs - left.durationMs) })
  }
  if (rule.kind === 'duration') {
    const offenders = samples.filter(sample => sample.durationMs > rule.threshold).sort((left, right) => right.durationMs - left.durationMs)
    const value = count === 0 ? null : Math.max(...samples.map(sample => sample.durationMs))
    return measured({ value, count, breached: offenders.length > 0, offenders })
  }
  const value = rule.kind === 'throughput' ? count / rule.windowMinutes : count
  return measured({ value, count, breached: compare(rule, value, rule.threshold), offenders: samples })
}

/** ok → firing on the first breach; firing → ok only after {@link RESOLVE_AFTER_EVALUATIONS} clear evaluations in a row. */
const transition = (input: { readonly previous: AlertState; readonly measurement: AlertMeasurement; readonly now: number }): AlertTransition => {
  const { previous, measurement, now } = input
  const observed = { value: measurement.value, sampleCount: measurement.sampleCount, evaluatedAt: now }
  if (measurement.breached) {
    if (previous.status === 'firing') return { state: { ...previous, ...observed, clearEvaluations: 0 }, event: null }
    return { state: { status: 'firing', since: now, ...observed, clearEvaluations: 0 }, event: 'firing' }
  }
  if (previous.status === 'ok') return { state: { ...initialAlertState, ...observed }, event: null }
  const clearEvaluations = previous.clearEvaluations + 1
  if (clearEvaluations < RESOLVE_AFTER_EVALUATIONS) return { state: { ...previous, ...observed, clearEvaluations }, event: null }
  return { state: { ...initialAlertState, ...observed }, event: 'resolved' }
}

const isMuted = (rule: Pick<AlertRule, 'mutedUntil'>, now: number): boolean => rule.mutedUntil !== null && rule.mutedUntil > now

export class AlertEvaluator {
  static readonly measure = measure
  static readonly transition = transition
  static readonly isMuted = isMuted
}
