import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createMemoryEngine, type MemoryConfig, type MemoryEventInput, type Summarizer } from '@dshfiles/optmem-core'

import { openSqliteMemory } from '../sqlite-memory.ts'

export const createTempDirectory = (): { readonly directory: string; cleanup(): void } => {
  const directory = mkdtempSync(join(tmpdir(), 'optmem-test-'))
  return { directory, cleanup: () => rmSync(directory, { recursive: true, force: true }) }
}

export const openEngine = async (request: { readonly path: string; readonly summarizer: Summarizer; readonly config?: Partial<MemoryConfig> }) => {
  const memory = openSqliteMemory({ path: request.path })
  const engine = createMemoryEngine({
    store: memory.store,
    search: memory.search,
    summarizer: request.summarizer,
    // Tests drive recovery explicitly; the periodic sweep and the call-rate gate are opt-in so neither a timer nor a
    // frozen clock can stall a test.
    config: { catchUpIntervalMs: 0, summaryCallsPerMinute: 0, ...request.config },
    clock: { now: () => 1_700_000_000_000 },
  })
  await engine.start()
  return { memory, engine }
}

let sequence = 0

export const event = (fields: Partial<MemoryEventInput> & Pick<MemoryEventInput, 'conversationId' | 'text'>): MemoryEventInput => {
  sequence++
  return {
    eventKey: `test:${fields.conversationId}:${sequence}`,
    harness: 'test',
    role: 'user',
    createdAt: 1_700_000_000_000 + sequence,
    ...fields,
  }
}
