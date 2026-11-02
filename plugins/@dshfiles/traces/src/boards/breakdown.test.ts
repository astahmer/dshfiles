import { describe, expect, it } from '@effect/vitest'
import { Effect, Schema } from 'effect'
import { TestClock } from 'effect/testing'
import type { NormalizedSpan } from '../otlp/normalize.js'
import { TraceRepoTest } from '../test-layers.test-support.js'
import { TraceRepo } from '../trace-repo.js'
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

const decodeStrict = Schema.decodeUnknownSync(breakdownInputSchema, { onExcessProperty: 'error' })

/** Spans stored in a fresh in-memory store with the clock at NOW. */
const withSpans = <A, E>(spans: readonly NormalizedSpan[], body: Effect.Effect<A, E, TraceRepo>) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW)
    yield* TraceRepo.use(repo => repo.ingestSpans(spans, retention))
    return yield* body
  }).pipe(Effect.provide(TraceRepoTest))

const board = (id: string) => {
  const found = BUILTIN_BOARDS.find(candidate => candidate.id === id)
  if (found === undefined) throw new Error(`No board ${id}`)
  return decodeStrict({ ...found.query, windowMinutes: 60 })
}

describe('span breakdown', () => {
  it.effect('groups tool calls by tool name, slowest p95 first', () =>
    withSpans(
      [
        span({ name: 'execute_tool bash', durationMs: 4_000, attributes: { 'gen_ai.tool.name': 'bash' } }),
        span({ name: 'execute_tool bash', durationMs: 2_000, error: true, attributes: { 'gen_ai.tool.name': 'bash' } }),
        span({ name: 'execute_tool read', durationMs: 5, attributes: { 'gen_ai.tool.name': 'read' } }),
        span({ name: 'chat model', durationMs: 9_000 }),
      ],
      Effect.gen(function* () {
        const result = yield* SpanBreakdown.compute(board('slow-tools'))
        expect(result.spans).toBe(3)
        expect(result.rows.map(row => [row.key, row.count, row.errorRate, row.p95Ms])).toEqual([
          ['bash', 2, 0.5, 4_000],
          ['read', 1, 0, 5],
        ])
      }),
    ),
  )

  it.effect('reports a numeric attribute in milliseconds and groups missing values as null', () =>
    withSpans(
      [
        span({ name: 'chat a', durationMs: 1_000, attributes: { 'gen_ai.provider.name': 'deepseek', 'gen_ai.response.time_to_first_token': 200_000_000 } }),
        span({ name: 'chat b', durationMs: 3_000, attributes: { 'gen_ai.provider.name': 'deepseek', 'gen_ai.response.time_to_first_token': 400_000_000 } }),
        span({ name: 'chat c', durationMs: 500 }),
      ],
      Effect.gen(function* () {
        const rows = (yield* SpanBreakdown.compute(board('model-latency'))).rows
        expect(rows.find(row => row.key === 'deepseek')).toMatchObject({ count: 2, measureP50Ms: 200, measureP95Ms: 400, p95Ms: 3_000 })
        expect(rows.find(row => row.key === null)).toMatchObject({ count: 1, measureP50Ms: null })
      }),
    ),
  )

  it.effect('matches an attribute filter and groups by span name or service', () =>
    withSpans(
      [
        span({ name: 'jujutsu/status', durationMs: 10, error: true, attributes: { 'rpc.system': 'dshx', 'dshx.plugin.package': '@dshfiles/jujutsu' } }),
        span({ name: 'jujutsu/status', durationMs: 12, attributes: { 'rpc.system': 'dshx', 'dshx.plugin.package': '@dshfiles/jujutsu' } }),
        span({ name: 'memory/search', durationMs: 30, attributes: { 'rpc.system': 'dshx', 'dshx.plugin.package': '@dshfiles/memory' } }),
        span({ name: 'GET /', durationMs: 30, attributes: { 'rpc.system': 'grpc' } }),
      ],
      Effect.gen(function* () {
        const plugins = (yield* SpanBreakdown.compute(board('failing-plugins'))).rows
        expect(plugins.map(row => [row.key, row.errorRate])).toEqual([
          ['@dshfiles/jujutsu', 0.5],
          ['@dshfiles/memory', 0],
        ])
        const byOperation = yield* SpanBreakdown.compute(
          decodeStrict({
            windowMinutes: 60,
            filter: { service: null, operation: null, attribute: { key: 'rpc.system', value: '*' } },
            groupBy: { kind: 'operation' },
          }),
        )
        expect(byOperation.rows.map(row => row.key)).toEqual(['jujutsu/status', 'memory/search', 'GET /'])
        const byService = yield* SpanBreakdown.compute(
          decodeStrict({
            windowMinutes: 60,
            filter: { service: null, operation: null, attribute: null },
            groupBy: { kind: 'service' },
          }),
        )
        expect(byService.rows).toMatchObject([{ key: 'deepseek-harness', count: 4 }])
      }),
    ),
  )

  it('rejects an attribute key that could escape the JSON path', () => {
    expect(() =>
      decodeStrict({
        windowMinutes: 60,
        filter: { service: null, operation: null, attribute: null },
        groupBy: { kind: 'attribute', key: 'a"b' },
      }),
    ).toThrow()
  })
})
