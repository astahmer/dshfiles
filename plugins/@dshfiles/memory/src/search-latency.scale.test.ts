import { describe, expect, it } from 'vitest'

import { openMemoryStore } from './store.ts'
import { seedSyntheticCorpus } from './testing/synthetic-corpus.ts'

// Wall-clock budget: run alone on an idle machine with `pnpm test:scale`; `pnpm test` excludes it.
describe('memory search latency', () => {
  it('answers p95 searches under 150 ms with 5,000 digests and notes', () => {
    const now = Date.now()
    const store = openMemoryStore({ path: ':memory:', now: () => now })
    const { questions } = seedSyntheticCorpus({ store, items: 5_000, projects: 40, now })
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
  }, 60_000)
})
