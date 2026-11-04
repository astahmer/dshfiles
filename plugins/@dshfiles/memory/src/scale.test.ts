import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { TestClock } from 'effect/testing'

import { renderStartBlock } from './block.ts'
import { repoLayer } from './testing/memory-store.ts'
import { seedSyntheticCorpus } from './testing/synthetic-corpus.ts'

const now = 1_800_000_000_000

describe('memory at scale', () => {
  it.effect(
    'keeps the start block within its byte budget once a project outgrows it',
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(now)
        const { projects } = yield* seedSyntheticCorpus({ items: 1_000, projects: 40, now })
        const budgetBytes = 1_000
        const outgrown: string[] = []
        for (const project of projects)
          if (Buffer.byteLength(yield* renderStartBlock({ project, budgetBytes: 8_192, crossProject: true, staleDays: 90 })) > budgetBytes)
            outgrown.push(project)
        expect(outgrown.length).toBeGreaterThanOrEqual(10)
        for (const project of outgrown) {
          const block = yield* renderStartBlock({ project, budgetBytes, crossProject: true, staleDays: 90 })
          expect(Buffer.byteLength(block)).toBeLessThanOrEqual(budgetBytes)
          expect(block).toContain('Threads in')
        }
      }).pipe(Effect.provide(repoLayer(':memory:'))),
    30_000,
  )
})
