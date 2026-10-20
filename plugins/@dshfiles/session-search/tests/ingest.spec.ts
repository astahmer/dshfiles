import { appendFile, mkdtemp, rm } from 'node:fs/promises'
import { constants, zstdCompressSync } from 'node:zlib'
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

it('indexes an event the writer split across frames and catches the log up', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-search-split-'))
  roots.push(root)
  const sessionId = 'session-eeeeeeee-0000-4000-8000-000000000000'
  const path = await writeSessionLog({ directory: join(root, 'sessions', 'project', sessionId), exchanges: 1, sessionId })
  const line = `${JSON.stringify({
    type: 'user/message',
    seq: 4,
    time: 1_700_000_100_000,
    surfaceOp: 'append',
    data: { id: 'msg-split', role: 'user', content: [{ type: 'text', text: 'the zanzibar ledger drifted' }], source: { kind: 'user' } },
  })}\n`
  const frame = (text: string): Buffer => zstdCompressSync(Buffer.from(text, 'utf8'), { params: { [constants.ZSTD_c_checksumFlag]: 1 } })
  await appendFile(path, Buffer.concat([frame(line.slice(0, 40)), frame(line.slice(40))]))
  const index = new SearchIndex(join(root, 'index.sqlite'))

  let behind = 1
  for (let pass = 0; pass < 10 && behind > 0; pass += 1)
    behind = (await runIngestPass({ index, root: join(root, 'sessions'), budgetMs: 10_000, windowBytes: 1024 * 1024, now: Date.now })).behindSessions

  expect(behind).toBe(0)
  expect(index.searchSessions({ query: 'zanzibar', limit: 5 }).matches.map(match => match.header.id)).toEqual([sessionId])
  index.close()
})
