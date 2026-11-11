import { appendFile, mkdtemp, rm } from 'node:fs/promises'
import { constants, zstdCompressSync } from 'node:zlib'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Effect } from 'effect'
import * as Duration from 'effect/Duration'
import { IdleBackoff, indexSessions, runIngestPass } from '../src/ingest.js'
import { writeSessionLog } from './session-log-fixture.js'
import { runWithIndex } from './index-harness.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

it('maps rowids across several insert chunks for one oversized batch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-search-chunks-'))
  roots.push(root)
  const sessionId = 'session-cccccccc-0000-4000-8000-000000000000'
  const path = await writeSessionLog({ directory: join(root, 'sessions', 'project', sessionId), exchanges: 1, sessionId })
  // Over 1 MiB of document text in one batch: the insert path splits it into several statements, and every rowid must
  // still map back to its document.
  for (let index = 0; index < 20; index += 1) {
    const line = `${JSON.stringify({
      type: 'user/message',
      seq: 4 + index,
      time: 1_700_000_200_000 + index,
      surfaceOp: 'append',
      data: {
        id: `msg-${String(index)}`,
        role: 'user',
        content: [{ type: 'text', text: `${'padding '.repeat(8_000)}needle${String(index)} ${index === 19 ? 'zebra' : ''}` }],
        source: { kind: 'user' },
      },
    })}\n`
    await appendFile(path, zstdCompressSync(Buffer.from(line, 'utf8'), { params: { [constants.ZSTD_c_checksumFlag]: 1 } }))
  }

  const outcome = await runWithIndex(join(root, 'index.sqlite'), function* (index) {
    const ingest = yield* runIngestPass({ index, root: join(root, 'sessions'), budgetMs: 10_000, windowBytes: 4 * 1024 * 1024, now: Date.now })
    const last = yield* index.searchSessions({ query: 'zebra', limit: 5 })
    const found = yield* index.findInSession({ sessionId, query: 'zebra', limit: 5 })
    return { ingest, last, found }
  })

  expect(outcome.ingest.documents).toBeGreaterThan(20)
  expect(outcome.last.matches.map(match => match.header.id)).toEqual([sessionId])
  expect(outcome.found.matches.map(match => match.seq)).toEqual([23])
})

it('indexes a log whose frames are larger than the read window', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-search-ingest-'))
  roots.push(root)
  const sessionId = 'session-dddddddd-0000-4000-8000-000000000000'
  await writeSessionLog({ directory: join(root, 'sessions', 'project', sessionId), exchanges: 4, sessionId })

  const outcome = await runWithIndex(join(root, 'index.sqlite'), function* (index) {
    let documents = 0
    for (let pass = 0; pass < 50; pass += 1) {
      const result = yield* runIngestPass({ index, root: join(root, 'sessions'), budgetMs: 10_000, windowBytes: 16, now: Date.now })
      documents += result.documents
      if (result.behindSessions === 0) break
    }
    const search = yield* index.searchSessions({ query: 'retry storm', limit: 5 })
    return { documents, search }
  })

  expect(outcome.documents).toBeGreaterThan(0)
  expect(outcome.search.matches.map(match => match.header.id)).toContain(sessionId)
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

  const outcome = await runWithIndex(join(root, 'index.sqlite'), function* (index) {
    let behind = 1
    for (let pass = 0; pass < 10 && behind > 0; pass += 1)
      behind = (yield* runIngestPass({ index, root: join(root, 'sessions'), budgetMs: 10_000, windowBytes: 1024 * 1024, now: Date.now })).behindSessions
    const search = yield* index.searchSessions({ query: 'zanzibar', limit: 5 })
    return { behind, search }
  })

  expect(outcome.behind).toBe(0)
  expect(outcome.search.matches.map(match => match.header.id)).toEqual([sessionId])
})

it('drops an archived Session’s documents and indexes it again only for a targeted search', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-search-cold-'))
  roots.push(root)
  const sessionId = 'session-ffffffff-0000-4000-8000-000000000000'
  await writeSessionLog({ directory: join(root, 'sessions', 'project', sessionId), exchanges: 2, sessionId })

  const outcome = await runWithIndex(join(root, 'index.sqlite'), function* (index) {
    const ingest = (archived?: ReadonlySet<string>) => {
      const options = { index, root: join(root, 'sessions'), budgetMs: 10_000, windowBytes: 1024 * 1024, now: Date.now }
      return runIngestPass(archived === undefined ? options : { ...options, archived })
    }

    const first = yield* ingest()
    const firstSearch = yield* index.searchSessions({ query: 'retry storm', limit: 5 })
    const cold = yield* ingest(new Set([sessionId]))
    const coldSearch = yield* index.searchSessions({ query: 'retry storm', limit: 5 })
    // Cold stays out of a broad pass, and the targeted path is what reads it back.
    const second = yield* ingest(new Set([sessionId]))
    yield* indexSessions({ index, root: join(root, 'sessions'), budgetMs: 10_000, windowBytes: 1024 * 1024, now: Date.now, archived: new Set([sessionId]) }, [
      sessionId,
    ])
    const targeted = yield* index.searchSessions({ query: 'retry storm', limit: 5 })
    return { first, firstSearch, cold, coldSearch, second, targeted }
  })

  expect(outcome.first.ingested).toBe(1)
  expect(outcome.firstSearch.matches).toHaveLength(1)
  expect(outcome.cold.pruned).toBe(1)
  expect(outcome.coldSearch.matches).toHaveLength(0)
  expect(outcome.second.ingested).toBe(0)
  expect(outcome.targeted.matches.map(match => match.header.id)).toEqual([sessionId])
})

it('rolls back every session and FTS row when a grouped write fails', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-search-rollback-'))
  roots.push(root)
  const path = join(root, 'index.sqlite')
  const batch = (id: string) => ({
    header: { id, version: 4, createdAt: 0, isSeeded: false },
    cursor: { logPath: id, dev: '1', ino: '1', offset: 1, size: 1, mtimeNs: '1' },
    documents: [{ sessionId: id, seq: 1, type: 'user/message', time: 1, surface: 'current', text: 'rollbackterm', truncated: false }],
    replace: true,
    now: 1,
  })

  const outcome = await runWithIndex(path, function* (index) {
    yield* index.sql.unsafe("CREATE TRIGGER fail_second BEFORE INSERT ON sessions WHEN NEW.id = 'second' BEGIN SELECT RAISE(ABORT, 'forced failure'); END")
    const failure = yield* index.sql
      .withTransaction(
        Effect.gen(function* () {
          yield* index.commitBatch(batch('first'))
          yield* index.commitBatch(batch('second'))
        }),
      )
      .pipe(Effect.flip)
    const first = yield* index.cursor('first')
    const second = yield* index.cursor('second')
    const search = yield* index.searchSessions({ query: 'rollbackterm', limit: 5 })
    return { failure, first, second, search }
  })

  expect(outcome.failure).toMatchObject({ _tag: 'SqlError', reason: { _tag: 'ConstraintError' } })
  expect(outcome.first).toBeUndefined()
  expect(outcome.second).toBeUndefined()
  expect(outcome.search.matches).toEqual([])
})

it('backs the idle poll off from 5 s to a minute', () => {
  expect([1, 2, 3, 4, 5, 9].map(passes => Duration.toSeconds(IdleBackoff.after(passes)))).toEqual([5, 10, 20, 40, 60, 60])
  expect(Duration.toSeconds(IdleBackoff.after(0))).toBe(5)
})

it('reads every cursor at once, as the per-session lookups do', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-search-cursors-'))
  roots.push(root)
  const ids = ['session-aaaaaaa1-0000-4000-8000-000000000000', 'session-aaaaaaa2-0000-4000-8000-000000000000']
  for (const sessionId of ids) await writeSessionLog({ directory: join(root, 'sessions', 'project', sessionId), exchanges: 2, sessionId })

  const outcome = await runWithIndex(join(root, 'index.sqlite'), function* (index) {
    yield* runIngestPass({ index, root: join(root, 'sessions'), budgetMs: 10_000, windowBytes: 1 << 20, now: Date.now })
    const cursors = yield* index.cursors()
    const perSession: (unknown | undefined)[] = []
    for (const sessionId of ids) perSession.push(yield* index.cursor(sessionId))
    const idle = yield* runIngestPass({ index, root: join(root, 'sessions'), budgetMs: 10_000, windowBytes: 1 << 20, now: Date.now })
    return { cursors, perSession, idle }
  })

  expect([...outcome.cursors.keys()].sort()).toEqual(ids)
  for (const [position, sessionId] of ids.entries()) expect(outcome.cursors.get(sessionId)).toEqual(outcome.perSession[position])
  expect(outcome.idle).toMatchObject({ scanned: 2, ingested: 0, behindSessions: 0 })
})
