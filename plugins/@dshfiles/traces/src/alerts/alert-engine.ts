import { pluginAttributes } from '@dshfiles/dshx/tracing'
import { Clock, Context, Deferred, Effect, Layer, Option, Ref, Schema } from 'effect'
import { TraceRepo } from '../trace-repo.js'
import { AlertEvaluator, initialAlertState, type AlertMeasurement } from './alert-evaluator.js'
import { AlertRepo, type AlertRuleLimitReached, type AlertRuleNotFound } from './alert-repo.js'
import type { AlertEvent, AlertFeed, AlertRule, AlertRuleDraft, AlertsSnapshot, EvaluationSummary } from './alert-types.js'

export const ALERT_EVALUATION_SPAN = 'traces alerts evaluate'
export const ALERT_INTERVAL_SECONDS = 60

const MAX_SAMPLES_PER_RULE = 20_000
const MAX_MARKED_THREADS = 5
const FEED_LIMIT = 20

/** A routine evaluation (nothing changed, nothing failed) is not stored by this receiver: one span a minute would bury real traces. */
export const isRoutineAlertEvaluation = (span: {
  readonly name: string
  readonly statusCode: number
  readonly attributes: Readonly<Record<string, string | number | boolean | readonly (string | number | boolean)[]>>
}): boolean => span.name === ALERT_EVALUATION_SPAN && span.statusCode !== 2 && span.attributes['dshx.traces.transitions'] === 0

export class ThreadMarkFailed extends Schema.TaggedError<ThreadMarkFailed>()('ThreadMarkFailed', {
  sessionId: Schema.String,
  reason: Schema.String,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.reason
  }
}

/** Marks one thread for the user's attention; false when no attention owner (@dshfiles/thread-sidebar) is loaded. */
export class ThreadAttention extends Context.Service<ThreadAttention, { readonly mark: (sessionId: string) => Effect.Effect<boolean, ThreadMarkFailed> }>()(
  '@dshfiles/traces/ThreadAttention',
) {}

/** Sessions whose agent turn runs now: a long-turn rule only counts those. */
export class RunningSessions extends Context.Service<RunningSessions, { readonly ids: Effect.Effect<ReadonlySet<string>> }>()(
  '@dshfiles/traces/RunningSessions',
) {}

type EvaluationRun = Deferred.Deferred<EvaluationSummary>

type Delivery = { readonly threadsMarked: number; readonly deliveryError: string | null }
const noDelivery: Delivery = { threadsMarked: 0, deliveryError: null }

export class AlertEngine extends Context.Service<
  AlertEngine,
  {
    readonly evaluate: () => Effect.Effect<EvaluationSummary>
    readonly save: (draft: AlertRuleDraft) => Effect.Effect<AlertRule, AlertRuleNotFound | AlertRuleLimitReached>
    readonly remove: (id: string) => Effect.Effect<AlertRule, AlertRuleNotFound>
    readonly mute: (input: { readonly id: string; readonly minutes: number | null }) => Effect.Effect<AlertRule, AlertRuleNotFound>
    readonly snapshot: (input: { readonly historyLimit: number }) => Effect.Effect<AlertsSnapshot>
    readonly feed: (input: { readonly afterId: number | null }) => Effect.Effect<AlertFeed>
  }
>()('@dshfiles/traces/AlertEngine') {
  static readonly layer = Layer.effect(
    AlertEngine,
    Effect.gen(function* () {
      const alerts = yield* AlertRepo
      const traces = yield* TraceRepo
      const attention = yield* ThreadAttention
      const running = yield* RunningSessions
      const lastEvaluatedAt = yield* Ref.make<number | null>(null)
      const inFlight = yield* Ref.make(Option.none<EvaluationRun>())
      const scope = yield* Effect.scope

      const measureRule = Effect.fnUntraced(function* (rule: AlertRule, at: number) {
        const { samples } = yield* traces.spanSamples({
          endedAfterMs: at - rule.windowMinutes * 60_000,
          service: rule.filter.service,
          operation: rule.filter.operation,
          attribute: rule.filter.attribute,
          limit: MAX_SAMPLES_PER_RULE,
        })
        if (rule.kind !== 'duration' || rule.filter.operation?.startsWith('invoke_agent') !== true) return AlertEvaluator.measure(rule, samples)
        const runningSessionIds = yield* running.ids
        return AlertEvaluator.measure(
          rule,
          samples.filter(sample => sample.sessionId !== null && runningSessionIds.has(sample.sessionId)),
        )
      })

      const deliver = Effect.fnUntraced(function* (rule: AlertRule, sessionIds: readonly string[]) {
        if (!rule.markThreads || sessionIds.length === 0) return noDelivery
        let threadsMarked = 0
        let deliveryError: string | null = null
        for (const sessionId of sessionIds.slice(0, MAX_MARKED_THREADS)) {
          const marked = yield* Effect.result(attention.mark(sessionId))
          if (marked._tag === 'Failure') deliveryError = marked.failure.message.slice(0, 200)
          else if (marked.success) threadsMarked += 1
          else deliveryError = 'No thread attention owner (@dshfiles/thread-sidebar) is loaded.'
        }
        return { threadsMarked, deliveryError } satisfies Delivery
      })

      const record = Effect.fnUntraced(function* (input: {
        readonly rule: AlertRule
        readonly kind: AlertEvent['kind']
        readonly reason: AlertEvent['reason']
        readonly at: number
        readonly measurement: Pick<AlertMeasurement, 'value' | 'sampleCount' | 'sessionIds' | 'sampleTraceId'>
        readonly delivery: Delivery
      }) {
        const muted = AlertEvaluator.isMuted(input.rule, input.at)
        return yield* alerts.appendEvent({
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
      })

      const evaluateRules = Effect.gen(function* () {
        const at = yield* Clock.currentTimeMillis
        const enabled = (yield* alerts.rules()).filter(rule => rule.enabled)
        const states = yield* alerts.states()
        let transitions = 0
        let firing = 0
        for (const rule of enabled) {
          const measurement = yield* measureRule(rule, at)
          const next = AlertEvaluator.transition({ previous: states.get(rule.id) ?? initialAlertState, measurement, now: at })
          yield* alerts.writeState(rule.id, next.state)
          if (next.state.status === 'firing') firing += 1
          if (next.event === null) continue
          transitions += 1
          const delivery = next.event === 'firing' && !AlertEvaluator.isMuted(rule, at) ? yield* deliver(rule, measurement.sessionIds) : noDelivery
          yield* record({ rule, kind: next.event, reason: 'threshold', at, measurement, delivery })
        }
        yield* Ref.set(lastEvaluatedAt, at)
        return { evaluatedAt: at, evaluated: enabled.length, transitions, firing } satisfies EvaluationSummary
      })

      // The store and attention calls stay out of the trace: a routine run must leave only its own span, which the receiver drops.
      const evaluateOnce = Effect.fn(ALERT_EVALUATION_SPAN)(function* () {
        const summary = yield* Effect.withTracerEnabled(evaluateRules, false)
        yield* Effect.annotateCurrentSpan(
          pluginAttributes({ plugin: 'traces', attributes: { rules: summary.evaluated, transitions: summary.transitions, firing: summary.firing } }),
        )
        return summary
      })

      /** One evaluation at a time: a click on Evaluate now during the timer's run shares that run. */
      const evaluate = Effect.fn('alert engine evaluate')(function* () {
        const fresh = yield* Deferred.make<EvaluationSummary>()
        const claim = (current: Option.Option<EvaluationRun>): readonly [readonly [EvaluationRun, boolean], Option.Option<EvaluationRun>] =>
          Option.isSome(current) ? [[current.value, false], current] : [[fresh, true], Option.some(fresh)]
        const [run, started] = yield* Ref.modify(inFlight, claim)
        if (started)
          yield* Effect.forkIn(
            Effect.onExit(evaluateOnce(), exit => Effect.andThen(Ref.set(inFlight, Option.none()), Deferred.done(run, exit))),
            scope,
          )
        return yield* Deferred.await(run)
      })

      /** Taking a firing rule out of evaluation closes its incident, so history never shows an alert that fires forever. */
      const closeIncident = Effect.fnUntraced(function* (rule: AlertRule, reason: 'disabled' | 'removed') {
        const state = yield* alerts.stateOf(rule.id)
        yield* alerts.clearState(rule.id)
        if (state.status !== 'firing') return
        yield* record({
          rule,
          kind: 'resolved',
          reason,
          at: yield* Clock.currentTimeMillis,
          measurement: { value: state.value, sampleCount: state.sampleCount, sessionIds: [], sampleTraceId: null },
          delivery: noDelivery,
        })
      })

      const save = Effect.fn('alert engine save')(function* (draft: AlertRuleDraft) {
        const saved = yield* alerts.save(draft)
        if (!saved.enabled) yield* closeIncident(saved, 'disabled')
        return saved
      })

      const remove = Effect.fn('alert engine remove')(function* (id: string) {
        const removed = yield* alerts.rule(id)
        yield* closeIncident(removed, 'removed')
        return yield* alerts.remove(id)
      })

      const mute = Effect.fn('alert engine mute')(function* (input: { readonly id: string; readonly minutes: number | null }) {
        const now = yield* Clock.currentTimeMillis
        return yield* alerts.setMutedUntil(input.id, input.minutes === null ? null : now + input.minutes * 60_000)
      })

      const snapshot = Effect.fn('alert engine snapshot')(function* (input: { readonly historyLimit: number }) {
        const states = yield* alerts.states()
        const rules = (yield* alerts.rules()).map(rule => ({ ...rule, state: rule.enabled ? (states.get(rule.id) ?? initialAlertState) : initialAlertState }))
        return {
          rules,
          firing: rules.filter(rule => rule.state.status === 'firing').length,
          history: yield* alerts.history(input.historyLimit),
          latestEventId: yield* alerts.latestEventId(),
          lastEvaluatedAt: yield* Ref.get(lastEvaluatedAt),
          intervalSeconds: ALERT_INTERVAL_SECONDS,
        } satisfies AlertsSnapshot
      })

      const feed = Effect.fn('alert engine feed')(function* (input: { readonly afterId: number | null }) {
        const states = yield* alerts.states()
        return {
          latestEventId: yield* alerts.latestEventId(),
          firing: (yield* alerts.rules()).filter(rule => rule.enabled && states.get(rule.id)?.status === 'firing').length,
          events: input.afterId === null ? [] : yield* alerts.eventsAfter(input.afterId, FEED_LIMIT),
        } satisfies AlertFeed
      })

      return AlertEngine.of({ evaluate, save, remove, mute, snapshot, feed })
    }),
  )
}
