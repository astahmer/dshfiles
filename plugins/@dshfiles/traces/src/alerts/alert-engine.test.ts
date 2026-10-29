import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { afterEach, describe, expect, test } from 'vitest'
import type { NormalizedSpan } from '../otlp/normalize.js'
import { openTraceStore } from '../store.js'
import { ALERT_EVALUATION_SPAN, createAlertEngine, isRoutineAlertEvaluation } from './alert-engine.js'
import { MAX_ALERT_EVENTS, openAlertStore } from './alert-store.js'
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

const setup = (options: { readonly markThread?: (sessionId: string) => Promise<boolean> } = {}) => {
  const clock = { now: START }
  const traces = openTraceStore({ path: ':memory:', now: () => clock.now })
  const alerts = openAlertStore({ path: ':memory:', now: () => clock.now })
  for (const builtin of alerts.rules()) alerts.remove(builtin.id)
  const marked: string[] = []
  const running = new Set<string>()
  const engine = createAlertEngine({
    samples: traces,
    alerts,
    now: () => clock.now,
    runningSessionIds: () => running,
    markThread:
      options.markThread ??
      (sessionId => {
        marked.push(sessionId)
        return Promise.resolve(true)
      }),
  })
  return { clock, traces, alerts, engine, marked, running }
}

const failingMinute = (traces: ReturnType<typeof openTraceStore>, at: number): void => {
  traces.ingest(
    [
      span({ endMs: at - 1_000, error: true, sessionId: 'session-failing' }),
      span({ endMs: at - 2_000 }),
      span({ endMs: at - 3_000 }),
      span({ endMs: at - 4_000, name: 'chat other-model' }),
    ],
    retention,
  )
}

describe('alert engine', () => {
  test('counts only spans that ended inside the window', async () => {
    const { clock, traces, engine } = setup()
    engine.save({ ...errorRule, minSamples: 1 })
    traces.ingest([span({ endMs: clock.now - 11 * 60_000, error: true }), span({ endMs: clock.now - 60_000 })], retention)
    expect((await engine.evaluate()).firing).toBe(0)
    expect(engine.snapshot({ historyLimit: 10 }).rules[0]?.state).toMatchObject({ status: 'ok', value: 0, sampleCount: 1 })
  })

  test('a long span counts in the window it ended in even when it started before it', async () => {
    const { clock, traces, engine, running } = setup()
    engine.save({
      ...errorRule,
      name: 'Long turns',
      kind: 'duration',
      filter: { service: null, operation: 'invoke_agent*', attribute: null },
      threshold: 15 * 60_000,
    })
    traces.ingest([span({ endMs: clock.now - 60_000, durationMs: 20 * 60_000, name: 'invoke_agent deepseek', sessionId: 'session-slow' })], retention)
    expect((await engine.evaluate()).firing).toBe(0)
    expect(engine.snapshot({ historyLimit: 10 }).rules[0]?.state).toMatchObject({ status: 'ok', sampleCount: 0 })

    running.add('session-slow')
    expect((await engine.evaluate()).firing).toBe(1)
  })

  test('fires, marks the threads behind it, then resolves after two quiet evaluations', async () => {
    const { clock, traces, engine, marked } = setup()
    const saved = engine.save(errorRule)
    failingMinute(traces, clock.now)
    const fired = await engine.evaluate()
    expect(fired).toMatchObject({ evaluated: 1, transitions: 1, firing: 1 })
    const firing = engine.snapshot({ historyLimit: 10 })
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
    expect(marked).toEqual(['session-failing'])

    clock.now += 11 * 60_000
    expect((await engine.evaluate()).transitions).toBe(0)
    expect(engine.snapshot({ historyLimit: 10 }).rules[0]?.state).toMatchObject({ status: 'firing', clearEvaluations: 1 })
    clock.now += 60_000
    expect(await engine.evaluate()).toMatchObject({ transitions: 1, firing: 0 })
    expect(engine.snapshot({ historyLimit: 10 }).history.map(event => event.kind)).toEqual(['resolved', 'firing'])
    expect(marked).toEqual(['session-failing'])
  })

  test('a muted rule records its incident without announcing or marking threads', async () => {
    const { clock, traces, engine, marked } = setup()
    const saved = engine.save(errorRule)
    engine.mute({ id: saved.id, minutes: 60 })
    failingMinute(traces, clock.now)
    await engine.evaluate()
    expect(engine.snapshot({ historyLimit: 1 }).history[0]).toMatchObject({ kind: 'firing', muted: true, notify: false, threadsMarked: 0 })
    expect(marked).toEqual([])
    expect(engine.mute({ id: saved.id, minutes: null }).mutedUntil).toBeNull()
  })

  test('disabling or removing a firing rule resolves its incident', async () => {
    const { clock, traces, engine } = setup()
    const first = engine.save(errorRule)
    const second = engine.save({ ...errorRule, name: 'Second' })
    failingMinute(traces, clock.now)
    await engine.evaluate()
    engine.save({ ...errorRule, id: first.id, enabled: false })
    engine.remove(second.id)
    const snapshot = engine.snapshot({ historyLimit: 10 })
    expect(snapshot.firing).toBe(0)
    expect(snapshot.history.slice(0, 2).map(event => [event.ruleId, event.kind, event.reason])).toEqual([
      [second.id, 'resolved', 'removed'],
      [first.id, 'resolved', 'disabled'],
    ])
    expect(snapshot.rules.map(rule => rule.id)).toEqual([first.id])
  })

  test('says why no thread was marked when the attention owner is missing', async () => {
    const { clock, traces, engine } = setup({ markThread: () => Promise.resolve(false) })
    engine.save(errorRule)
    failingMinute(traces, clock.now)
    await engine.evaluate()
    expect(engine.snapshot({ historyLimit: 1 }).history[0]).toMatchObject({ threadsMarked: 0, deliveryError: expect.stringContaining('thread-sidebar') })
  })

  test('the feed returns events after an id, newest first', async () => {
    const { clock, traces, engine } = setup()
    engine.save(errorRule)
    expect(engine.feed({ afterId: null })).toEqual({ latestEventId: 0, firing: 0, events: [] })
    failingMinute(traces, clock.now)
    await engine.evaluate()
    const feed = engine.feed({ afterId: 0 })
    expect(feed).toMatchObject({ latestEventId: 1, firing: 1 })
    expect(feed.events.map(event => event.kind)).toEqual(['firing'])
    expect(engine.feed({ afterId: feed.latestEventId }).events).toEqual([])
  })

  test('records one evaluation span with its rule, transition and firing counts', async () => {
    const { clock, traces, engine } = setup()
    engine.save(errorRule)
    failingMinute(traces, clock.now)
    using recorder = recordSpans()
    await engine.evaluate()
    const evaluation = recorder.span(ALERT_EVALUATION_SPAN)
    expect(evaluation.attributes).toMatchObject({ 'dshx.traces.rules': 1, 'dshx.traces.transitions': 1, 'dshx.traces.firing': 1 })
    expect(isRoutineAlertEvaluation({ name: evaluation.name, statusCode: 0, attributes: evaluation.attributes })).toBe(false)
    expect(isRoutineAlertEvaluation({ name: ALERT_EVALUATION_SPAN, statusCode: 0, attributes: { 'dshx.traces.transitions': 0 } })).toBe(true)
    expect(isRoutineAlertEvaluation({ name: ALERT_EVALUATION_SPAN, statusCode: 2, attributes: { 'dshx.traces.transitions': 0 } })).toBe(false)
  })
})

describe('alert store', () => {
  const directories: string[] = []
  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
  })

  test('seeds the built-in rules once, so an edit or removal survives a reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'traces-alerts-'))
    directories.push(directory)
    const path = join(directory, 'alerts.db')
    const first = openAlertStore({ path })
    expect(first.rules().map(rule => [rule.id, rule.enabled, rule.builtin])).toEqual([
      ['builtin-model-errors', true, true],
      ['builtin-jj-latency', true, true],
      ['builtin-long-turn', true, true],
      ['builtin-plugin-api-errors', false, true],
    ])
    first.remove('builtin-jj-latency')
    const edited = first.rule('builtin-model-errors')
    first.save({ ...edited, threshold: 0.5 })
    first.close()
    const reopened = openAlertStore({ path })
    expect(reopened.rules().map(rule => rule.id)).toEqual(['builtin-model-errors', 'builtin-long-turn', 'builtin-plugin-api-errors'])
    expect(reopened.rule('builtin-model-errors').threshold).toBe(0.5)
    reopened.close()
  })

  test('keeps the newest 500 events', () => {
    expect(MAX_ALERT_EVENTS).toBe(500)
    const alerts = openAlertStore({ path: ':memory:' })
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
    for (let index = 0; index < MAX_ALERT_EVENTS + 25; index++) alerts.appendEvent(event)
    const history = alerts.history(MAX_ALERT_EVENTS + 100)
    expect(history).toHaveLength(MAX_ALERT_EVENTS)
    expect(history[0]?.id).toBe(MAX_ALERT_EVENTS + 25)
    expect(history.at(-1)?.id).toBe(26)
  })

  test('refuses an unknown rule and more than the rule limit', () => {
    const alerts = openAlertStore({ path: ':memory:' })
    expect(() => alerts.rule('rule-missing')).toThrow('No alert rule rule-missing.')
    for (let index = alerts.rules().length; index < 50; index++) alerts.save({ ...errorRule, name: `Rule ${String(index)}` })
    expect(() => alerts.save(errorRule)).toThrow('At most 50 alert rules are kept.')
  })
})
