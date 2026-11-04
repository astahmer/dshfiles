import { attentionApi, type AttentionDraft } from '@dshfiles/activity-timeline/attention-api'
import { DshxPlugin, HostEvents } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { Clock, Effect, Layer, Ref, Stream } from 'effect'
import { AlertEngine } from './alert-engine.js'
import { AlertEvaluator } from './alert-evaluator.js'
import type { AlertRuleView } from './alert-types.js'

/** The inbox source of alert rules that are firing now. */
export const ALERT_FIRING_SOURCE = 'traces.alert-firing'

/** The engine evaluates once a minute; reading its stored states twice a minute keeps the inbox one evaluation behind at most. */
const RECONCILE_INTERVAL = '30 seconds'

const clamp = (value: string, max: number): string => (value.length <= max ? value : `${value.slice(0, max - 1)}…`)

const number = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(value < 1 ? 3 : 1))

const measured = (rule: AlertRuleView): string => {
  const unit = rule.kind === 'latency' || rule.kind === 'duration' ? ' ms' : rule.kind === 'throughput' ? ' per minute' : ''
  const value = rule.state.value === null ? 'no matching spans' : `${number(rule.state.value)}${unit}`
  return `Last value ${value}, threshold ${rule.comparator} ${number(rule.threshold)}${unit}, over ${String(rule.windowMinutes)} min (${String(rule.state.sampleCount)} spans).`
}

/**
 * One firing, unmuted rule as a Failed item. Each incident is its own item (keyed by when it started firing), so a rule
 * that fires again shows again after the user marked the last incident done; a muted rule states nothing.
 */
const draftsOf = (rules: readonly AlertRuleView[], now: number): readonly AttentionDraft[] =>
  rules
    .filter(rule => rule.enabled && rule.state.status === 'firing' && !AlertEvaluator.isMuted(rule, now))
    .map(rule => ({
      dedupeKey: `${rule.id}:${String(rule.state.since ?? 0)}`,
      subject: { kind: 'url', id: clamp(`dsh-traces://alerts/${rule.id}`, 512), label: clamp(rule.name, 200) },
      reason: clamp(`Alert “${rule.name}” is firing (${rule.severity}).`, 500),
      detail: clamp(`${measured(rule)} Inspect it in Observe › Traces › Alerts, or mute the rule there while you fix the cause.`, 2000),
      severity: 'failed',
      verbs: ['Done', 'Snooze', 'MuteSource'],
    }))

const make = Effect.gen(function* () {
  const engine = yield* AlertEngine
  const apis = yield* HostApis
  const inbox = apis.client(attentionApi)
  /** What the inbox last accepted, so the routine pass writes (and leaves a span) only when the firing set changed. */
  const stated = yield* Ref.make<string | null>(null)

  const reconcile = Effect.fn('traces attention reconcile')(function* (items: readonly AttentionDraft[], key: string) {
    yield* Effect.annotateCurrentSpan({ 'attention.items': items.length })
    yield* inbox.reconcile({ source: ALERT_FIRING_SOURCE, items: [...items] })
    yield* Ref.set(stated, key)
  })

  const pass = (force: boolean) =>
    Effect.gen(function* () {
      if (!(yield* apis.isServed(attentionApi))) return
      const snapshot = yield* engine.snapshot({ historyLimit: 1 })
      const items = draftsOf(snapshot.rules, yield* Clock.currentTimeMillis)
      const key = JSON.stringify(items)
      if (!force && (yield* Ref.get(stated)) === key) return
      yield* reconcile(items, key)
    }).pipe(Effect.catchCause(cause => Effect.logWarning('traces: inbox reconcile failed', cause)))

  yield* Stream.mergeAll(
    [Stream.succeed(true), Stream.map(HostEvents.stream('dshfiles/attention/ready'), () => true), Stream.map(Stream.tick(RECONCILE_INTERVAL), () => false)],
    { concurrency: 'unbounded' },
  ).pipe(Stream.runForEach(pass), DshxPlugin.detached, Effect.forkScoped)
})

/** traces as an inbox provider: every firing, unmuted alert rule is a Failed item that resolves when the rule does. */
export class AlertAttention {
  static readonly layer = Layer.effectDiscard(make)
  static readonly draftsOf = draftsOf
}
