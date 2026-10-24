import { describe, expect, test } from 'vitest'
import type { NormalizedSpan } from '../otlp/normalize.js'
import { openTraceStore } from '../store.js'
import { BUILTIN_BOARDS } from './board-definitions.js'
import { breakdownInputSchema } from './boards-api.js'
import { SpanBreakdown } from './breakdown.js'

const NOW = 1_700_000_000_000
const retention = { maxAgeHours: 24, maxSpans: 10_000, maxLogs: 1_000, maxMetricPoints: 1_000 }
let next = 1

const span = (input: {
  readonly name: string
  readonly durationMs: number
  readonly error?: boolean
  readonly attributes?: NormalizedSpan['attributes']
}): NormalizedSpan => {
  const id = next++
  const endUs = (NOW - 30_000) * 1000
  return {
    traceId: id.toString(16).padStart(32, '0'),
    spanId: id.toString(16).padStart(16, '0'),
    parentSpanId: null,
    name: input.name,
    service: 'deepseek-harness',
    scope: null,
    kind: 1,
    startUs: endUs - input.durationMs * 1000,
    endUs,
    statusCode: input.error === true ? 2 : 0,
    statusMessage: null,
    sessionId: null,
    attributes: input.attributes ?? {},
    resource: {},
    events: [],
    linkCount: 0,
  }
}

const board = (id: string) => {
  const found = BUILTIN_BOARDS.find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`No board ${id}`)
  return breakdownInputSchema.parse({ ...found.query, windowMinutes: 60 })
}

describe('span breakdown', () => {
  test('groups tool calls by tool name, slowest p95 first', () => {
    const store = openTraceStore({ path: ':memory:', now: () => NOW })
    store.ingest(
      [
        span({ name: 'execute_tool bash', durationMs: 4_000, attributes: { 'gen_ai.tool.name': 'bash' } }),
        span({ name: 'execute_tool bash', durationMs: 2_000, error: true, attributes: { 'gen_ai.tool.name': 'bash' } }),
        span({ name: 'execute_tool read', durationMs: 5, attributes: { 'gen_ai.tool.name': 'read' } }),
        span({ name: 'chat model', durationMs: 9_000 }),
      ],
      retention,
    )
    const result = SpanBreakdown.compute({ source: store, query: board('slow-tools'), now: NOW })
    expect(result.spans).toBe(3)
    expect(result.rows.map(row => [row.key, row.count, row.errorRate, row.p95Ms])).toEqual([
      ['bash', 2, 0.5, 4_000],
      ['read', 1, 0, 5],
    ])
  })

  test('reports a numeric attribute in milliseconds and groups missing values as null', () => {
    const store = openTraceStore({ path: ':memory:', now: () => NOW })
    store.ingest(
      [
        span({ name: 'chat a', durationMs: 1_000, attributes: { 'gen_ai.provider.name': 'deepseek', 'gen_ai.response.time_to_first_token': 200_000_000 } }),
        span({ name: 'chat b', durationMs: 3_000, attributes: { 'gen_ai.provider.name': 'deepseek', 'gen_ai.response.time_to_first_token': 400_000_000 } }),
        span({ name: 'chat c', durationMs: 500 }),
      ],
      retention,
    )
    const rows = SpanBreakdown.compute({ source: store, query: board('model-latency'), now: NOW }).rows
    expect(rows.find(row => row.key === 'deepseek')).toMatchObject({ count: 2, measureP50Ms: 200, measureP95Ms: 400, p95Ms: 3_000 })
    expect(rows.find(row => row.key === null)).toMatchObject({ count: 1, measureP50Ms: null })
  })

  test('matches an attribute filter and groups by span name or service', () => {
    const store = openTraceStore({ path: ':memory:', now: () => NOW })
    store.ingest(
      [
        span({ name: 'jujutsu/status', durationMs: 10, error: true, attributes: { 'rpc.system': 'dshx', 'dshx.plugin.package': '@dshfiles/jujutsu' } }),
        span({ name: 'jujutsu/status', durationMs: 12, attributes: { 'rpc.system': 'dshx', 'dshx.plugin.package': '@dshfiles/jujutsu' } }),
        span({ name: 'memory/search', durationMs: 30, attributes: { 'rpc.system': 'dshx', 'dshx.plugin.package': '@dshfiles/memory' } }),
        span({ name: 'GET /', durationMs: 30, attributes: { 'rpc.system': 'grpc' } }),
      ],
      retention,
    )
    const plugins = SpanBreakdown.compute({ source: store, query: board('failing-plugins'), now: NOW }).rows
    expect(plugins.map(row => [row.key, row.errorRate])).toEqual([
      ['@dshfiles/jujutsu', 0.5],
      ['@dshfiles/memory', 0],
    ])
    const byOperation = SpanBreakdown.compute({
      source: store,
      query: breakdownInputSchema.parse({
        windowMinutes: 60,
        filter: { service: null, operation: null, attribute: { key: 'rpc.system', value: '*' } },
        groupBy: { kind: 'operation' },
      }),
      now: NOW,
    })
    expect(byOperation.rows.map(row => row.key)).toEqual(['jujutsu/status', 'memory/search', 'GET /'])
    const byService = SpanBreakdown.compute({
      source: store,
      query: breakdownInputSchema.parse({ windowMinutes: 60, filter: { service: null, operation: null, attribute: null }, groupBy: { kind: 'service' } }),
      now: NOW,
    })
    expect(byService.rows).toMatchObject([{ key: 'deepseek-harness', count: 4 }])
  })

  test('rejects an attribute key that could escape the JSON path', () => {
    expect(() =>
      breakdownInputSchema.parse({
        windowMinutes: 60,
        filter: { service: null, operation: null, attribute: null },
        groupBy: { kind: 'attribute', key: 'a"b' },
      }),
    ).toThrow()
  })
})
