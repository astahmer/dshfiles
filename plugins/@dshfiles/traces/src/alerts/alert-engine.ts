import { pluginAttributes, withSpan } from '@dshfiles/dshx/tracing'
import type { SpanSample, SpanSampleQuery } from '../store.js'
import { AlertEvaluator, initialAlertState, type AlertMeasurement } from './alert-evaluator.js'
import type { AlertStore } from './alert-store.js'
import type { AlertEvent, AlertFeed, AlertRule, AlertRuleDraft, AlertsSnapshot, EvaluationSummary } from './alert-types.js'

export const ALERT_EVALUATION_SPAN = 'traces alerts evaluate'
export const ALERT_INTERVAL_SECONDS = 60

const MAX_SAMPLES_PER_RULE = 20_000
const MAX_MARKED_THREADS = 5
const FEED_LIMIT = 20

/** Marks one thread for the user's attention; resolves false when no attention owner is loaded, throws when it fails. */
export type MarkThread = (sessionId: string) => Promise<boolean>

type SampleSource = { readonly spanSamples: (query: SpanSampleQuery) => { readonly samples: readonly SpanSample[]; readonly truncated: boolean } }

/** A routine evaluation (nothing changed, nothing failed) is not stored by this receiver: one span a minute would bury real traces. */
export const isRoutineAlertEvaluation = (span: {
  readonly name: string
  readonly statusCode: number
  readonly attributes: Readonly<Record<string, string | number | boolean | readonly (string | number | boolean)[]>>
}): boolean => span.name === ALERT_EVALUATION_SPAN && span.statusCode !== 2 && span.attributes['dshx.traces.transitions'] === 0

export type AlertEngine = ReturnType<typeof createAlertEngine>

export const createAlertEngine = (options: {
  readonly samples: SampleSource
  readonly alerts: AlertStore
  readonly markThread: MarkThread
  readonly now?: () => number
}) => {
  const now = options.now ?? Date.now
  const alerts = options.alerts
  let lastEvaluatedAt: number | null = null
  let running: Promise<EvaluationSummary> | null = null

  const measureRule = (rule: AlertRule, at: number): AlertMeasurement => {
    const { samples } = options.samples.spanSamples({
      endedAfterMs: at - rule.windowMinutes * 60_000,
      service: rule.filter.service,
      operation: rule.filter.operation,
      attribute: rule.filter.attribute,
      limit: MAX_SAMPLES_PER_RULE,
    })
    return AlertEvaluator.measure(rule, samples)
  }

  const deliver = async (
    rule: AlertRule,
    sessionIds: readonly string[],
  ): Promise<{ readonly threadsMarked: number; readonly deliveryError: string | null }> => {
    if (!rule.markThreads || sessionIds.length === 0) return { threadsMarked: 0, deliveryError: null }
    let threadsMarked = 0
    let deliveryError: string | null = null
    for (const sessionId of sessionIds.slice(0, MAX_MARKED_THREADS)) {
      try {
        if (await options.markThread(sessionId)) threadsMarked += 1
        else deliveryError = 'No thread attention owner (@dshfiles/thread-sidebar) is loaded.'
      } catch (error) {
        deliveryError = error instanceof Error ? error.message.slice(0, 200) : 'Marking the thread failed.'
      }
    }
    return { threadsMarked, deliveryError }
  }

  const record = (input: {
    readonly rule: AlertRule
    readonly kind: AlertEvent['kind']
    readonly reason: AlertEvent['reason']
    readonly at: number
    readonly measurement: Pick<AlertMeasurement, 'value' | 'sampleCount' | 'sessionIds' | 'sampleTraceId'>
    readonly delivery: { readonly threadsMarked: number; readonly deliveryError: string | null }
  }): AlertEvent => {
    const muted = AlertEvaluator.isMuted(input.rule, input.at)
    return alerts.appendEvent({
      ruleId: input.rule.id,
      ruleName: input.rule.name,
      severity: input.rule.severity,
      kind: input.kind,
      reason: input.reason,
      at: input.at,
      value: input.measurement.value,
      threshold: input.rule.threshold,
      sampleCount: input.measurement.sampleCount,
      sessionIds: [...input.measurement.sessionIds],
      sampleTraceId: input.measurement.sampleTraceId,
      muted,
      notify: input.rule.notify && !muted,
      threadsMarked: input.delivery.threadsMarked,
      deliveryError: input.delivery.deliveryError,
    })
  }

  const evaluateRules = async (): Promise<EvaluationSummary> => {
    const at = now()
    const enabled = alerts.rules().filter(rule => rule.enabled)
    const states = alerts.states()
    let transitions = 0
    let firing = 0
    for (const rule of enabled) {
      const measurement = measureRule(rule, at)
      const next = AlertEvaluator.transition({ previous: states.get(rule.id) ?? initialAlertState, measurement, now: at })
      alerts.writeState(rule.id, next.state)
      if (next.state.status === 'firing') firing += 1
      if (next.event === null) continue
      transitions += 1
      const delivery =
        next.event === 'firing' && !AlertEvaluator.isMuted(rule, at) ? await deliver(rule, measurement.sessionIds) : { threadsMarked: 0, deliveryError: null }
      record({ rule, kind: next.event, reason: 'threshold', at, measurement, delivery })
    }
    lastEvaluatedAt = at
    return { evaluatedAt: at, evaluated: enabled.length, transitions, firing }
  }

  /** One evaluation at a time: a click on Evaluate now during the timer's run shares that run. */
  const evaluate = (): Promise<EvaluationSummary> => {
    if (running !== null) return running
    const started = withSpan(ALERT_EVALUATION_SPAN, async span => {
      const summary = await evaluateRules()
      span.setAttributes(
        pluginAttributes({ plugin: 'traces', attributes: { rules: summary.evaluated, transitions: summary.transitions, firing: summary.firing } }),
      )
      return summary
    }).finally(() => {
      running = null
    })
    running = started
    return started
  }

  /** Taking a firing rule out of evaluation closes its incident, so history never shows an alert that fires forever. */
  const closeIncident = (rule: AlertRule, reason: 'disabled' | 'removed'): void => {
    const state = alerts.stateOf(rule.id)
    alerts.clearState(rule.id)
    if (state.status !== 'firing') return
    record({
      rule,
      kind: 'resolved',
      reason,
      at: now(),
      measurement: { value: state.value, sampleCount: state.sampleCount, sessionIds: [], sampleTraceId: null },
      delivery: { threadsMarked: 0, deliveryError: null },
    })
  }

  const save = (draft: AlertRuleDraft): AlertRule => {
    const saved = alerts.save(draft)
    if (!saved.enabled) closeIncident(saved, 'disabled')
    return saved
  }

  const remove = (id: string): AlertRule => {
    const removed = alerts.rule(id)
    closeIncident(removed, 'removed')
    return alerts.remove(id)
  }

  const mute = (input: { readonly id: string; readonly minutes: number | null }): AlertRule =>
    alerts.setMutedUntil(input.id, input.minutes === null ? null : now() + input.minutes * 60_000)

  const snapshot = (input: { readonly historyLimit: number }): AlertsSnapshot => {
    const states = alerts.states()
    const rules = alerts.rules().map(rule => ({ ...rule, state: rule.enabled ? (states.get(rule.id) ?? initialAlertState) : initialAlertState }))
    return {
      rules,
      firing: rules.filter(rule => rule.state.status === 'firing').length,
      history: alerts.history(input.historyLimit),
      latestEventId: alerts.latestEventId(),
      lastEvaluatedAt,
      intervalSeconds: ALERT_INTERVAL_SECONDS,
    }
  }

  const feed = (input: { readonly afterId: number | null }): AlertFeed => {
    const states = alerts.states()
    return {
      latestEventId: alerts.latestEventId(),
      firing: alerts.rules().filter(rule => rule.enabled && states.get(rule.id)?.status === 'firing').length,
      events: input.afterId === null ? [] : alerts.eventsAfter(input.afterId, FEED_LIMIT),
    }
  }

  return { evaluate, save, remove, mute, snapshot, feed }
}
