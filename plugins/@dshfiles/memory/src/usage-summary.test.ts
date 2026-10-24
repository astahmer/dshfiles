import { describe, expect, test } from 'vitest'
import type { MemoryUsage } from './api.js'
import { renderUsageSummary, snapshotOf } from './usage-summary.js'

const usage = (overrides: Partial<MemoryUsage> = {}): MemoryUsage => ({
  state: 'ready',
  failure: null,
  retrieval: { requested: 'bm25', active: 'bm25', model: null, reason: null },
  threads: 1_000,
  notes: 72,
  indexedMessages: 788_109,
  blocksServed: 5_342,
  citations: 106,
  digests: { trail: 990, model: 12, duplicate: 3, trivial: 1, modelFailures: 0 },
  jev: { calls: 540, inputTokens: 235_395, failures: 1 },
  tools: [
    { tool: 'memory_read', calls: 320, withResults: 300, empty: 12, used: 40 },
    { tool: 'memory_search', calls: 1_204, withResults: 880, empty: 312, used: 96 },
    { tool: 'memory_notes', calls: 5, withResults: 5, empty: 0, used: 1 },
  ],
  costs: { days: [], total: { digest: { calls: 3, input: 9_000, cacheRead: 0, output: 900, usd: 0.41 }, jev: { calls: 540, input: 235_395, usd: 0.01 } } },
  effectiveness: {
    block: { threads: 9, meanBytes: 1_400, maxBytes: 1_600, requests: 44 },
    citations: { total: 106, agentCorrected: 2, userCorrected: 1, up: 4, down: 1 },
  },
  noteCounts: { active: 72, superseded: 12, forgotten: 1 },
  daily: [],
  events: [],
  topNotes: [
    {
      id: 91,
      project: '/repo',
      type: 'feedback',
      scope: 'repo',
      confidence: 'stated',
      text: 'Pause the goal when the user says stop.',
      sourceThread: null,
      sourceSeq: null,
      origin: 'agent',
      createdAt: 0,
      updatedAt: 0,
      citations: 12,
      status: 'valid',
      supersedes: null,
      supersededBy: null,
      reason: null,
    },
  ],
  ...overrides,
})

describe('memory usage summary', () => {
  test('projects the panel counters into a bounded snapshot', () => {
    const snapshot = snapshotOf(usage(), 30)
    expect(snapshot.tools.map(tool => tool.tool)).toEqual(['memory_search', 'memory_read', 'memory_notes'])
    expect(snapshot.topNotes).toEqual([{ id: 91, citations: 12, text: 'Pause the goal when the user says stop.' }])
    expect(snapshot.costUsd).toBe(0.41)
    expect(snapshot.days).toBe(30)
  })

  test('keeps only the five busiest tools and the five most cited notes', () => {
    const many = usage({
      tools: Array.from({ length: 8 }, (_, index) => ({ tool: `tool-${String(index)}`, calls: index, withResults: index, empty: 0, used: 0 })),
      topNotes: Array.from({ length: 8 }, (_, index) => ({ ...usage().topNotes[0]!, id: index, citations: index })),
    })
    const snapshot = snapshotOf(many, 7)
    expect(snapshot.tools).toHaveLength(5)
    expect(snapshot.tools[0]?.tool).toBe('tool-7')
    expect(snapshot.topNotes).toHaveLength(5)
  })

  test('renders the counters a reader can act on', () => {
    const text = renderUsageSummary(snapshotOf(usage(), 30))
    expect(text).toContain('memory: ready')
    expect(text).toContain('retrieval BM25')
    expect(text).toContain('72 notes (72 valid, 12 superseded, 1 forgotten)')
    expect(text).toContain('5,342 start blocks')
    expect(text).toContain('memory_search 1,204 calls (312 empty, 96 cited)')
    expect(text).toContain('4 up · 1 down · 2 agent-corrected · 1 user-corrected')
    expect(text).toContain('$0.41 over the window')
    expect(text).toContain('n:91 "Pause the goal')
  })

  test('explains a turned-off memory and a hybrid fallback', () => {
    const off = renderUsageSummary(snapshotOf(usage({ state: 'failed', failure: 'store unavailable' }), 30))
    expect(off).toContain('memory: failed (store unavailable)')
    const hybrid = renderUsageSummary(
      snapshotOf(usage({ retrieval: { requested: 'hybrid', active: 'bm25', model: null, reason: 'embedding provider did not load' } }), 30),
    )
    expect(hybrid).toContain('retrieval BM25 — embedding provider did not load')
  })
})
