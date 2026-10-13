import { describe, expect, it } from 'vitest'

import { renderStartBlock } from './block.ts'
import { openMemoryStore } from './store.ts'
import { seedSyntheticCorpus } from './testing/synthetic-corpus.ts'

describe('memory at scale', () => {
  it('keeps search latency and the start block bounded with 5,000 digests and notes', () => {
    const now = Date.now()
    const store = openMemoryStore({ path: ':memory:', now: () => now })
    const { projects, questions } = seedSyntheticCorpus({ store, items: 5_000, projects: 40, now })
    expect(store.usage().threads + store.usage().notes).toBeGreaterThan(4_900)
    const timings: number[] = []
    for (const question of [...questions, ...questions]) {
      const started = performance.now()
      store.search({ query: question.query, projects: [], ownProject: question.project, limit: 6 })
      timings.push(performance.now() - started)
    }
    timings.sort((left, right) => left - right)
    const p95 = timings[Math.floor(timings.length * 0.95)] ?? Number.POSITIVE_INFINITY
    expect(p95).toBeLessThan(150)
    for (const project of projects.slice(0, 10)) {
      const block = renderStartBlock({ store, project, budgetBytes: 1_600, crossProject: true, staleDays: 90 })
      expect(Buffer.byteLength(block)).toBeLessThanOrEqual(1_600)
      expect(block).toContain('Threads in')
    }
  }, 60_000)
})
