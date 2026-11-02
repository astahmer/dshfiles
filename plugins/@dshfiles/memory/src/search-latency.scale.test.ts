import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'

import { MemoryRepo } from './memory-repo.ts'
import { repoLayer } from './testing/memory-store.ts'
import { seedSyntheticCorpus } from './testing/synthetic-corpus.ts'

// Wall-clock budget: run alone on an idle machine with `pnpm test:scale`; `pnpm test` excludes it.
describe('memory search latency', () => {
  it.live(
    'answers p95 searches under 150 ms with 5,000 digests and notes',
    () =>
      Effect.gen(function* () {
        const store = yield* MemoryRepo
        const { questions } = yield* seedSyntheticCorpus({ items: 5_000, projects: 40, now: Date.now() })
        const usage = yield* store.usage
        expect(usage.threads + usage.notes).toBeGreaterThan(4_900)
        const timings: number[] = []
        for (const question of [...questions, ...questions]) {
          const started = performance.now()
          yield* store.search({ query: question.query, projects: [], ownProject: question.project, limit: 6 })
          timings.push(performance.now() - started)
        }
        timings.sort((left, right) => left - right)
        const p95 = timings[Math.floor(timings.length * 0.95)] ?? Number.POSITIVE_INFINITY
        expect(p95).toBeLessThan(150)
      }).pipe(Effect.provide(repoLayer(':memory:'))),
    60_000,
  )
})
