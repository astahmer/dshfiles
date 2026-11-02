import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { TestClock } from 'effect/testing'
import type { NormalizedLog, NormalizedMetricPoint, NormalizedSpan } from './otlp/normalize.js'
import { TraceRepoTest } from './test-layers.test-support.js'
import { TraceRepo, type LogSearchQuery, type TraceListQuery } from './trace-repo.js'

const NOW = 1_700_000_000_000
const retention = { maxAgeHours: 24, maxSpans: 10_000, maxLogs: 10_000, maxMetricPoints: 10_000 }

const traceId = (index: number): string => index.toString(16).padStart(32, '0')
const spanId = (index: number): string => index.toString(16).padStart(16, '0')

const makeSpan = (overrides: Partial<NormalizedSpan> & Pick<NormalizedSpan, 'traceId' | 'spanId'>): NormalizedSpan => ({
  parentSpanId: null,
  name: 'op',
  service: 'svc',
  scope: null,
  kind: 1,
  startUs: (NOW - 1_000) * 1000,
  endUs: (NOW - 1_000) * 1000 + 5_000,
  statusCode: 0,
  statusMessage: null,
  sessionId: null,
  attributes: {},
  resource: { 'service.name': 'svc' },
  events: [],
  linkCount: 0,
  ...overrides,
})

/** A fresh in-memory store with the clock at NOW. */
const withRepo = <A, E>(body: (repo: TraceRepo['Service']) => Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW)
    return yield* body(yield* TraceRepo)
  }).pipe(Effect.provide(TraceRepoTest))

const seedCheckout = (repo: TraceRepo['Service']) =>
  repo.ingestSpans(
    [
      makeSpan({ traceId: traceId(1), spanId: spanId(1), name: 'GET /checkout', service: 'web', kind: 2, startUs: 1_000_000, endUs: 1_100_000 }),
      makeSpan({
        traceId: traceId(1),
        spanId: spanId(2),
        parentSpanId: spanId(1),
        name: 'SELECT orders',
        service: 'db',
        startUs: 1_010_000,
        endUs: 1_090_000,
        statusCode: 2,
        statusMessage: 'timeout after 80 ms',
        attributes: { 'db.statement.kind': 'select' },
        sessionId: 'session-a',
      }),
      makeSpan({ traceId: traceId(2), spanId: spanId(3), name: 'GET /health', service: 'web', startUs: 2_000_000, endUs: 2_001_000 }),
    ],
    retention,
  )

const logOf = (overrides: Partial<NormalizedLog> & Pick<NormalizedLog, 'timeUs' | 'body'>): NormalizedLog => ({
  severityNumber: 9,
  severityText: null,
  service: 'web',
  scope: null,
  traceId: null,
  spanId: null,
  eventName: null,
  attributes: {},
  resource: {},
  ...overrides,
})

describe('trace repo', () => {
  it.effect('lists traces newest first with root, duration, counts, services and session', () =>
    withRepo(
      Effect.fn(function* (repo) {
        yield* seedCheckout(repo)
        const { traces, nextCursor } = yield* repo.list({})
        expect(nextCursor).toBeNull()
        expect(traces.map(trace => trace.rootName)).toEqual(['GET /health', 'GET /checkout'])
        expect(traces[1]).toEqual({
          traceId: traceId(1),
          rootName: 'GET /checkout',
          rootService: 'web',
          startMs: 1_000,
          durationMs: 100,
          spanCount: 2,
          errorCount: 1,
          services: ['db', 'web'],
          sessionId: 'session-a',
          costUsd: null,
        })
      }),
    ),
  )

  it.effect('filters by service, operation, status, duration, time, text and session', () =>
    withRepo(
      Effect.fn(function* (repo) {
        yield* seedCheckout(repo)
        const ids = (query: TraceListQuery) => Effect.map(repo.list(query), list => list.traces.map(trace => trace.traceId))
        expect(yield* ids({ service: 'db' })).toEqual([traceId(1)])
        expect(yield* ids({ operation: 'GET /health' })).toEqual([traceId(2)])
        expect(yield* ids({ status: 'error' })).toEqual([traceId(1)])
        expect(yield* ids({ status: 'ok' })).toEqual([traceId(2)])
        expect(yield* ids({ minDurationMs: 50 })).toEqual([traceId(1)])
        expect(yield* ids({ fromMs: 1_500 })).toEqual([traceId(2)])
        expect(yield* ids({ toMs: 1_500 })).toEqual([traceId(1)])
        expect(yield* ids({ search: 'select' })).toEqual([traceId(1)])
        expect(yield* ids({ search: '100%' })).toEqual([])
        expect(yield* ids({ search: traceId(2) })).toEqual([traceId(2)])
        expect(yield* ids({ sessionId: 'session-a' })).toEqual([traceId(1)])
      }),
    ),
  )

  it.effect('pages with a cursor and rejects a forged one', () =>
    withRepo(
      Effect.fn(function* (repo) {
        yield* repo.ingestSpans(
          Array.from({ length: 5 }, (_, index) => makeSpan({ traceId: traceId(index + 1), spanId: spanId(index + 1), startUs: (index + 1) * 1_000_000 })),
          retention,
        )
        const first = yield* repo.list({ limit: 2 })
        const second = yield* repo.list({ limit: 2, cursor: first.nextCursor ?? undefined })
        const third = yield* repo.list({ limit: 2, cursor: second.nextCursor ?? undefined })
        expect([...first.traces, ...second.traces, ...third.traces].map(trace => trace.traceId)).toEqual([5, 4, 3, 2, 1].map(traceId))
        expect(third.nextCursor).toBeNull()
        const forged = yield* Effect.flip(repo.list({ cursor: "1:'; DROP TABLE spans" }))
        expect(forged).toMatchObject({ _tag: 'InvalidCursor', message: 'The traces cursor is invalid.' })
      }),
    ),
  )

  it.effect('returns one trace as a depth-first tree with offsets and resource attributes', () =>
    withRepo(
      Effect.fn(function* (repo) {
        yield* seedCheckout(repo)
        const detail = yield* repo.trace(traceId(1).toUpperCase())
        expect(detail).toMatchObject({ traceId: traceId(1), startMs: 1_000, durationMs: 100 })
        expect(detail.spans.map(span => [span.name, span.depth, span.offsetMs, span.durationMs, span.status])).toEqual([
          ['GET /checkout', 0, 0, 100, 'unset'],
          ['SELECT orders', 1, 10, 80, 'error'],
        ])
        expect(detail.spans[0]?.kind).toBe('server')
        expect(detail.spans[1]?.resource).toEqual({ 'service.name': 'svc' })
        const missing = yield* Effect.flip(repo.trace(traceId(9)))
        expect(missing).toMatchObject({ _tag: 'TraceNotFound', message: `No stored trace ${traceId(9)}.` })
      }),
    ),
  )

  it.effect('summarizes services and operations over a window', () =>
    withRepo(
      Effect.fn(function* (repo) {
        yield* repo.ingestSpans(
          Array.from({ length: 10 }, (_, index) =>
            makeSpan({
              traceId: traceId(index + 1),
              spanId: spanId(index + 1),
              name: 'GET /items',
              startUs: (NOW - 60_000) * 1000,
              endUs: (NOW - 60_000) * 1000 + (index + 1) * 1000,
              statusCode: index === 9 ? 2 : 0,
            }),
          ),
          retention,
        )
        yield* repo.ingestSpans([makeSpan({ traceId: traceId(99), spanId: spanId(99), name: 'old', startUs: (NOW - 7_200_000) * 1000 })], retention)
        const stats = yield* repo.stats({ windowMinutes: 60, limit: 10 })
        expect(stats.spans).toBe(10)
        expect(stats.operations).toEqual([
          { service: 'svc', name: 'GET /items', count: 10, errorCount: 1, errorRate: 0.1, p50Ms: 5, p95Ms: 10, p99Ms: 10, maxMs: 10 },
        ])
        expect(stats.services[0]).toMatchObject({ service: 'svc', count: 10 })
      }),
    ),
  )

  it.effect('groups errors by service, operation, type and message shape', () =>
    withRepo(
      Effect.fn(function* (repo) {
        const failing = (index: number, message: string, errorType?: string) =>
          makeSpan({
            traceId: traceId(index),
            spanId: spanId(index),
            name: 'query',
            startUs: (NOW - 1_000 * index) * 1000,
            statusCode: 2,
            statusMessage: message,
            attributes: errorType === undefined ? {} : { 'error.type': errorType },
          })
        yield* repo.ingestSpans(
          [failing(1, 'timeout after 80 ms', 'Timeout'), failing(2, 'timeout after 95 ms', 'Timeout'), failing(3, 'constraint failed')],
          retention,
        )
        const groups = yield* repo.errorGroups({ windowMinutes: 60, limit: 10 })
        expect(groups.map(group => [group.errorType, group.count, group.sampleTraceId])).toEqual([
          ['Timeout', 2, traceId(1)],
          [null, 1, traceId(3)],
        ])
      }),
    ),
  )

  it.effect('drops whole traces past the age and span limits, and clears everything', () =>
    withRepo(
      Effect.fn(function* (repo) {
        expect(yield* repo.prune(retention)).toBe(0)
        yield* repo.ingestSpans(
          [makeSpan({ traceId: traceId(1), spanId: spanId(1) }), makeSpan({ traceId: traceId(1), spanId: spanId(2), parentSpanId: spanId(1) })],
          retention,
        )
        yield* TestClock.adjust(1_000)
        yield* repo.ingestSpans([makeSpan({ traceId: traceId(2), spanId: spanId(3) })], retention)
        yield* TestClock.adjust(1_000)
        const pruned = yield* repo.ingestSpans([makeSpan({ traceId: traceId(3), spanId: spanId(4) })], {
          maxAgeHours: 24,
          maxSpans: 2,
          maxLogs: 10_000,
          maxMetricPoints: 10_000,
        })
        expect(pruned.prunedTraces).toBe(1)
        expect((yield* repo.list({})).traces.map(trace => trace.traceId)).toEqual([traceId(3), traceId(2)])
        yield* TestClock.adjust(25 * 3_600_000)
        expect(yield* repo.prune(retention)).toBe(2)
        expect(yield* repo.summary()).toMatchObject({ spans: 0, traces: 0 })
        yield* repo.ingestSpans([makeSpan({ traceId: traceId(4), spanId: spanId(5) })], retention)
        expect(yield* repo.clear()).toEqual({ removedSpans: 1, removedTraces: 1, removedLogs: 0, removedMetricPoints: 0 })
        expect(yield* repo.summary()).toEqual({ spans: 0, traces: 0, logs: 0, metricPoints: 0, oldestMs: null, newestMs: null })
      }),
    ),
  )

  it.effect('prunes oldest traces in bounded pages without breaking retained resources', () =>
    withRepo(
      Effect.fn(function* (repo) {
        const spans = Array.from({ length: 260 }, (_, index) => {
          const current = index + 1
          const firstSpanId = spanId(current * 2 - 1)
          const resource = { 'service.name': current <= 100 ? 'old' : 'recent' }
          return [
            makeSpan({ traceId: traceId(current), spanId: firstSpanId, startUs: NOW * 1000 + current, resource }),
            makeSpan({ traceId: traceId(current), spanId: spanId(current * 2), parentSpanId: firstSpanId, startUs: NOW * 1000 + current + 1, resource }),
          ]
        }).flat()
        yield* repo.ingestSpans(spans, { ...retention, maxSpans: 600 })
        expect(yield* repo.summary()).toMatchObject({ traces: 260, spans: 520 })
        expect(yield* repo.prune({ ...retention, maxSpans: 128 })).toBe(196)
        expect(yield* repo.summary()).toMatchObject({ traces: 64, spans: 128 })
        expect((yield* repo.list({ limit: 128 })).traces.map(trace => trace.traceId)).toEqual(Array.from({ length: 64 }, (_, index) => traceId(260 - index)))
        expect((yield* repo.trace(traceId(260))).spans[0]?.resource).toEqual({ 'service.name': 'recent' })
      }),
    ),
  )

  it.effect('searches logs by service, severity, text, attribute, trace and span, newest first with paging', () =>
    withRepo(
      Effect.fn(function* (repo) {
        const at = (index: number) => (NOW - 10_000 + index) * 1000
        yield* repo.ingestLogs(
          [
            logOf({
              timeUs: at(1),
              body: 'cart is empty',
              attributes: { 'cart.id': 'c-42' },
              traceId: traceId(1),
              spanId: spanId(2),
              resource: { 'service.name': 'web' },
            }),
            logOf({ timeUs: at(2), severityNumber: 17, service: 'db', body: 'disk full', resource: { 'service.name': 'db' } }),
            logOf({ timeUs: at(3), body: '100% done', resource: { 'service.name': 'web' } }),
          ],
          retention,
        )
        expect((yield* repo.summary()).logs).toBe(3)
        const bodies = (query: LogSearchQuery) => Effect.map(repo.searchLogs(query), list => list.logs.map(entry => entry.body))
        expect(yield* bodies({})).toEqual(['100% done', 'disk full', 'cart is empty'])
        expect(yield* bodies({ service: 'db' })).toEqual(['disk full'])
        expect(yield* bodies({ minSeverity: 13 })).toEqual(['disk full'])
        expect(yield* bodies({ search: '100%' })).toEqual(['100% done'])
        expect(yield* bodies({ attribute: { key: 'cart.id', value: 'c-42' } })).toEqual(['cart is empty'])
        expect(yield* bodies({ traceId: traceId(1).toUpperCase(), spanId: spanId(2) })).toEqual(['cart is empty'])
        expect((yield* repo.searchLogs({ service: 'db' })).logs[0]?.resource).toEqual({ 'service.name': 'db' })
        const first = yield* repo.searchLogs({ limit: 2 })
        expect(yield* bodies({ limit: 2, cursor: first.nextCursor ?? undefined })).toEqual(['cart is empty'])
        expect(yield* Effect.flip(repo.searchLogs({ cursor: 'nope' }))).toMatchObject({ _tag: 'InvalidCursor', message: 'The logs cursor is invalid.' })
      }),
    ),
  )

  it.effect('drops the oldest logs past the count limit and expired ones by age', () =>
    withRepo(
      Effect.fn(function* (repo) {
        yield* repo.ingestLogs(
          ['a', 'b', 'c'].map(body => logOf({ timeUs: NOW * 1000, body })),
          { ...retention, maxLogs: 2 },
        )
        expect((yield* repo.summary()).logs).toBe(2)
        expect((yield* repo.searchLogs({})).logs.map(entry => entry.body).sort()).toEqual(['b', 'c'])
        yield* TestClock.adjust(25 * 3_600_000)
        yield* repo.prune(retention)
        expect((yield* repo.summary()).logs).toBe(0)
      }),
    ),
  )

  it.effect('maps calls between services from cross-service parent and child spans', () =>
    withRepo(
      Effect.fn(function* (repo) {
        const at = (offsetMs: number): number => (NOW - 30_000 + offsetMs) * 1000
        yield* repo.ingestSpans(
          [
            makeSpan({ traceId: traceId(1), spanId: spanId(1), service: 'web', startUs: at(0), endUs: at(100) }),
            makeSpan({ traceId: traceId(1), spanId: spanId(2), parentSpanId: spanId(1), service: 'web', startUs: at(1), endUs: at(90) }),
            makeSpan({ traceId: traceId(1), spanId: spanId(3), parentSpanId: spanId(2), service: 'payments', startUs: at(5), endUs: at(45), statusCode: 2 }),
            makeSpan({ traceId: traceId(2), spanId: spanId(4), service: 'web', startUs: at(200), endUs: at(260) }),
            makeSpan({ traceId: traceId(2), spanId: spanId(5), parentSpanId: spanId(4), service: 'payments', startUs: at(205), endUs: at(225) }),
            makeSpan({ traceId: traceId(2), spanId: spanId(6), parentSpanId: spanId(5), service: 'db', startUs: at(206), endUs: at(216) }),
          ],
          retention,
        )
        const map = yield* repo.serviceMap({ windowMinutes: 60 })
        expect(map.nodes.map(node => node.service).sort()).toEqual(['db', 'payments', 'web'])
        expect(map.edges.map(edge => [edge.source, edge.target, edge.count, edge.errorCount, edge.p95Ms])).toEqual([
          ['web', 'payments', 2, 1, 40],
          ['payments', 'db', 1, 0, 10],
        ])
      }),
    ),
  )

  it.effect('lists metrics and charts a cumulative counter as its increase, per attribute set', () =>
    withRepo(
      Effect.fn(function* (repo) {
        const point = (
          offsetSeconds: number,
          value: number,
          attributes: Record<string, string>,
          overrides: Partial<NormalizedMetricPoint> = {},
        ): NormalizedMetricPoint => ({
          name: 'http.requests',
          description: 'Requests served',
          unit: '{request}',
          type: 'sum',
          monotonic: true,
          temporality: 'cumulative',
          service: 'web',
          scope: null,
          timeUs: (NOW - 120_000 + offsetSeconds * 1000) * 1000,
          value,
          count: null,
          sum: null,
          min: null,
          max: null,
          attributes,
          ...overrides,
        })
        yield* repo.ingestMetrics(
          [
            point(0, 10, { route: '/a' }),
            point(10, 15, { route: '/a' }),
            point(20, 3, { route: '/a' }),
            point(0, 1, { route: '/b' }),
            point(0, 0.4, {}, { name: 'cpu.usage', type: 'gauge', monotonic: false, temporality: 'unspecified', unit: '1' }),
          ],
          retention,
        )
        expect((yield* repo.summary()).metricPoints).toBe(5)
        expect(
          (yield* repo.listMetrics({ windowMinutes: 60 })).map(metric => [metric.name, metric.type, metric.points, metric.series, metric.lastValue]),
        ).toEqual([
          ['cpu.usage', 'gauge', 1, 1, 0.4],
          ['http.requests', 'sum', 4, 2, null],
        ])
        const series = yield* repo.metricSeries({ name: 'http.requests', service: 'web', windowMinutes: 60 })
        expect(series.valueKind).toBe('increase')
        expect(series.series.map(entry => [entry.attributes, entry.points.map(sample => sample.value)])).toEqual([
          [{ route: '/a' }, [5, 3]],
          [{ route: '/b' }, []],
        ])
        expect((yield* repo.metricSeries({ name: 'cpu.usage', service: 'web', windowMinutes: 60 })).valueKind).toBe('value')
        expect(yield* Effect.flip(repo.metricSeries({ name: 'missing', service: 'web', windowMinutes: 60 }))).toMatchObject({
          _tag: 'MetricNotFound',
          message: 'No points for metric missing of web in this window.',
        })
        yield* repo.ingestMetrics([point(30, 9, { route: '/c' })], { ...retention, maxMetricPoints: 5 })
        expect((yield* repo.summary()).metricPoints).toBe(5)
        expect((yield* repo.clear()).removedMetricPoints).toBe(5)
        expect((yield* repo.summary()).metricPoints).toBe(0)
        yield* repo.ingestMetrics([point(40, 1, {})], retention)
        expect((yield* repo.summary()).metricPoints).toBe(1)
        yield* TestClock.adjust(25 * 3_600_000)
        yield* repo.prune(retention)
        expect((yield* repo.summary()).metricPoints).toBe(0)
      }),
    ),
  )
})

describe('session summary', () => {
  const seedTurn = (repo: TraceRepo['Service']) =>
    repo.ingestSpans(
      [
        makeSpan({
          traceId: traceId(10),
          spanId: spanId(10),
          name: 'invoke_agent deepseek-harness',
          startUs: 10_000_000,
          endUs: 14_000_000,
          sessionId: 'session-t',
          attributes: { 'gen_ai.operation.name': 'invoke_agent', 'gen_ai.usage.input_tokens': 300, 'gen_ai.usage.output_tokens': 30 },
        }),
        makeSpan({
          traceId: traceId(10),
          spanId: spanId(11),
          parentSpanId: spanId(10),
          name: 'chat model-a',
          startUs: 10_100_000,
          endUs: 11_100_000,
          sessionId: 'session-t',
          statusCode: 2,
          attributes: { 'gen_ai.operation.name': 'chat', 'gen_ai.usage.input_tokens': 100, 'gen_ai.usage.output_tokens': 10 },
        }),
        makeSpan({
          traceId: traceId(10),
          spanId: spanId(12),
          parentSpanId: spanId(10),
          name: 'chat model-a',
          startUs: 11_200_000,
          endUs: 13_200_000,
          sessionId: 'session-t',
          attributes: { 'gen_ai.usage.input_tokens': 200, 'gen_ai.usage.output_tokens': 20, 'gen_ai.usage.cache_read.input_tokens': 50 },
        }),
        makeSpan({
          traceId: traceId(10),
          spanId: spanId(13),
          parentSpanId: spanId(10),
          name: 'execute_tool bash',
          startUs: 13_300_000,
          endUs: 13_900_000,
          sessionId: 'session-t',
          attributes: { 'gen_ai.operation.name': 'execute_tool' },
        }),
        makeSpan({
          traceId: traceId(10),
          spanId: spanId(14),
          parentSpanId: spanId(13),
          name: 'jujutsu/status',
          service: 'dshfiles',
          startUs: 13_400_000,
          endUs: 13_500_000,
        }),
        makeSpan({
          traceId: traceId(11),
          spanId: spanId(15),
          name: 'usage/report',
          service: 'dshfiles',
          startUs: 20_000_000,
          endUs: 20_500_000,
          sessionId: 'session-t',
        }),
        makeSpan({ traceId: traceId(12), spanId: spanId(16), name: 'chat other', startUs: 30_000_000, endUs: 31_000_000, sessionId: 'session-other' }),
      ],
      retention,
    )

  it.effect('counts every span of the session traces, model and tool calls, and tokens from model calls only', () =>
    withRepo(
      Effect.fn(function* (repo) {
        yield* seedTurn(repo)
        const summary = yield* repo.sessionSummary('session-t')
        expect(summary).toMatchObject({
          sessionId: 'session-t',
          traces: 2,
          spans: 6,
          errorSpans: 1,
          turns: 1,
          modelCalls: 2,
          toolCalls: 1,
          firstMs: 10_000,
          lastMs: 20_500,
          totalTraceMs: 4_500,
          tokens: { input: 300, output: 30, cacheRead: 50, reasoning: 0 },
          services: ['dshfiles', 'svc'],
        })
        expect(summary.traceLatency).toMatchObject({ count: 2, errorCount: 1, maxMs: 4_000 })
        expect(summary.modelLatency).toMatchObject({ count: 2, p50Ms: 1_000, maxMs: 2_000 })
      }),
    ),
  )

  it.effect("counts a subagent's turn in its parent's trace for both threads", () =>
    withRepo(
      Effect.fn(function* (repo) {
        // The child Session id sorts after the parent's, so a single per-trace session used to hide the trace from the parent.
        yield* repo.ingestSpans(
          [
            makeSpan({ traceId: traceId(20), spanId: spanId(20), name: 'invoke_agent deepseek-harness', sessionId: 'session-a-parent' }),
            makeSpan({ traceId: traceId(20), spanId: spanId(21), parentSpanId: spanId(20), name: 'execute_tool subagent', sessionId: 'session-a-parent' }),
            makeSpan({
              traceId: traceId(20),
              spanId: spanId(22),
              parentSpanId: spanId(21),
              name: 'invoke_agent deepseek-harness',
              sessionId: 'session-z-child',
            }),
          ],
          retention,
        )
        expect((yield* repo.list({ sessionId: 'session-a-parent' })).traces.map(trace => trace.traceId)).toEqual([traceId(20)])
        expect((yield* repo.list({ sessionId: 'session-z-child' })).traces.map(trace => trace.traceId)).toEqual([traceId(20)])
        expect(yield* repo.sessionSummary('session-a-parent')).toMatchObject({ traces: 1, spans: 3 })
        expect(yield* repo.sessionSummary('session-z-child')).toMatchObject({ traces: 1, spans: 3 })
      }),
    ),
  )

  it.effect('is empty for an unknown session and reports no tokens without usage attributes', () =>
    withRepo(
      Effect.fn(function* (repo) {
        yield* seedTurn(repo)
        expect(yield* repo.sessionSummary('session-none')).toMatchObject({ traces: 0, spans: 0, firstMs: null, tokens: null, totalTraceMs: 0 })
      }),
    ),
  )

  it.effect('finds the logs of a session through its traces or its dsh.session.id attribute', () =>
    withRepo(
      Effect.fn(function* (repo) {
        yield* seedTurn(repo)
        const at = (id: number) => 10_500_000 + id
        yield* repo.ingestLogs(
          [
            logOf({ timeUs: at(1), body: 'log 1', service: 'svc', traceId: traceId(10), spanId: spanId(11) }),
            logOf({ timeUs: at(2), body: 'log 2', service: 'svc', attributes: { 'dsh.session.id': 'session-t' } }),
            logOf({ timeUs: at(3), body: 'log 3', service: 'svc', traceId: traceId(12) }),
            logOf({ timeUs: at(4), body: 'log 4', service: 'svc' }),
          ],
          retention,
        )
        expect((yield* repo.searchLogs({ sessionId: 'session-t' })).logs.map(entry => entry.body).sort()).toEqual(['log 1', 'log 2'])
      }),
    ),
  )
})
