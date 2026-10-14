import { describe, expect, it } from 'vitest'

import { renderStartBlock } from './block.ts'
import { openMemoryStore } from './store.ts'
import { seedSyntheticCorpus } from './testing/synthetic-corpus.ts'

describe('memory at scale', () => {
  it('keeps the start block within its byte budget once a project outgrows it', () => {
    const now = Date.now()
    const store = openMemoryStore({ path: ':memory:', now: () => now })
    const { projects } = seedSyntheticCorpus({ store, items: 1_000, projects: 40, now })
    const budgetBytes = 1_000
    const outgrown = projects.filter(
      project => Buffer.byteLength(renderStartBlock({ store, project, budgetBytes: 8_192, crossProject: true, staleDays: 90 })) > budgetBytes,
    )
    expect(outgrown.length).toBeGreaterThanOrEqual(10)
    for (const project of outgrown) {
      const block = renderStartBlock({ store, project, budgetBytes, crossProject: true, staleDays: 90 })
      expect(Buffer.byteLength(block)).toBeLessThanOrEqual(budgetBytes)
      expect(block).toContain('Threads in')
    }
  })
})
