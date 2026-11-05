import { describe, expect, it } from 'vitest'
import type { ChartView } from './api.js'
import { spendDimensions } from './usage-spend-map.js'

const row = (key: string, cost: number, requests: number, unpriced = 0): ChartView['breakdown']['model'][number] => ({
  key,
  cost,
  requests,
  tokens: requests * 100,
  missingUsage: 0,
  unpriced,
})

const bucket = (start: number, key: string, cost: number): ChartView['buckets'][number] => ({
  start,
  key,
  cost,
  requests: 1,
  failed: 0,
  input: 10,
  cacheRead: 0,
  cacheWrite: 0,
  output: 5,
  missingUsage: 0,
  unpriced: 0,
})

const view: ChartView = {
  summary: {
    cost: 9,
    requests: 9,
    failed: 0,
    aborted: 0,
    input: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    unpriced: 1,
    missingUsage: 0,
    averageDurationMs: null,
    cacheSavings: 0,
    turns: 0,
    previous: { cost: 0, requests: 0, tokens: 0, averageDurationMs: null, cacheSavings: 0, turns: 0 },
  },
  keys: ['m1', 'm2'],
  buckets: [bucket(2, 'm1', 1), bucket(1, 'm1', 2), bucket(1, 'm2', 3)],
  breakdown: {
    model: [row('m1', 3, 2), row('m2', 3, 1, 1), ...['m3', 'm4', 'm5', 'm6', 'm7', 'm8'].map(key => row(key, 0.5, 1))],
    provider: [row('Codex', 9, 9)],
    project: [],
    purpose: [row('subagent', 9, 9)],
  },
  latency: [],
  topThreads: [],
}

describe('usage spend map', () => {
  it('splits every breakdown, folds the tail into one entry and charts only the grouped dimension', () => {
    const dimensions = spendDimensions({ view, metric: 'cost', groupBy: 'model' })
    expect(dimensions.map(dimension => dimension.id)).toEqual(['model', 'provider', 'project', 'purpose'])
    const models = dimensions[0]?.leaves ?? []
    expect(models.map(leaf => leaf.label)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5', 'm6', '2 more'])
    expect(models[0]?.share).toBeCloseTo(3 / 9)
    expect(models.at(-1)?.amount).toBe(1)
    expect(models[0]?.series).toEqual([2, 1])
    expect(models[1]?.series).toEqual([3, 0])
    expect(models[1]?.flag).toEqual({ label: 'Unpriced', tone: 'warning' })
    expect(dimensions[1]?.leaves[0]?.series).toBeUndefined()
    expect(dimensions[3]?.leaves[0]?.label).toBe('Subagent')
  })

  it('ranks by the chosen measure and omits a breakdown an older Host does not send', () => {
    const { purpose: _purpose, ...breakdown } = view.breakdown
    const dimensions = spendDimensions({ view: { ...view, breakdown }, metric: 'requests', groupBy: 'project' })
    expect(dimensions.map(dimension => dimension.id)).toEqual(['model', 'provider', 'project'])
    expect(dimensions[0]?.leaves[0]).toMatchObject({ id: 'm1', amount: 2 })
    expect(dimensions[0]?.leaves[0]?.flag).toBeUndefined()
  })
})
