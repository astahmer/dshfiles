import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import type { SearchIndex } from '../src/index-db.js'
import { runWithIndex } from './index-harness.js'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const conversation = [
  { kind: 'type' as const, values: ['user/message', 'assistant/message'] },
  { kind: 'surface' as const, values: ['current'] },
]

const commit = (index: SearchIndex, sessionId: string, documents: readonly { readonly type: string; readonly surface: string; readonly text: string }[]) =>
  index.commitBatch({
    header: { id: sessionId, version: 4, createdAt: 1, isSeeded: false },
    cursor: { logPath: `/logs/${sessionId}`, dev: '1', ino: sessionId, offset: 10, size: 10, mtimeNs: '1' },
    documents: documents.map((document, seq) => ({ sessionId, seq, time: seq, truncated: false, ...document })),
    replace: false,
    now: 1,
  })

it('copies documents indexed before the conversation table and then searches it for conversation filters', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-search-conversation-'))
  roots.push(root)
  const path = join(root, 'index.sqlite')
  await runWithIndex(path, index =>
    commit(index, 'session-a', [
      { type: 'user/message', surface: 'current', text: 'the quartz migration stalled' },
      { type: 'tool/result', surface: 'current', text: 'quartz tool output' },
      { type: 'assistant/message', surface: 'shadowed', text: 'quartz shadowed reply' },
    ]),
  )
  // An index built before the table existed: no conversation rows and no backfill progress.
  const raw = new DatabaseSync(path)
  raw.exec("DELETE FROM conversation_documents; DELETE FROM meta WHERE key LIKE 'conversation_%'")
  raw.close()

  const outcome = await runWithIndex(path, function* (index) {
    const readyBefore = yield* index.conversationReady()
    const before = yield* index.searchSessions({ query: 'quartz', limit: 5, filters: conversation })
    while (!(yield* index.backfillConversation(1))) {}
    yield* commit(index, 'session-b', [{ type: 'assistant/message', surface: 'current', text: 'quartz rollout finished' }])
    const readyAfter = yield* index.conversationReady()
    const filtered = yield* index.searchSessions({ query: 'quartz', limit: 5, filters: conversation })
    const broad = yield* index.searchSessions({ query: 'quartz', limit: 5 })
    yield* index.forget('session-b')
    const forgotten = yield* index.searchSessions({ query: 'rollout', limit: 5, filters: conversation })
    return { readyBefore, before, readyAfter, filtered, broad, forgotten }
  })

  expect(outcome.readyBefore).toBe(false)
  expect(outcome.before.matches.map(match => [match.sessionId, match.seq])).toEqual([['session-a', 0]])
  expect(outcome.readyAfter).toBe(true)
  expect(outcome.filtered.matches.map(match => [match.sessionId, match.seq]).sort()).toEqual([
    ['session-a', 0],
    ['session-b', 0],
  ])
  expect(outcome.broad.matches).toHaveLength(2)
  expect(outcome.forgotten.matches).toEqual([])
})

it('maps documents indexed before the rowid map so forgetting their session deletes by rowid', async () => {
  const root = await mkdtemp(join(tmpdir(), 'session-search-rowmap-'))
  roots.push(root)
  const path = join(root, 'index.sqlite')
  await runWithIndex(path, index =>
    commit(index, 'session-legacy', [
      { type: 'user/message', surface: 'current', text: 'the obsidian deploy' },
      { type: 'tool/result', surface: 'current', text: 'obsidian output' },
    ]),
  )
  const raw = new DatabaseSync(path)
  raw.exec("DELETE FROM session_document_rows; DELETE FROM meta WHERE key LIKE 'row_map_%'")
  raw.close()

  await runWithIndex(path, function* (index) {
    while (!(yield* index.backfillRowMap(1))) {}
  })
  const mapped = new DatabaseSync(path)
  try {
    expect(mapped.prepare("SELECT count(*) AS n FROM session_document_rows WHERE session_id = 'session-legacy'").get()).toEqual({ n: 2 })
  } finally {
    mapped.close()
  }

  const remaining = await runWithIndex(path, function* (index) {
    yield* index.forget('session-legacy')
    return yield* index.searchSessions({ query: 'obsidian', limit: 5 })
  })
  expect(remaining.matches).toEqual([])
})
