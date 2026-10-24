import { describe, expect, test } from 'vitest'
import type { NormalizedLog, NormalizedMetricPoint, NormalizedSpan } from './otlp/normalize.js'
import { openTraceStore } from './store.js'

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

const openStore = (clock = { now: NOW }) => openTraceStore({ path: ':memory:', now: () => clock.now })

const seedCheckout = (store: ReturnType<typeof openStore>) =>
  store.ingest(
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

describe('trace store', () => {
  test('lists traces newest first with root, duration, counts, services and session', () => {
    const store = openStore()
    seedCheckout(store)
    const { traces, nextCursor } = store.list({})
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
  })

  test('filters by service, operation, status, duration, time, text and session', () => {
    const store = openStore()
    seedCheckout(store)
    const ids = (query: Parameters<typeof store.list>[0]) => store.list(query).traces.map(trace => trace.traceId)
    expect(ids({ service: 'db' })).toEqual([traceId(1)])
    expect(ids({ operation: 'GET /health' })).toEqual([traceId(2)])
    expect(ids({ status: 'error' })).toEqual([traceId(1)])
    expect(ids({ status: 'ok' })).toEqual([traceId(2)])
    expect(ids({ minDurationMs: 50 })).toEqual([traceId(1)])
    expect(ids({ fromMs: 1_500 })).toEqual([traceId(2)])
    expect(ids({ toMs: 1_500 })).toEqual([traceId(1)])
    expect(ids({ search: 'select' })).toEqual([traceId(1)])
    expect(ids({ search: '100%' })).toEqual([])
    expect(ids({ search: traceId(2) })).toEqual([traceId(2)])
    expect(ids({ sessionId: 'session-a' })).toEqual([traceId(1)])
  })

  test('pages with a cursor and rejects a forged one', () => {
    const store = openStore()
    store.ingest(
      Array.from({ length: 5 }, (_, index) => makeSpan({ traceId: traceId(index + 1), spanId: spanId(index + 1), startUs: (index + 1) * 1_000_000 })),
      retention,
    )
    const first = store.list({ limit: 2 })
    const second = store.list({ limit: 2, cursor: first.nextCursor ?? undefined })
    const third = store.list({ limit: 2, cursor: second.nextCursor ?? undefined })
    expect([...first.traces, ...second.traces, ...third.traces].map(trace => trace.traceId)).toEqual([5, 4, 3, 2, 1].map(traceId))
    expect(third.nextCursor).toBeNull()
    expect(() => store.list({ cursor: "1:'; DROP TABLE spans" })).toThrow(/cursor/)
  })

  test('returns one trace as a depth-first tree with offsets and resource attributes', () => {
    const store = openStore()
    seedCheckout(store)
    const detail = store.trace(traceId(1).toUpperCase())
    expect(detail).toMatchObject({ traceId: traceId(1), startMs: 1_000, durationMs: 100 })
    expect(detail.spans.map(span => [span.name, span.depth, span.offsetMs, span.durationMs, span.status])).toEqual([
      ['GET /checkout', 0, 0, 100, 'unset'],
      ['SELECT orders', 1, 10, 80, 'error'],
    ])
    expect(detail.spans[0]?.kind).toBe('server')
    expect(detail.spans[1]?.resource).toEqual({ 'service.name': 'svc' })
    expect(() => store.trace(traceId(9))).toThrow(/No stored trace/)
  })

  test('summarizes services and operations over a window', () => {
    const store = openStore()
    store.ingest(
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
    store.ingest([makeSpan({ traceId: traceId(99), spanId: spanId(99), name: 'old', startUs: (NOW - 7_200_000) * 1000 })], retention)
    const stats = store.stats({ windowMinutes: 60, limit: 10 })
    expect(stats.spans).toBe(10)
    expect(stats.operations).toEqual([
      { service: 'svc', name: 'GET /items', count: 10, errorCount: 1, errorRate: 0.1, p50Ms: 5, p95Ms: 10, p99Ms: 10, maxMs: 10 },
    ])
    expect(stats.services[0]).toMatchObject({ service: 'svc', count: 10 })
  })

  test('groups errors by service, operation, type and message shape', () => {
    const store = openStore()
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
    store.ingest([failing(1, 'timeout after 80 ms', 'Timeout'), failing(2, 'timeout after 95 ms', 'Timeout'), failing(3, 'constraint failed')], retention)
    const groups = store.errorGroups({ windowMinutes: 60, limit: 10 })
    expect(groups.map(group => [group.errorType, group.count, group.sampleTraceId])).toEqual([
      ['Timeout', 2, traceId(1)],
      [null, 1, traceId(3)],
    ])
  })

  test('drops whole traces past the age and span limits, and clears everything', () => {
    const clock = { now: NOW }
    const store = openStore(clock)
    store.ingest(
      [makeSpan({ traceId: traceId(1), spanId: spanId(1) }), makeSpan({ traceId: traceId(1), spanId: spanId(2), parentSpanId: spanId(1) })],
      retention,
    )
    clock.now += 1_000
    store.ingest([makeSpan({ traceId: traceId(2), spanId: spanId(3) })], retention)
    clock.now += 1_000
    const pruned = store.ingest([makeSpan({ traceId: traceId(3), spanId: spanId(4) })], {
      maxAgeHours: 24,
      maxSpans: 2,
      maxLogs: 10_000,
      maxMetricPoints: 10_000,
    })
    expect(pruned.prunedTraces).toBe(1)
    expect(store.list({}).traces.map(trace => trace.traceId)).toEqual([traceId(3), traceId(2)].sort().reverse())
    clock.now += 25 * 3_600_000
    expect(store.prune(retention)).toBe(2)
    expect(store.summary()).toMatchObject({ spans: 0, traces: 0 })
    store.ingest([makeSpan({ traceId: traceId(4), spanId: spanId(5) })], retention)
    expect(store.clear()).toEqual({ removedSpans: 1, removedTraces: 1, removedLogs: 0, removedMetricPoints: 0 })
    expect(store.summary()).toEqual({ spans: 0, traces: 0, logs: 0, metricPoints: 0, oldestMs: null, newestMs: null })
  })

  test('searches logs by service, severity, text, attribute, trace and span, newest first with paging', () => {
    const store = openStore()
    const log = (index: number, overrides: Partial<NormalizedLog>): NormalizedLog => ({
      timeUs: (NOW - 10_000 + index) * 1000,
      severityNumber: 9,
      severityText: null,
      body: `message ${String(index)}`,
      service: 'web',
      scope: null,
      traceId: null,
      spanId: null,
      eventName: null,
      attributes: {},
      resource: { 'service.name': 'web' },
      ...overrides,
    })
    store.ingestLogs(
      [
        log(1, { body: 'cart is empty', attributes: { 'cart.id': 'c-42' }, traceId: traceId(1), spanId: spanId(2) }),
        log(2, { severityNumber: 17, service: 'db', body: 'disk full', resource: { 'service.name': 'db' } }),
        log(3, { body: '100% done' }),
      ],
      retention,
    )
    const bodies = (query: Parameters<typeof store.searchLogs>[0]) => store.searchLogs(query).logs.map(entry => entry.body)
    expect(bodies({})).toEqual(['100% done', 'disk full', 'cart is empty'])
    expect(bodies({ service: 'db' })).toEqual(['disk full'])
    expect(bodies({ minSeverity: 13 })).toEqual(['disk full'])
    expect(bodies({ search: '100%' })).toEqual(['100% done'])
    expect(bodies({ attribute: { key: 'cart.id', value: 'c-42' } })).toEqual(['cart is empty'])
    expect(bodies({ traceId: traceId(1).toUpperCase(), spanId: spanId(2) })).toEqual(['cart is empty'])
    expect(store.searchLogs({ service: 'db' }).logs[0]?.resource).toEqual({ 'service.name': 'db' })
    const first = store.searchLogs({ limit: 2 })
    expect(store.searchLogs({ limit: 2, cursor: first.nextCursor ?? undefined }).logs.map(entry => entry.body)).toEqual(['cart is empty'])
    expect(() => store.searchLogs({ cursor: 'nope' })).toThrow(/cursor/)
  })

  test('drops the oldest logs past the count limit and expired ones by age', () => {
    const clock = { now: NOW }
    const store = openStore(clock)
    const log = (body: string): NormalizedLog => ({
      timeUs: NOW * 1000,
      severityNumber: 9,
      severityText: null,
      body,
      service: 'web',
      scope: null,
      traceId: null,
      spanId: null,
      eventName: null,
      attributes: {},
      resource: {},
    })
    store.ingestLogs([log('a'), log('b'), log('c')], { ...retention, maxLogs: 2 })
    expect(
      store
        .searchLogs({})
        .logs.map(entry => entry.body)
        .sort(),
    ).toEqual(['b', 'c'])
    clock.now += 25 * 3_600_000
    store.prune(retention)
    expect(store.summary().logs).toBe(0)
  })

  test('maps calls between services from cross-service parent and child spans', () => {
    const store = openStore()
    const at = (offsetMs: number): number => (NOW - 30_000 + offsetMs) * 1000
    store.ingest(
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
    const map = store.serviceMap({ windowMinutes: 60 })
    expect(map.nodes.map(node => node.service).sort()).toEqual(['db', 'payments', 'web'])
    expect(map.edges.map(edge => [edge.source, edge.target, edge.count, edge.errorCount, edge.p95Ms])).toEqual([
      ['web', 'payments', 2, 1, 40],
      ['payments', 'db', 1, 0, 10],
    ])
  })

  test('lists metrics and charts a cumulative counter as its increase, per attribute set', () => {
    const store = openStore()
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
    store.ingestMetrics(
      [
        point(0, 10, { route: '/a' }),
        point(10, 15, { route: '/a' }),
        point(20, 3, { route: '/a' }),
        point(0, 1, { route: '/b' }),
        point(0, 0.4, {}, { name: 'cpu.usage', type: 'gauge', monotonic: false, temporality: 'unspecified', unit: '1' }),
      ],
      retention,
    )
    expect(store.listMetrics({ windowMinutes: 60 }).map(metric => [metric.name, metric.type, metric.points, metric.series, metric.lastValue])).toEqual([
      ['cpu.usage', 'gauge', 1, 1, 0.4],
      ['http.requests', 'sum', 4, 2, null],
    ])
    const series = store.metricSeries({ name: 'http.requests', service: 'web', windowMinutes: 60 })
    expect(series.valueKind).toBe('increase')
    expect(series.series.map(entry => [entry.attributes, entry.points.map(sample => sample.value)])).toEqual([
      [{ route: '/a' }, [5, 3]],
      [{ route: '/b' }, []],
    ])
    expect(store.metricSeries({ name: 'cpu.usage', service: 'web', windowMinutes: 60 }).valueKind).toBe('value')
    expect(() => store.metricSeries({ name: 'missing', service: 'web', windowMinutes: 60 })).toThrow(/No points/)
  })
})

describe('session summary', () => {
  const seedTurn = (store: ReturnType<typeof openStore>) =>
    store.ingest(
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

  test('counts every span of the session traces, model and tool calls, and tokens from model calls only', () => {
    const store = openStore()
    seedTurn(store)
    const summary = store.sessionSummary('session-t')
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
  })

  test("counts a subagent's turn in its parent's trace for both threads", () => {
    const store = openStore()
    // The child Session id sorts after the parent's, so a single per-trace session used to hide the trace from the parent.
    store.ingest(
      [
        makeSpan({ traceId: traceId(20), spanId: spanId(20), name: 'invoke_agent deepseek-harness', sessionId: 'session-a-parent' }),
        makeSpan({ traceId: traceId(20), spanId: spanId(21), parentSpanId: spanId(20), name: 'execute_tool subagent', sessionId: 'session-a-parent' }),
        makeSpan({ traceId: traceId(20), spanId: spanId(22), parentSpanId: spanId(21), name: 'invoke_agent deepseek-harness', sessionId: 'session-z-child' }),
      ],
      retention,
    )
    expect(store.list({ sessionId: 'session-a-parent' }).traces.map(trace => trace.traceId)).toEqual([traceId(20)])
    expect(store.list({ sessionId: 'session-z-child' }).traces.map(trace => trace.traceId)).toEqual([traceId(20)])
    expect(store.sessionSummary('session-a-parent')).toMatchObject({ traces: 1, spans: 3 })
    expect(store.sessionSummary('session-z-child')).toMatchObject({ traces: 1, spans: 3 })
  })

  test('is empty for an unknown session and reports no tokens without usage attributes', () => {
    const store = openStore()
    seedTurn(store)
    expect(store.sessionSummary('session-none')).toMatchObject({ traces: 0, spans: 0, firstMs: null, tokens: null, totalTraceMs: 0 })
  })

  test('finds the logs of a session through its traces or its dsh.session.id attribute', () => {
    const store = openStore()
    seedTurn(store)
    const log = (id: number, overrides: Partial<NormalizedLog>): NormalizedLog => ({
      timeUs: 10_500_000 + id,
      severityNumber: 9,
      severityText: null,
      body: `log ${String(id)}`,
      service: 'svc',
      scope: null,
      traceId: null,
      spanId: null,
      eventName: null,
      attributes: {},
      resource: {},
      ...overrides,
    })
    store.ingestLogs(
      [
        log(1, { traceId: traceId(10), spanId: spanId(11) }),
        log(2, { attributes: { 'dsh.session.id': 'session-t' } }),
        log(3, { traceId: traceId(12) }),
        log(4, {}),
      ],
      retention,
    )
    expect(
      store
        .searchLogs({ sessionId: 'session-t' })
        .logs.map(entry => entry.body)
        .sort(),
    ).toEqual(['log 1', 'log 2'])
  })
})
