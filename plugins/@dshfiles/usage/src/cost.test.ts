import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { RequestRow } from './fold.js'
import { createRatePricer, ratesAt } from './pricing.js'
import { openUsageStore } from './store.js'

const request = (overrides: Partial<RequestRow> & Pick<RequestRow, 'id' | 'startedAt'>): RequestRow => ({
  sessionId: 'session-a',
  seq: 1,
  messageId: null,
  turn: 1,
  step: 1,
  purpose: 'agent',
  source: 'log',
  provider: 'codex-alex',
  model: 'gpt-6-luna',
  endedAt: overrides.startedAt + 1_000,
  ttftMs: 200,
  usage: { input: 60_000, cacheRead: 30_000, cacheWrite: 0, output: 10_000, reasoning: 0 },
  status: 'ok',
  stopReason: 'toolUse',
  errorCode: null,
  ...overrides,
})

const scratchDirs: string[] = []
afterEach(async () => {
  await Promise.all(scratchDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
})

describe('ratesAt', () => {
  it('uses the tier a request prompt exceeds and bills a missing cache rate as input', () => {
    const price = { input: 2, output: 8, tiers: [{ above: 200_000, input: 4, output: 16, cacheRead: 0.4 }] }
    expect(ratesAt({ price, band: 0 })).toEqual({ input: 2, output: 8, cacheRead: 2, cacheWrite: 2 })
    expect(ratesAt({ price, band: 272_000 })).toEqual({ input: 4, output: 16, cacheRead: 0.4, cacheWrite: 4 })
  })
})

describe('request costs', () => {
  it('prices each request at its route and band list price, and reports unpriced routes', () => {
    const store = openUsageStore(':memory:')
    store.commitLogSlice({
      path: '/x',
      sessionId: 'session-a',
      offset: 1,
      size: 1,
      mtimeMs: 1,
      state: '{}',
      session: { id: 'session-a', cwd: '/home/user/dev-threads/thread-1', parentSession: null, subagent: false, createdAt: 0, title: 'T' },
      rows: [
        request({ id: 'a', startedAt: 1_000 }),
        request({ id: 'b', startedAt: 2_000, usage: { input: 300_000, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 } }),
        request({ id: 'c', startedAt: 3_000, provider: 'mystery', model: 'unknown-model' }),
      ],
    })
    store.writeRates({
      replace: true,
      rates: new Map([
        [
          'luna@32000',
          { route: { provider: 'codex-alex', model: 'gpt-6-luna', band: 32_000 }, rates: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.1 } },
        ],
        [
          'luna@272000',
          { route: { provider: 'codex-alex', model: 'gpt-6-luna', band: 272_000 }, rates: { input: 0.2, output: 1, cacheRead: 0.02, cacheWrite: 0.2 } },
        ],
      ]),
    })
    const rows = store.requests({ from: 0, to: 10_000, sort: 'cost', direction: 'desc', limit: 10 }).rows
    // The 300k-token prompt sits in the 272k band: 0.3M × $0.2 = $0.06; the 90k one in the 32k band:
    // 0.06M × $0.1 + 0.03M × $0.01 + 0.01M × $0.5 = $0.0113.
    expect(rows.map(row => [row.id, row.cost === null ? null : Number(row.cost.toFixed(6)), row.project])).toEqual([
      ['b', 0.06, 'dev'],
      ['a', 0.0113, 'dev'],
      ['c', null, 'dev'],
    ])
    const charts = store.charts({ from: 0, to: 10_000, bucket: 'hour', groupBy: 'model', tzOffsetMinutes: 0 })
    expect(charts.summary.cost).toBeCloseTo(0.0713, 10)
    expect(charts.summary.unpriced).toBe(1)
    expect(charts.topThreads).toEqual([{ sessionId: 'session-a', title: 'T', project: 'dev', cost: expect.closeTo(0.0713, 10), requests: 3 }])
    expect(charts.breakdown.model.map(row => row.key)).toEqual(['gpt-6-luna', 'unknown-model'])
  })

  it('prices routes from the AI Accounts catalog file and re-prices when the catalog changes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-pricing-'))
    scratchDirs.push(dir)
    const pricingPath = join(dir, 'pricing.json')
    const catalog = (input: number) =>
      JSON.stringify({ version: 1, fetchedAt: input, source: 'test', providers: { openai: { 'gpt-6-luna': { input, output: 0.5, cacheRead: 0.01 } } } })
    await writeFile(pricingPath, catalog(0.1))
    const store = openUsageStore(':memory:')
    store.commitLogSlice({
      path: '/x',
      sessionId: 'session-a',
      offset: 1,
      size: 1,
      mtimeMs: 1,
      state: '{}',
      session: null,
      rows: [request({ id: 'a', startedAt: 1_000 })],
    })
    const pricer = createRatePricer({ store, pricingPath })
    await pricer.update()
    expect(store.requests({ from: 0, to: 10_000, sort: 'cost', direction: 'desc', limit: 1 }).rows[0]?.cost).toBeCloseTo(0.0113, 10)

    await writeFile(pricingPath, catalog(0.2))
    await pricer.update()
    expect(store.requests({ from: 0, to: 10_000, sort: 'cost', direction: 'desc', limit: 1 }).rows[0]?.cost).toBeCloseTo(0.0173, 10)
    expect(pricer.fetchedAt()).toBe(0.2)
  })

  it('prices a route that first appears after an earlier pass, without a catalog change', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'usage-pricing-'))
    scratchDirs.push(dir)
    const pricingPath = join(dir, 'pricing.json')
    const price = { input: 0.1, output: 0.5, cacheRead: 0.01 }
    await writeFile(
      pricingPath,
      JSON.stringify({ version: 1, fetchedAt: 1, source: 'test', providers: { openai: { 'gpt-6-luna': price, 'gpt-6-sol': price, 'gpt-6-terra': price } } }),
    )
    const store = openUsageStore(':memory:')
    const slice = (id: string, model: string, offset: number) => ({
      path: '/x',
      sessionId: 'session-a',
      offset,
      size: offset,
      mtimeMs: offset,
      state: '{}',
      session: null,
      rows: [request({ id, startedAt: 1_000 * offset, model })],
    })
    const pricer = createRatePricer({ store, pricingPath })
    store.commitLogSlice(slice('a', 'gpt-6-luna', 1))
    await pricer.update()

    store.commitLogSlice(slice('b', 'gpt-6-sol', 2))
    await pricer.update()
    store.commitLogSlice(slice('c', 'gpt-6-terra', 3))
    await pricer.update()
    const costs = store.requests({ from: 0, to: 10_000, sort: 'cost', direction: 'desc', limit: 3 }).rows.map(row => row.cost)
    expect(costs).toHaveLength(3)
    expect(costs.every(cost => cost !== null && cost > 0)).toBe(true)
  })
})
