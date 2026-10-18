import assert from 'node:assert/strict'
import { test } from 'vitest'
import { ThreadReferencesModel, type ThreadReferenceThread } from './thread-references.js'

const thread = (sessionId: string, updatedAt: number, parentSessionId: string | null = null, origin?: 'subagent'): ThreadReferenceThread =>
  origin === undefined ? { sessionId, updatedAt, parentSessionId } : { sessionId, updatedAt, parentSessionId, origin }

const relations = (result: ReturnType<typeof ThreadReferencesModel.merge>): string[] => result.references.map(row => `${row.sessionId}:${row.relation}`)

test('the mention query keeps only the id payload, which matches both recorded id forms', () => {
  assert.equal(ThreadReferencesModel.mentionQuery('session-a48a5989-951b-42ae-a661-86dd78f14095'), 'a48a5989-951b-42ae-a661-86dd78f14095')
  assert.equal(ThreadReferencesModel.mentionQuery('9926d76f-4381-48aa-bce2-a0deee29efc2'), '9926d76f-4381-48aa-bce2-a0deee29efc2')
})

test('forked and subagent children come first, then mentioning threads, newest first', () => {
  const result = ThreadReferencesModel.merge({
    sessionId: 'session-seed',
    limit: 8,
    degraded: false,
    threads: [
      thread('session-seed', 100),
      thread('session-fork', 30, 'session-seed'),
      thread('session-subagent', 40, 'session-seed', 'subagent'),
      thread('session-mention-old', 10),
      thread('session-mention-new', 90),
      thread('session-unrelated', 99),
    ],
    mentions: [{ sessionId: 'session-mention-new' }, { sessionId: 'session-mention-old' }],
  })

  assert.deepEqual(relations(result), ['session-subagent:subagent', 'session-fork:fork', 'session-mention-new:mention', 'session-mention-old:mention'])
  assert.equal(result.omitted, 0)
  assert.equal(result.degraded, false)
})

test('a thread that is both a child and a mention keeps its lineage relation', () => {
  const result = ThreadReferencesModel.merge({
    sessionId: 'session-seed',
    limit: 8,
    degraded: false,
    threads: [thread('session-child', 5, 'session-seed')],
    mentions: [{ sessionId: 'session-child' }],
  })

  assert.deepEqual(relations(result), ['session-child:fork'])
})

test('the target never lists itself and the limit reports what it dropped', () => {
  const result = ThreadReferencesModel.merge({
    sessionId: 'session-seed',
    limit: 1,
    degraded: false,
    threads: [thread('session-seed', 100), thread('session-a', 5, 'session-seed'), thread('session-b', 4, 'session-seed')],
    mentions: [{ sessionId: 'session-seed' }, { sessionId: 'session-c' }],
  })

  assert.deepEqual(relations(result), ['session-a:fork'])
  assert.equal(result.omitted, 2)
})

test('a failed content search keeps lineage and says it is degraded', () => {
  const result = ThreadReferencesModel.merge({
    sessionId: 'session-seed',
    limit: 8,
    degraded: true,
    threads: [thread('session-child', 5, 'session-seed')],
    mentions: [],
  })

  assert.deepEqual(relations(result), ['session-child:fork'])
  assert.equal(result.degraded, true)
})

test('titles fill only the rows the Host knows a title for', () => {
  const rows = ThreadReferencesModel.withTitles(
    [
      { sessionId: 'session-a', relation: 'mention' as const },
      { sessionId: 'session-b', relation: 'fork' as const, title: 'Existing' },
    ],
    new Map([['session-a', 'Handoff thread']]),
  )

  assert.deepEqual(rows, [
    { sessionId: 'session-a', relation: 'mention', title: 'Handoff thread' },
    { sessionId: 'session-b', relation: 'fork', title: 'Existing' },
  ])
})
