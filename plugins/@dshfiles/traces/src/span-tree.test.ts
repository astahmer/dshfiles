import { describe, expect, test } from 'vitest'
import { buildSpanTree } from './span-tree.js'
import { LatencyStats } from './stats.js'

const span = (spanId: string, parentSpanId: string | null, startUs: number) => ({ spanId, parentSpanId, startUs })

describe('buildSpanTree', () => {
  test('orders depth-first with children by start time and counts children', () => {
    const tree = buildSpanTree([span('c2', 'root', 30), span('root', null, 0), span('c1', 'root', 10), span('g1', 'c1', 15)])
    expect(tree.map(entry => [entry.span.spanId, entry.depth, entry.childCount])).toEqual([
      ['root', 0, 2],
      ['c1', 1, 1],
      ['g1', 2, 0],
      ['c2', 1, 0],
    ])
  })

  test('treats a span whose parent is missing as a root', () => {
    const tree = buildSpanTree([span('orphan', 'gone', 5), span('root', null, 0)])
    expect(tree.map(entry => [entry.span.spanId, entry.depth])).toEqual([
      ['root', 0],
      ['orphan', 0],
    ])
  })

  test('lists a parent cycle flat instead of dropping or looping', () => {
    const tree = buildSpanTree([span('a', 'b', 0), span('b', 'a', 1)])
    expect(tree.map(entry => entry.span.spanId).sort()).toEqual(['a', 'b'])
  })
})

describe('latency statistics', () => {
  test('uses nearest-rank percentiles', () => {
    const values = Array.from({ length: 100 }, (_, index) => index + 1)
    expect(LatencyStats.percentile(values, 0.5)).toBe(50)
    expect(LatencyStats.percentile(values, 0.95)).toBe(95)
    expect(LatencyStats.percentile(values, 0.99)).toBe(99)
    expect(LatencyStats.percentile([7], 0.99)).toBe(7)
    expect(LatencyStats.percentile([], 0.5)).toBeNull()
  })

  test('summarizes count, error rate and percentiles', () => {
    expect(
      LatencyStats.summarize([
        { durationMs: 30, error: false },
        { durationMs: 10, error: true },
        { durationMs: 20, error: false },
        { durationMs: 40, error: true },
      ]),
    ).toEqual({ count: 4, errorCount: 2, errorRate: 0.5, p50Ms: 20, p95Ms: 40, p99Ms: 40, maxMs: 40 })
  })
})
