import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { TestClock } from 'effect/testing'
import { TraceFormat } from './format.js'
import type { NormalizedSpan } from './otlp/normalize.js'
import { TraceRepoTest } from './test-layers.test-support.js'
import { TraceRepo } from './trace-repo.js'

const NOW = 1_700_000_000_000
const retention = { maxAgeHours: 24, maxSpans: 10_000, maxLogs: 10_000, maxMetricPoints: 10_000 }
const traceId = (index: number): string => index.toString(16).padStart(32, '0')
const spanId = (index: number): string => index.toString(16).padStart(16, '0')
const at = (offsetMs: number): number => (NOW - 60_000 + offsetMs) * 1000

const span = (overrides: Partial<NormalizedSpan> & Pick<NormalizedSpan, 'traceId' | 'spanId'>): NormalizedSpan => ({
  parentSpanId: null,
  name: 'op',
  service: 'dshfiles',
  scope: null,
  kind: 1,
  startUs: at(0),
  endUs: at(10),
  statusCode: 0,
  statusMessage: null,
  sessionId: 'thread-a',
  attributes: {},
  resource: { 'service.name': 'dshfiles' },
  events: [],
  linkCount: 0,
  ...overrides,
})

const chat = (input: {
  readonly trace: number
  readonly id: number
  readonly parent: number
  readonly turn: number
  readonly usd?: number
  readonly session?: string
}) => {
  const usage = {
    'gen_ai.operation.name': 'chat',
    'gen_ai.provider.name': 'openai',
    'gen_ai.request.model': 'gpt-test',
    'gen_ai.usage.input_tokens': 1_000,
    'gen_ai.usage.output_tokens': 100,
    'dsh.session.id': input.session ?? 'thread-a',
    'dsh.turn': input.turn,
  }
  return span({
    traceId: traceId(input.trace),
    spanId: spanId(input.id),
    parentSpanId: spanId(input.parent),
    name: 'chat gpt-test',
    sessionId: input.session ?? 'thread-a',
    attributes: input.usd === undefined ? usage : { ...usage, 'dshx.cost.usd': input.usd },
  })
}

const turn = (input: { readonly trace: number; readonly id: number; readonly turn: number; readonly usd: number }) =>
  span({
    traceId: traceId(input.trace),
    spanId: spanId(input.id),
    name: 'invoke_agent deepseek-harness',
    attributes: { 'gen_ai.operation.name': 'invoke_agent', 'dsh.session.id': 'thread-a', 'dsh.turn': input.turn, 'dshx.cost.usd': input.usd },
  })

/** Two turns of thread-a (turn 2 also runs a subagent, thread-b, in the same trace) and one unpriced call. */
const seeded = <A, E>(body: (store: TraceRepo['Service']) => Effect.Effect<A, E>, options: { readonly empty?: boolean } = {}) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(NOW)
    const store = yield* TraceRepo
    if (options.empty !== true)
      yield* store.ingestSpans(
        [
          turn({ trace: 1, id: 1, turn: 1, usd: 0.03 }),
          chat({ trace: 1, id: 2, parent: 1, turn: 1, usd: 0.01 }),
          chat({ trace: 1, id: 3, parent: 1, turn: 1, usd: 0.02 }),
          turn({ trace: 2, id: 10, turn: 2, usd: 0.5 }),
          chat({ trace: 2, id: 11, parent: 10, turn: 2, usd: 0.5 }),
          chat({ trace: 2, id: 12, parent: 10, turn: 1, usd: 0.25, session: 'thread-b' }),
          chat({ trace: 2, id: 13, parent: 10, turn: 2 }),
        ],
        retention,
      )
    return yield* body(store)
  }).pipe(Effect.provide(TraceRepoTest))

describe('list-price cost from dshx.cost.usd', () => {
  it.effect('sums model calls per trace, never the turn span that repeats them', () =>
    seeded(
      Effect.fn(function* (store) {
        const traces = (yield* store.list({ sessionId: 'thread-a' })).traces
        expect(traces.map(trace => [trace.traceId, trace.costUsd])).toEqual([
          [traceId(2), 0.75],
          [traceId(1), 0.03],
        ])
      }),
    ),
  )

  it.effect('summarizes a thread in total and per own turn', () =>
    Effect.gen(function* () {
      const summary = yield* seeded(store => store.sessionSummary('thread-a'))
      expect(summary.costUsd).toBeCloseTo(0.78)
      expect(summary.turnCosts).toEqual([
        { turn: 1, costUsd: 0.03, modelCalls: 2 },
        { turn: 2, costUsd: 0.5, modelCalls: 1 },
      ])
      expect(yield* seeded(store => store.sessionSummary('none'), { empty: true })).toMatchObject({ costUsd: null, turnCosts: [] })
    }),
  )

  it.effect('lists a trace for every thread with a span in it, parent and subagent alike', () =>
    seeded(
      Effect.fn(function* (store) {
        expect((yield* store.list({ sessionId: 'thread-a' })).traces).toHaveLength(2)
        expect((yield* store.list({ sessionId: 'thread-b' })).traces.map(trace => trace.traceId)).toEqual([traceId(2)])
        expect(yield* store.sessionSummary('thread-b')).toMatchObject({ traces: 1, turnCosts: [{ turn: 1, costUsd: 0.25, modelCalls: 1 }] })
      }),
    ),
  )

  it.effect('finds the trace of one thread turn', () =>
    seeded(
      Effect.fn(function* (store) {
        const ids = (turn: number) => Effect.map(store.list({ sessionId: 'thread-a', turn }), list => list.traces.map(trace => trace.traceId))
        expect(yield* ids(2)).toEqual([traceId(2)])
        expect(yield* ids(1)).toEqual([traceId(1)])
        expect(yield* ids(9)).toEqual([])
      }),
    ),
  )

  it.effect('reports model calls, tokens and cost per service and model in the overview', () =>
    seeded(
      Effect.fn(function* (store) {
        expect((yield* store.stats({ windowMinutes: 60, limit: 10 })).models).toEqual([
          { service: 'dshfiles', provider: 'openai', model: 'gpt-test', calls: 5, inputTokens: 5_000, outputTokens: 500, costUsd: 0.78 },
        ])
      }),
    ),
  )

  it('formats list prices', () => {
    expect([null, 0, 0.00004, 0.0004, 0.01234, 0.5, 1, 12.345].map(value => TraceFormat.usd(value))).toEqual([
      '—',
      '$0',
      '<$0.0001',
      '$0.0004',
      '$0.0123',
      '$0.5',
      '$1.00',
      '$12.35',
    ])
    expect(TraceFormat.spanCostUsd({ 'dshx.cost.usd': 0.2 })).toBe(0.2)
    expect(TraceFormat.spanCostUsd({ 'dshx.cost.usd': '0.2' })).toBeNull()
  })
})
