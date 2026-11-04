import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { afterEach, describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Ref, type Scope } from 'effect'
import { TestClock } from 'effect/testing'
import type { NormalizedSpan } from '../otlp/normalize.js'
import { AlertRepoTest, TraceRepoTest } from '../test-layers.test-support.js'
import { TraceRepo } from '../trace-repo.js'
import { ALERT_EVALUATION_SPAN, AlertEngine, isRoutineAlertEvaluation, RunningSessions, ThreadAttention } from './alert-engine.js'
import { AlertDb, AlertRepo, MAX_ALERT_EVENTS } from './alert-repo.js'
import type { AlertRuleDraft } from './alert-types.js'

const START = 1_700_000_000_000
const retention = { maxAgeHours: 24, maxSpans: 100_000, maxLogs: 1_000, maxMetricPoints: 1_000 }

const hex = (value: number, width: number): string => value.toString(16).padStart(width, '0')
let nextSpan = 1

const span = (input: {
  readonly endMs: number
  readonly durationMs?: number
  readonly name?: string
  readonly error?: boolean
  readonly sessionId?: string
}): NormalizedSpan => {
  const id = nextSpan++
  const endUs = input.endMs * 1000
  return {
    traceId: hex(id, 32),
    spanId: hex(id, 16),
    parentSpanId: null,
    name: input.name ?? 'chat fake-model',
    service: 'deepseek-harness',
    scope: null,
    kind: 1,
    startUs: endUs - (input.durationMs ?? 100) * 1000,
    endUs,
    statusCode: input.error === true ? 2 : 0,
    statusMessage: null,
    sessionId: input.sessionId ?? null,
    attributes: input.sessionId === undefined ? {} : { 'dsh.session.id': input.sessionId },
    resource: { 'service.name': 'deepseek-harness' },
    events: [],
    linkCount: 0,
  }
}

const errorRule: AlertRuleDraft = {
  name: 'Model errors',
  kind: 'error-rate',
  filter: { service: null, operation: 'chat *', attribute: null },
  windowMinutes: 10,
  threshold: 0.2,
  comparator: 'above',
  percentile: 95,
  minSamples: 4,
  severity: 'critical',
  enabled: true,
  notify: true,
  markThreads: true,
}

type Harness = {
  readonly engine: AlertEngine['Service']
  readonly traces: TraceRepo['Service']
  readonly marked: Ref.Ref<readonly string[]>
  readonly running: Set<string>
}

/** The engine over fresh in-memory stores without the built-in rules; thread attention and running agents stand in for thread-sidebar and the Host. */
const withEngine = <A, E>(body: (harness: Harness) => Effect.Effect<A, E, Scope.Scope>, options: { readonly attentionOwner?: boolean } = {}) =>
  Effect.gen(function* () {
    const marked = yield* Ref.make<readonly string[]>([])
    const running = new Set<string>()
    const edges = Layer.mergeAll(
      Layer.succeed(
        ThreadAttention,
        ThreadAttention.of({
          mark: sessionId =>
            options.attentionOwner === false
              ? Effect.succeed(false)
              : Effect.as(
                  Ref.update(marked, ids => [...ids, sessionId]),
                  true,
                ),
        }),
      ),
      Layer.succeed(RunningSessions, RunningSessions.of({ ids: Effect.sync(() => running) })),
    )
    yield* TestClock.setTime(START)
    return yield* Effect.gen(function* () {
      const alerts = yield* AlertRepo
      for (const builtin of yield* alerts.rules()) yield* alerts.remove(builtin.id)
      return yield* body({ engine: yield* AlertEngine, traces: yield* TraceRepo, marked, running })
    }).pipe(Effect.scoped, Effect.provide(AlertEngine.layer.pipe(Layer.provideMerge(Layer.mergeAll(AlertRepoTest, TraceRepoTest, edges)))))
  })

const failingMinute = (traces: TraceRepo['Service'], at: number) =>
  traces.ingestSpans(
    [
      span({ endMs: at - 1_000, error: true, sessionId: 'session-failing' }),
      span({ endMs: at - 2_000 }),
      span({ endMs: at - 3_000 }),
      span({ endMs: at - 4_000, name: 'chat other-model' }),
    ],
    retention,
  )

const firstRuleState = (engine: AlertEngine['Service']) => Effect.map(engine.snapshot({ historyLimit: 10 }), snapshot => snapshot.rules[0]?.state)

describe('alert engine', () => {
  it.effect('counts only spans that ended inside the window', () =>
    withEngine(
      Effect.fn(function* ({ engine, traces }) {
        yield* engine.save({ ...errorRule, minSamples: 1 })
        yield* traces.ingestSpans([span({ endMs: START - 11 * 60_000, error: true }), span({ endMs: START - 60_000 })], retention)
        expect((yield* engine.evaluate()).firing).toBe(0)
        expect(yield* firstRuleState(engine)).toMatchObject({ status: 'ok', value: 0, sampleCount: 1 })
      }),
    ),
  )

  it.effect('a long span counts in the window it ended in even when it started before it', () =>
    withEngine(
      Effect.fn(function* ({ engine, traces, running }) {
        yield* engine.save({
          ...errorRule,
          name: 'Long turns',
          kind: 'duration',
          filter: { service: null, operation: 'invoke_agent*', attribute: null },
          threshold: 15 * 60_000,
        })
        yield* traces.ingestSpans(
          [span({ endMs: START - 60_000, durationMs: 20 * 60_000, name: 'invoke_agent deepseek', sessionId: 'session-slow' })],
          retention,
        )
        expect((yield* engine.evaluate()).firing).toBe(0)
        expect(yield* firstRuleState(engine)).toMatchObject({ status: 'ok', sampleCount: 0 })
        running.add('session-slow')
        expect((yield* engine.evaluate()).firing).toBe(1)
      }),
    ),
  )

  it.effect('fires, marks the threads behind it, then resolves after two quiet evaluations', () =>
    withEngine(
      Effect.fn(function* ({ engine, traces, marked }) {
        const saved = yield* engine.save(errorRule)
        yield* failingMinute(traces, START)
        expect(yield* engine.evaluate()).toMatchObject({ evaluated: 1, transitions: 1, firing: 1 })
        const firing = yield* engine.snapshot({ historyLimit: 10 })
        expect(firing.rules[0]?.state).toMatchObject({ status: 'firing', value: 0.25, sampleCount: 4 })
        expect(firing.history[0]).toMatchObject({
          ruleId: saved.id,
          kind: 'firing',
          reason: 'threshold',
          severity: 'critical',
          sessionIds: ['session-failing'],
          muted: false,
          notify: true,
          threadsMarked: 1,
          deliveryError: null,
        })
        expect(yield* Ref.get(marked)).toEqual(['session-failing'])

        yield* TestClock.adjust(11 * 60_000)
        expect((yield* engine.evaluate()).transitions).toBe(0)
        expect(yield* firstRuleState(engine)).toMatchObject({ status: 'firing', clearEvaluations: 1 })
        yield* TestClock.adjust(60_000)
        expect(yield* engine.evaluate()).toMatchObject({ transitions: 1, firing: 0 })
        expect((yield* engine.snapshot({ historyLimit: 10 })).history.map(event => event.kind)).toEqual(['resolved', 'firing'])
        expect(yield* Ref.get(marked)).toEqual(['session-failing'])
      }),
    ),
  )

  it.effect('a muted rule records its incident without announcing or marking threads', () =>
    withEngine(
      Effect.fn(function* ({ engine, traces, marked }) {
        const saved = yield* engine.save(errorRule)
        yield* engine.mute({ id: saved.id, minutes: 60 })
        yield* failingMinute(traces, START)
        yield* engine.evaluate()
        expect((yield* engine.snapshot({ historyLimit: 1 })).history[0]).toMatchObject({ kind: 'firing', muted: true, notify: false, threadsMarked: 0 })
        expect(yield* Ref.get(marked)).toEqual([])
        expect((yield* engine.mute({ id: saved.id, minutes: null })).mutedUntil).toBeNull()
      }),
    ),
  )

  it.effect('disabling or removing a firing rule resolves its incident', () =>
    withEngine(
      Effect.fn(function* ({ engine, traces }) {
        const first = yield* engine.save(errorRule)
        const second = yield* engine.save({ ...errorRule, name: 'Second' })
        yield* failingMinute(traces, START)
        yield* engine.evaluate()
        yield* engine.save({ ...errorRule, id: first.id, enabled: false })
        yield* engine.remove(second.id)
        const snapshot = yield* engine.snapshot({ historyLimit: 10 })
        expect(snapshot.firing).toBe(0)
        expect(snapshot.history.slice(0, 2).map(event => [event.ruleId, event.kind, event.reason])).toEqual([
          [second.id, 'resolved', 'removed'],
          [first.id, 'resolved', 'disabled'],
        ])
        expect(snapshot.rules.map(rule => rule.id)).toEqual([first.id])
      }),
    ),
  )

  it.effect('says why no thread was marked when the attention owner is missing', () =>
    withEngine(
      Effect.fn(function* ({ engine, traces }) {
        yield* engine.save(errorRule)
        yield* failingMinute(traces, START)
        yield* engine.evaluate()
        expect((yield* engine.snapshot({ historyLimit: 1 })).history[0]).toMatchObject({
          threadsMarked: 0,
          deliveryError: expect.stringContaining('thread-sidebar'),
        })
      }),
      { attentionOwner: false },
    ),
  )

  it.effect('the feed returns events after an id, newest first', () =>
    withEngine(
      Effect.fn(function* ({ engine, traces }) {
        yield* engine.save(errorRule)
        expect(yield* engine.feed({ afterId: null })).toEqual({ latestEventId: 0, firing: 0, events: [] })
        yield* failingMinute(traces, START)
        yield* engine.evaluate()
        const feed = yield* engine.feed({ afterId: 0 })
        expect(feed).toMatchObject({ latestEventId: 1, firing: 1 })
        expect(feed.events.map(event => event.kind)).toEqual(['firing'])
        expect((yield* engine.feed({ afterId: feed.latestEventId })).events).toEqual([])
      }),
    ),
  )

  it.effect('a second evaluate while one runs shares that run', () =>
    withEngine(
      Effect.fn(function* ({ engine, traces }) {
        yield* engine.save(errorRule)
        yield* failingMinute(traces, START)
        const [first, second] = yield* Effect.all([engine.evaluate(), engine.evaluate()], { concurrency: 'unbounded' })
        expect(second).toEqual(first)
        expect((yield* engine.snapshot({ historyLimit: 10 })).history).toHaveLength(1)
      }),
    ),
  )

  it.effect('records one evaluation span with its rule, transition and firing counts, and no store spans', () =>
    withEngine(
      Effect.fn(function* ({ engine, traces }) {
        yield* engine.save(errorRule)
        yield* failingMinute(traces, START)
        const recorder = yield* Effect.acquireRelease(
          Effect.sync(() => recordSpans()),
          recording => Effect.sync(() => recording[Symbol.dispose]()),
        )
        yield* engine.evaluate().pipe(Effect.provide(DshxEffect.tracerLayer))
        const evaluation = recorder.span(ALERT_EVALUATION_SPAN)
        expect(evaluation.attributes).toMatchObject({ 'dshx.traces.rules': 1, 'dshx.traces.transitions': 1, 'dshx.traces.firing': 1 })
        expect(recorder.spans.filter(recorded => recorded.name.startsWith('alert repo') || recorded.name.startsWith('trace repo'))).toEqual([])
        expect(isRoutineAlertEvaluation({ name: evaluation.name, statusCode: 0, attributes: evaluation.attributes })).toBe(false)
        expect(isRoutineAlertEvaluation({ name: ALERT_EVALUATION_SPAN, statusCode: 0, attributes: { 'dshx.traces.transitions': 0 } })).toBe(true)
        expect(isRoutineAlertEvaluation({ name: ALERT_EVALUATION_SPAN, statusCode: 2, attributes: { 'dshx.traces.transitions': 0 } })).toBe(false)
      }),
    ),
  )
})

describe('alert repo', () => {
  const directories: string[] = []
  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  const onFile = (path: string) =>
    AlertRepo.layer.pipe(Layer.provide(AlertDb.layerAt(path)), Layer.provide(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)))

  it.effect('seeds the built-in rules once, so an edit or removal survives a reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'traces-alerts-'))
    directories.push(directory)
    const path = join(directory, 'alerts.db')
    return Effect.gen(function* () {
      yield* Effect.gen(function* () {
        const first = yield* AlertRepo
        expect((yield* first.rules()).map(rule => [rule.id, rule.enabled, rule.builtin])).toEqual([
          ['builtin-model-errors', true, true],
          ['builtin-jj-latency', true, true],
          ['builtin-long-turn', true, true],
          ['builtin-plugin-api-errors', false, true],
        ])
        yield* first.remove('builtin-jj-latency')
        const edited = yield* first.rule('builtin-model-errors')
        yield* first.save({ ...edited, threshold: 0.5 })
      }).pipe(Effect.provide(onFile(path)))
      yield* Effect.gen(function* () {
        const reopened = yield* AlertRepo
        expect((yield* reopened.rules()).map(rule => rule.id)).toEqual(['builtin-model-errors', 'builtin-long-turn', 'builtin-plugin-api-errors'])
        expect((yield* reopened.rule('builtin-model-errors')).threshold).toBe(0.5)
      }).pipe(Effect.provide(onFile(path)))
    })
  })

  it.effect('keeps the newest 500 events', () =>
    Effect.gen(function* () {
      expect(MAX_ALERT_EVENTS).toBe(500)
      const alerts = yield* AlertRepo
      const event = {
        ruleId: 'rule-x',
        ruleName: 'X',
        severity: 'info' as const,
        kind: 'firing' as const,
        reason: 'threshold' as const,
        at: 1,
        value: 1,
        threshold: 0,
        sampleCount: 1,
        sessionIds: [],
        sampleTraceId: null,
        muted: false,
        notify: true,
        threadsMarked: 0,
        deliveryError: null,
      }
      for (let index = 0; index < MAX_ALERT_EVENTS + 25; index++) yield* alerts.appendEvent(event)
      const history = yield* alerts.history(MAX_ALERT_EVENTS + 100)
      expect(history).toHaveLength(MAX_ALERT_EVENTS)
      expect(history[0]?.id).toBe(MAX_ALERT_EVENTS + 25)
      expect(history.at(-1)?.id).toBe(26)
    }).pipe(Effect.provide(AlertRepoTest)),
  )

  it.effect('refuses an unknown rule and more than the rule limit', () =>
    Effect.gen(function* () {
      const alerts = yield* AlertRepo
      expect(yield* Effect.flip(alerts.rule('rule-missing'))).toMatchObject({ _tag: 'AlertRuleNotFound', message: 'No alert rule rule-missing.' })
      for (let index = (yield* alerts.rules()).length; index < 50; index++) yield* alerts.save({ ...errorRule, name: `Rule ${String(index)}` })
      expect(yield* Effect.flip(alerts.save(errorRule))).toMatchObject({ _tag: 'AlertRuleLimitReached', message: 'At most 50 alert rules are kept.' })
    }).pipe(Effect.provide(AlertRepoTest)),
  )
})
