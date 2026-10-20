import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { SearchIndex } from '../src/index-db.js'
import { runIngestPass } from '../src/ingest.js'
import { writeSessionLog } from './session-log-fixture.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('ingests a log whose frames are larger than the read window', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-search-ingest-'))
  roots.push(root)
  const sessionId = 'session-dddddddd-0000-4000-8000-000000000000'
  await writeSessionLog({ directory: join(root, 'sessions', 'project', sessionId), exchanges: 4, sessionId })
  const index = new SearchIndex(join(root, 'index.sqlite'))

  let documents = 0
  for (let pass = 0; pass < 50; pass += 1) {
    const result = await runIngestPass({ index, root: join(root, 'sessions'), budgetMs: 10_000, windowBytes: 16, now: Date.now })
    documents += result.documents
    if (result.behindSessions === 0) break
  }

  expect(documents).toBeGreaterThan(0)
  expect(index.searchSessions({ query: 'retry storm', limit: 5 }).matches.map(match => match.header.id)).toContain(sessionId)
  index.close()
})
