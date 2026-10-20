import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, expect, it } from 'vitest'
import { SearchIndex } from '../src/index-db.js'

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
  const legacy = new SearchIndex(path)
  commit(legacy, 'session-a', [
    { type: 'user/message', surface: 'current', text: 'the quartz migration stalled' },
    { type: 'tool/result', surface: 'current', text: 'quartz tool output' },
    { type: 'assistant/message', surface: 'shadowed', text: 'quartz shadowed reply' },
  ])
  legacy.close()
  // An index built before the table existed: no conversation rows and no backfill progress.
  const raw = new DatabaseSync(path)
  raw.exec("DELETE FROM conversation_documents; DELETE FROM meta WHERE key LIKE 'conversation_%'")
  raw.close()

  const index = new SearchIndex(path)
  expect(index.conversationReady).toBe(false)
  const before = index.searchSessions({ query: 'quartz', limit: 5, filters: conversation }).matches.map(match => [match.sessionId, match.seq])
  while (!index.backfillConversation(1)) {}
  commit(index, 'session-b', [{ type: 'assistant/message', surface: 'current', text: 'quartz rollout finished' }])

  expect(index.conversationReady).toBe(true)
  expect(before).toEqual([['session-a', 0]])
  expect(
    index
      .searchSessions({ query: 'quartz', limit: 5, filters: conversation })
      .matches.map(match => [match.sessionId, match.seq])
      .sort(),
  ).toEqual([
    ['session-a', 0],
    ['session-b', 0],
  ])
  expect(index.searchSessions({ query: 'quartz', limit: 5 }).matches).toHaveLength(2)

  index.forget('session-b')
  expect(index.searchSessions({ query: 'rollout', limit: 5, filters: conversation }).matches).toEqual([])
  index.close()
})
