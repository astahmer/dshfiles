import { describe, expect, it } from 'vitest'
import type { RequestRow, ToolExecutionRow } from './fold.js'
import { createOtlpMetricsRequest, type OtlpHistogramInput } from './otel-metrics.js'
import { openUsageStore } from './store.js'

describe('SQLite-backed OTLP metrics', () => {
  it('exports bounded aggregate metrics in OTLP JSON without local identifiers or payloads', () => {
    const store = openUsageStore(':memory:')
    const from = 1_800_000_000_000
    try {
      const requests: RequestRow[] = [
        {
          id: 'private-request-1',
          sessionId: 'private-session-id',
          seq: 1,
          messageId: null,
          turn: 1,
          step: 1,
          purpose: 'agent',
          source: 'log',
          provider: 'codex-personal',
          model: 'gpt-example',
          startedAt: from + 1,
          endedAt: from + 51,
          ttftMs: 10,
          usage: { input: 4, cacheRead: 2, cacheWrite: 1, output: 3, reasoning: 4 },
          status: 'ok',
          stopReason: null,
          errorCode: null,
        },
        {
          id: 'private-request-2',
          sessionId: 'private-session-id',
          seq: 2,
          messageId: null,
          turn: 1,
          step: 2,
          purpose: 'agent',
          source: 'log',
          provider: 'codex-personal',
          model: 'gpt-example',
          startedAt: from + 2,
          endedAt: from + 102,
          ttftMs: 20,
          usage: { input: 1, cacheRead: 0, cacheWrite: 0, output: 2, reasoning: 0 },
          status: 'failed',
          stopReason: null,
          errorCode: 'private-error-detail',
        },
      ]
      const tools: ToolExecutionRow[] = [
        {
          id: 'private-tool-id',
          sessionId: 'private-session-id',
          seq: 3,
          turn: 1,
          step: 3,
          name: 'skill-example',
          category: 'skill',
          owner: null,
          startedAt: from + 3,
          endedAt: from + 13,
          outcome: 'success',
        },
      ]
      store.commitLogSlice({
        path: '/private/user/session.jsonl',
        sessionId: 'private-session-id',
        offset: 1,
        size: 1,
        mtimeMs: 1,
        state: '{}',
        session: { id: 'private-session-id', cwd: '/private/user/project', parentSession: null, subagent: false, createdAt: from, title: 'private title' },
        rows: requests,
        tools,
      })
      store.recordJevUsage({
        requestId: '00000000-0000-4000-8000-000000000020',
        source: 'memory',
        credential: 'PRIVATE_JEV_KEY_LABEL',
        startedAt: from + 4,
        durationMs: 12,
        outcome: 'failure',
        inputTokens: 30,
        outputTokens: 7,
      })

      const request = store.otelMetrics({ from, to: from + 200, temporality: 'delta', serviceName: 'dshfiles' })
      const metrics = request.resourceMetrics[0]?.scopeMetrics[0]?.metrics ?? []
      const requestMetric = metrics.find(metric => metric.name === 'dsh.model.request.count')
      const toolMetric = metrics.find(metric => metric.name === 'dsh.tool.execution.count')
      const toolSourceMetric = metrics.find(metric => metric.name === 'dsh.tool.source.execution.count')
      const jevMetric = metrics.find(metric => metric.name === 'dsh.jev.request.count')
      const jevTokenMetric = metrics.find(metric => metric.name === 'dsh.jev.token.usage')
      const jevDurationMetric = metrics.find(metric => metric.name === 'dsh.jev.request.duration')
      const durationMetric = metrics.find(metric => metric.name === 'dsh.model.request.duration')

      expect(requestMetric && 'sum' in requestMetric ? requestMetric.sum.aggregationTemporality : null).toBe(1)
      expect(durationMetric && 'histogram' in durationMetric ? durationMetric.histogram.aggregationTemporality : null).toBe(1)
      expect(requestMetric && 'sum' in requestMetric ? requestMetric.sum.dataPoints : []).toEqual([
        expect.objectContaining({
          attributes: expect.arrayContaining([
            { key: 'dsh.request.outcome', value: { stringValue: 'failed' } },
            { key: 'dsh.request.purpose', value: { stringValue: 'agent' } },
            { key: 'gen_ai.provider.name', value: { stringValue: 'codex-personal' } },
            { key: 'gen_ai.request.model', value: { stringValue: 'gpt-example' } },
          ]),
          asInt: '1',
          startTimeUnixNano: (BigInt(from) * 1_000_000n).toString(),
          timeUnixNano: (BigInt(from + 200) * 1_000_000n).toString(),
        }),
        expect.objectContaining({ asInt: '1' }),
      ])
      expect(toolMetric && 'sum' in toolMetric ? toolMetric.sum.dataPoints : []).toEqual([
        expect.objectContaining({
          attributes: expect.arrayContaining([
            { key: 'dsh.tool.category', value: { stringValue: 'skill' } },
            { key: 'dsh.tool.outcome', value: { stringValue: 'success' } },
          ]),
          asInt: '1',
        }),
      ])
      expect(toolSourceMetric && 'sum' in toolSourceMetric ? toolSourceMetric.sum.dataPoints : []).toEqual([
        expect.objectContaining({
          attributes: expect.arrayContaining([{ key: 'dsh.tool.name', value: { stringValue: 'skill-example' } }]),
          asInt: '1',
        }),
      ])
      expect(jevMetric && 'sum' in jevMetric ? jevMetric.sum.dataPoints : []).toEqual([
        expect.objectContaining({
          attributes: expect.arrayContaining([
            { key: 'dsh.jev.source', value: { stringValue: 'memory' } },
            { key: 'dsh.jev.outcome', value: { stringValue: 'failure' } },
          ]),
          asInt: '1',
        }),
      ])
      expect(jevTokenMetric && 'sum' in jevTokenMetric ? jevTokenMetric.sum.dataPoints : []).toEqual([
        expect.objectContaining({ attributes: expect.arrayContaining([{ key: 'gen_ai.token.type', value: { stringValue: 'input' } }]), asInt: '30' }),
        expect.objectContaining({ attributes: expect.arrayContaining([{ key: 'gen_ai.token.type', value: { stringValue: 'output' } }]), asInt: '7' }),
      ])
      expect(jevDurationMetric && 'histogram' in jevDurationMetric ? jevDurationMetric.histogram.dataPoints : []).toEqual([
        expect.objectContaining({ count: '1', sum: 0.012 }),
      ])
      expect(durationMetric && 'histogram' in durationMetric ? durationMetric.histogram.dataPoints : []).toEqual([
        expect.objectContaining({
          count: '1',
          sum: 0.1,
          bucketCounts: ['0', '0', '0', '0', '1', '0', '0', '0', '0', '0', '0', '0', '0', '0'],
        }),
        expect.objectContaining({
          count: '1',
          sum: 0.05,
          bucketCounts: ['0', '0', '0', '1', '0', '0', '0', '0', '0', '0', '0', '0', '0', '0'],
        }),
      ])
      const output = JSON.stringify(request)
      for (const privateValue of [
        'private-request-1',
        'private-session-id',
        '/private/user/session.jsonl',
        '/private/user/project',
        'private title',
        'private-error-detail',
        'PRIVATE_JEV_KEY_LABEL',
        '00000000-0000-4000-8000-000000000020',
      ])
        expect(output).not.toContain(privateValue)
      expect(request.resourceMetrics[0]?.resource.attributes).toContainEqual({ key: 'service.name', value: { stringValue: 'dshfiles' } })
    } finally {
      store.close()
    }
  })

  it('caps named source metrics while keeping category totals exact', () => {
    const store = openUsageStore(':memory:')
    const from = 1_800_000_000_000
    try {
      const tools: ToolExecutionRow[] = Array.from({ length: 501 }, (_, index) => ({
        id: `tool-${String(index)}`,
        sessionId: 'private-session',
        seq: index,
        turn: 1,
        step: index,
        name: `mcp-tool-${String(index).padStart(3, '0')}`,
        category: 'mcp',
        owner: null,
        startedAt: from + index,
        endedAt: from + index + 1,
        outcome: 'success',
      }))
      store.commitLogSlice({
        path: '/private/session.jsonl',
        sessionId: 'private-session',
        offset: 1,
        size: 1,
        mtimeMs: 1,
        state: '{}',
        session: null,
        rows: [],
        tools,
      })
      const metrics =
        store.otelMetrics({ from, to: from + 1_000, temporality: 'delta', serviceName: 'dshfiles' }).resourceMetrics[0]?.scopeMetrics[0]?.metrics ?? []
      const categories = metrics.find(metric => metric.name === 'dsh.tool.execution.count')
      const sources = metrics.find(metric => metric.name === 'dsh.tool.source.execution.count')
      expect(categories && 'sum' in categories ? categories.sum.dataPoints[0]?.asInt : undefined).toBe('501')
      expect(sources && 'sum' in sources ? sources.sum.dataPoints : []).toHaveLength(500)
    } finally {
      store.close()
    }
  })

  it('returns an empty valid OTLP request for a range without records', () => {
    const store = openUsageStore(':memory:')
    try {
      const request = store.otelMetrics({ from: 1_800_000_000_000, to: 1_800_000_000_100, temporality: 'delta', serviceName: 'dshfiles' })
      expect(request.resourceMetrics[0]?.scopeMetrics[0]?.metrics).toEqual([])
    } finally {
      store.close()
    }
  })
})

describe('OTLP/JSON mapping', () => {
  const from = 1_800_000_000_123
  const to = 1_800_000_060_456
  const histogram: OtlpHistogramInput = {
    name: 'dsh.example.duration',
    description: 'Example durations.',
    unit: 's',
    bounds: [0.1, 1, 10],
    points: [{ attributes: { 'z.last': 'b', 'a.first': 'a' }, count: 6, sum: 12.5, bucketCounts: [1, 2, 0, 3] }],
  }
  const build = (temporality: 'delta' | 'cumulative') =>
    createOtlpMetricsRequest({
      from,
      to,
      temporality,
      serviceName: 'custom-service',
      counters: [
        { name: 'dsh.example.count', description: 'Example counter.', unit: '{request}', points: [{ attributes: { 'b.key': 'x', 'a.key': 'y' }, value: 42 }] },
      ],
      histograms: [histogram],
    })

  it('encodes AggregationTemporality as its proto enum number, never its name', () => {
    const delta = build('delta')
    const cumulative = build('cumulative')
    const temporalities = (request: ReturnType<typeof build>) =>
      request.resourceMetrics[0]?.scopeMetrics[0]?.metrics.map(metric =>
        'sum' in metric ? metric.sum.aggregationTemporality : metric.histogram.aggregationTemporality,
      )
    expect(temporalities(delta)).toEqual([1, 1])
    expect(temporalities(cumulative)).toEqual([2, 2])
    expect(JSON.stringify(cumulative)).not.toMatch(/AGGREGATION_TEMPORALITY/u)
  })

  it('writes 64-bit integers and Unix nanosecond times as decimal strings', () => {
    const metrics = build('cumulative').resourceMetrics[0]?.scopeMetrics[0]?.metrics ?? []
    const counter = metrics.find(metric => 'sum' in metric)
    const durations = metrics.find(metric => 'histogram' in metric)
    const counterPoint = counter && 'sum' in counter ? counter.sum.dataPoints[0] : undefined
    const histogramPoint = durations && 'histogram' in durations ? durations.histogram.dataPoints[0] : undefined
    expect(counter && 'sum' in counter ? counter.sum.isMonotonic : undefined).toBe(true)
    expect(counterPoint).toEqual({
      attributes: [
        { key: 'a.key', value: { stringValue: 'y' } },
        { key: 'b.key', value: { stringValue: 'x' } },
      ],
      startTimeUnixNano: '1800000000123000000',
      timeUnixNano: '1800000060456000000',
      asInt: '42',
    })
    expect(histogramPoint).toEqual({
      attributes: [
        { key: 'a.first', value: { stringValue: 'a' } },
        { key: 'z.last', value: { stringValue: 'b' } },
      ],
      startTimeUnixNano: '1800000000123000000',
      timeUnixNano: '1800000060456000000',
      count: '6',
      sum: 12.5,
      bucketCounts: ['1', '2', '0', '3'],
      explicitBounds: [0.1, 1, 10],
    })
  })

  it('names the resource and the instrumentation scope', () => {
    const resource = build('delta').resourceMetrics[0]
    expect(resource?.resource.attributes).toEqual([{ key: 'service.name', value: { stringValue: 'custom-service' } }])
    expect(resource?.scopeMetrics[0]?.scope).toEqual({ name: '@dshfiles/usage', version: '0.1.0' })
  })

  it.each([
    ['a bucket count per bound plus one', { bucketCounts: [1, 2, 3] }],
    ['buckets that add up to the count', { bucketCounts: [1, 2, 0, 4] }],
  ])('rejects histogram points without %s', (_label, override) => {
    const [point] = histogram.points
    if (point === undefined) throw new Error('fixture has a point')
    expect(() =>
      createOtlpMetricsRequest({
        from,
        to,
        temporality: 'delta',
        serviceName: 'x',
        counters: [],
        histograms: [{ ...histogram, points: [{ ...point, ...override }] }],
      }),
    ).toThrow()
  })

  it('rejects unsorted bounds and a start time after the point time', () => {
    expect(() =>
      createOtlpMetricsRequest({ from, to, temporality: 'delta', serviceName: 'x', counters: [], histograms: [{ ...histogram, bounds: [1, 0.1, 10] }] }),
    ).toThrow()
    expect(() => createOtlpMetricsRequest({ from: to, to: from, temporality: 'delta', serviceName: 'x', counters: [], histograms: [histogram] })).toThrow()
  })
})
