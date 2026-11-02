import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { chartQuerySchema, chartViewSchema, requestQuerySchema, usageApi } from './api.js'
import { UsageFoldModel, type RequestRow } from './fold.js'
import { UsageRepo } from './store.js'
import { usageRepoTest } from './test-layers.js'
import * as Schema from 'effect/Schema'

// oxlint-disable-next-line antislop/no-unknown-parameters -- this is the boundary: the schema parses the unknown test input
const strictParse = <ValueSchema extends Schema.ConstraintDecoder<unknown>>(schema: ValueSchema, value: unknown): ValueSchema['Type'] =>
  Schema.decodeUnknownSync(schema, { onExcessProperty: 'error' })(value)

// oxlint-disable-next-line antislop/no-unknown-parameters -- this is the boundary: the schema parses the unknown test input
const strictAccepts = <ValueSchema extends Schema.ConstraintDecoder<unknown>>(schema: ValueSchema, value: unknown): boolean =>
  Schema.decodeUnknownResult(schema, { onExcessProperty: 'error' })(value)._tag === 'Success'

const row = (id: string, provider: string, startedAt: number, patch: Partial<RequestRow> = {}): RequestRow => ({
  id,
  provider,
  startedAt,
  sessionId: provider,
  model: 'model',
  purpose: 'agent',
  source: 'log',
  seq: 1,
  messageId: null,
  turn: 1,
  step: 1,
  endedAt: startedAt + 100,
  ttftMs: 10,
  usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
  status: 'ok',
  stopReason: null,
  errorCode: null,
  ...patch,
})
const seed = Effect.fn(function* (rows: RequestRow[]) {
  const store = yield* UsageRepo
  yield* store.commitLogSlice({ path: '/scope', sessionId: 'scope', offset: 1, size: 1, mtimeMs: 1, state: '{}', session: null, rows })
  yield* store.writeRates({
    replace: true,
    rates: new Map(
      ['Account', 'account', 'Account-extra'].map(provider => [
        provider,
        {
          route: { provider, model: 'model', band: 0 },
          rates: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
        },
      ]),
    ),
  })
  return store
})
const query = { from: 1_000, to: 2_000, provider: 'Account', bucket: 'hour', groupBy: 'provider', tzOffsetMinutes: 0 } as const

describe('exact account provider scope', () => {
  it.effect('retains the actual message account route instead of the originally selected pool route', () =>
    Effect.gen(function* () {
      const folded = UsageFoldModel.foldRecords({
        state: UsageFoldModel.initialFoldState(),
        sessionId: 'session',
        records: [
          { type: 'request/header', seq: 1, time: 0, data: { header: { config: { provider: 'codex-pool', model: 'model' } } } },
          { type: 'step/start', seq: 2, time: 100, data: { turn: 1, step: 1 } },
          {
            type: 'assistant/message',
            seq: 3,
            time: 300,
            data: { turn: 1, step: 1, message: { id: 'm', source: { provider: 'Codex-Account-2', model: 'model' } }, stream: [] },
          },
        ],
      })
      expect(folded.rows[0]?.provider).toBe('Codex-Account-2')
      const store = yield* seed(folded.rows)
      expect((yield* store.requests({ from: 0, to: 1_000, provider: 'Codex-Account-2', sort: 'startedAt', direction: 'desc', limit: 5 })).total).toBe(1)
      expect((yield* store.requests({ from: 0, to: 1_000, provider: 'codex-pool', sort: 'startedAt', direction: 'desc', limit: 5 })).total).toBe(0)
    }).pipe(Effect.provide(usageRepoTest())),
  )

  it.effect('computes the mean and totals over more than the recent-request page limit', () =>
    Effect.gen(function* () {
      const rows = Array.from({ length: 501 }, (_, index) =>
        row(`own-${String(index)}`, 'Account', 1_100 + index, { endedAt: 1_100 + index + (index === 0 ? 10_000 : 100) }),
      )
      const store = yield* seed(rows)
      const charts = yield* store.charts(query)
      expect(charts.summary.requests).toBe(501)
      expect(charts.summary.averageDurationMs).toBeCloseTo(60_000 / 501)
      expect(charts.summary.input).toBe(5_010)
      expect((yield* store.requests({ ...query, sort: 'startedAt', direction: 'desc', limit: 5 })).rows).toHaveLength(5)
    }).pipe(Effect.provide(usageRepoTest())),
  )

  it.effect('scopes all aggregates, comparisons, latency and threads before any limit', () =>
    Effect.gen(function* () {
      const store = yield* seed([
        row('previous', 'Account', 500, { endedAt: 700 }),
        row('a', 'Account', 1_100, { endedAt: 1_200 }),
        row('b', 'Account', 1_200, { endedAt: 1_500 }),
        row('case', 'account', 1_300, { endedAt: 99_000, status: 'failed' }),
        row('prefix', 'Account-extra', 1_400),
        row('otherPrevious', 'account', 600),
        ...Array.from({ length: 510 }, (_, index) => row(`other-${String(index)}`, 'other', 1_900)),
      ])
      const charts = yield* store.charts(query)
      expect(charts.appliedProvider).toBe('Account')
      expect(charts.summary).toMatchObject({
        requests: 2,
        input: 20,
        output: 10,
        failed: 0,
        averageDurationMs: 200,
        missingUsage: 0,
        unpriced: 0,
        previous: { requests: 1, tokens: 15, averageDurationMs: 200 },
      })
      expect(charts.summary.cost).toBeCloseTo(0.00004)
      expect(charts.summary.previous.cost).toBeCloseTo(0.00002)
      expect(charts.breakdown.provider.map(entry => entry.key)).toEqual(['Account'])
      expect(charts.breakdown.provider[0]).toMatchObject({
        requests: 2,
        sessions: 1,
        input: 20,
        cacheRead: 0,
        cacheWrite: 0,
        output: 10,
        tokens: 30,
        missingUsage: 0,
        unpriced: 0,
      })
      expect(charts.breakdown.purpose?.[0]?.key).toBe('agent')
      expect(charts.buckets.reduce((sum, entry) => sum + entry.requests, 0)).toBe(2)
      expect(charts.latency[0]).toMatchObject({ durationP50: 300, durationP90: 300 })
      expect(charts.topThreads.map(entry => entry.sessionId)).toEqual(['Account'])
      const requests = yield* store.requests({ ...query, sort: 'startedAt', direction: 'desc', limit: 1 })
      expect(requests).toMatchObject({ appliedProvider: 'Account', total: 2, statusCounts: { all: 2, ok: 2 }, purposeCounts: { agent: 2 } })
      expect(requests.rows.map(entry => entry.id)).toEqual(['b'])
      expect((yield* store.requests({ ...query, provider: "Account' OR 1=1 --", sort: 'startedAt', direction: 'desc', limit: 500 })).total).toBe(0)
    }).pipe(Effect.provide(usageRepoTest())),
  )

  it.effect('also scopes new main cache savings, turn counts and purpose series', () =>
    Effect.gen(function* () {
      const store = yield* seed([
        row('previous', 'Account', 500, { turn: 2, usage: { input: 10, output: 5, cacheRead: 5, cacheWrite: 0, reasoning: 0 } }),
        row('current', 'Account', 1_100, { turn: 3, usage: { input: 10, output: 5, cacheRead: 8, cacheWrite: 0, reasoning: 0 } }),
        row('subagent', 'Account', 1_200, { turn: 4, purpose: 'subagent' }),
        row('excluded', 'account', 1_300, { turn: 99, purpose: 'memory', usage: { input: 1, output: 1, cacheRead: 99_999, cacheWrite: 0, reasoning: 0 } }),
      ])
      const charts = yield* store.charts({ ...query, groupBy: 'purpose' })
      expect(charts.summary.turns).toBe(2)
      expect(charts.summary.previous.turns).toBe(1)
      expect(charts.summary.cacheSavings).toBeCloseTo(0.000008)
      expect(charts.summary.previous.cacheSavings).toBeCloseTo(0.000005)
      expect([...charts.keys].sort()).toEqual(['agent', 'subagent'])
      expect(charts.buckets.reduce((sum, entry) => sum + entry.requests, 0)).toBe(2)
    }).pipe(Effect.provide(usageRepoTest())),
  )

  it.effect('keeps unknown token counts and absent durations distinguishable from zero', () =>
    Effect.gen(function* () {
      const store = yield* seed([
        row('missing', 'Account', 1_100, { usage: null, endedAt: null }),
        row('unpriced', 'Account', 1_200, { model: 'unknown', endedAt: null }),
      ])
      const charts = yield* store.charts(query)
      expect(charts.summary).toMatchObject({ requests: 2, missingUsage: 1, unpriced: 1, averageDurationMs: null, previous: { averageDurationMs: null } })
      expect(charts.breakdown.model.find(entry => entry.key === 'model')?.missingUsage).toBe(1)
      expect(charts.buckets.reduce((sum, entry) => sum + (entry.missingUsage ?? 0), 0)).toBe(1)
      const requests = yield* store.requests({ ...query, sort: 'startedAt', direction: 'desc', limit: 5 })
      expect(requests.rows.find(entry => entry.id === 'missing')).toMatchObject({ input: null, output: null, durationMs: null, cost: null })
      const empty = yield* store.charts({ ...query, provider: 'absent' })
      expect(empty.summary).toMatchObject({ requests: 0, averageDurationMs: null })
      expect(empty.buckets).toEqual([])
      expect(empty.topThreads).toEqual([])
    }).pipe(Effect.provide(usageRepoTest())),
  )

  it('shares optional bounded provider inputs with the existing agent tools and decodes old Hosts', () => {
    expect(strictParse(chartQuerySchema, query).provider).toBe('Account')
    const requests = { from: 0, to: 1, sort: 'startedAt', direction: 'desc', limit: 5 } as const
    expect(strictParse(requestQuerySchema, requests).provider).toBeUndefined()
    expect(strictAccepts(requestQuerySchema, { ...requests, provider: '' })).toBe(false)
    expect(strictAccepts(chartQuerySchema, { ...query, provider: 'a'.repeat(257) })).toBe(false)
    expect(usageApi.methods.requests.tool?.readOnly).toBe(true)
    expect(usageApi.methods.charts.tool?.readOnly).toBe(true)
    const old = strictParse(chartViewSchema, {
      summary: {
        cost: 0,
        requests: 0,
        failed: 0,
        aborted: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        unpriced: 0,
        previous: { cost: 0, requests: 0, tokens: 0 },
      },
      keys: [],
      buckets: [],
      breakdown: { model: [], provider: [], project: [] },
      latency: [],
      topThreads: [],
    })
    expect(old.appliedProvider).toBeUndefined()
    expect(old.summary.averageDurationMs).toBeNull()
    expect(old.summary.previous.averageDurationMs).toBeNull()
  })
})
