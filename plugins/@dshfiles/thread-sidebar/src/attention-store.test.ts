import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { ThreadAttentionView } from './attention-api.js'
import { createAttentionStore, ThreadAttentionStoreModel, type AttentionTable } from './attention-store.js'

const memoryTable = (initial: readonly ThreadAttentionView[] = []): AttentionTable & { readonly rows: Map<string, ThreadAttentionView> } => {
  const rows = new Map(initial.map(record => [record.sessionId, record]))
  return {
    rows,
    get: key => rows.get(key),
    entries: () => rows.entries(),
    keys: () => rows.keys(),
    get size() {
      return rows.size
    },
    put: async (key, value) => {
      rows.set(key, value)
    },
    delete: async key => rows.delete(key),
    update: async (key, change) => {
      const current = rows.get(key)
      if (current === undefined) throw new Error('missing row')
      const next = change(current)
      rows.set(key, next)
      return next
    },
  }
}

const turnEnd = (kind: string): unknown => ({ type: 'turn/end', seq: 12, time: 1_000, data: { turn: 3, reason: { kind } } })

test('only turn ends that ask the user for something count as attention', () => {
  assert.equal(ThreadAttentionStoreModel.finishReasonFromEvent(turnEnd('completed')), 'completed')
  assert.equal(ThreadAttentionStoreModel.finishReasonFromEvent(turnEnd('error')), 'error')
  assert.equal(ThreadAttentionStoreModel.finishReasonFromEvent(turnEnd('aborted')), 'aborted')
  assert.equal(ThreadAttentionStoreModel.finishReasonFromEvent(turnEnd('blocked')), 'blocked')
  assert.equal(ThreadAttentionStoreModel.finishReasonFromEvent(turnEnd('max-tokens')), 'max-tokens')
  assert.equal(ThreadAttentionStoreModel.finishReasonFromEvent(turnEnd('forked')), null)
  assert.equal(ThreadAttentionStoreModel.finishReasonFromEvent(turnEnd('interrupted')), null)
  assert.equal(ThreadAttentionStoreModel.finishReasonFromEvent({ type: 'turn/start', data: {} }), null)
  assert.equal(ThreadAttentionStoreModel.finishReasonFromEvent('nonsense'), null)
})

test('a version always outranks every stored version, even after a clock step back', () => {
  assert.equal(ThreadAttentionStoreModel.nextVersion(0, 1_000), 1_000)
  assert.equal(ThreadAttentionStoreModel.nextVersion(1_000, 900), 1_001)
})

test('a finished turn is stored durably and acknowledged once the caller saw it', async () => {
  const table = memoryTable()
  const store = createAttentionStore({ table, now: () => 5_000 })

  store.recordFinish({ sessionId: 'thread', seq: 12, time: 4_000, reason: 'completed' })
  await store.flush()
  const recorded = store.snapshot()
  assert.equal(recorded.sessions.length, 1)
  assert.deepEqual(recorded.sessions[0], {
    sessionId: 'thread',
    version: 5_001,
    finishedAt: 4_000,
    finishedSeq: 12,
    finishedReason: 'completed',
    manuallyUnread: false,
  })
  assert.deepEqual([...table.rows.keys()], ['thread'])

  const stale = await store.acknowledge({ sessionId: 'thread', version: 5_000 })
  assert.equal(stale.sessions.length, 1)

  const acknowledged = await store.acknowledge({ sessionId: 'thread', version: 5_001 })
  assert.deepEqual(acknowledged.sessions, [])
  assert.deepEqual([...table.rows.keys()], [])
})

test('a finish recorded after the browser read the row survives that acknowledgement', async () => {
  const table = memoryTable()
  let clock = 5_000
  const store = createAttentionStore({ table, now: () => clock })

  store.recordFinish({ sessionId: 'thread', seq: 12, time: 4_000, reason: 'completed' })
  const seen = store.snapshot().sessions[0]
  assert.notEqual(seen, undefined)
  clock = 6_000
  store.recordFinish({ sessionId: 'thread', seq: 20, time: 5_500, reason: 'completed' })
  await store.flush()

  const afterStaleAck = await store.acknowledge({ sessionId: 'thread', version: seen?.version ?? 0 })
  assert.deepEqual(
    afterStaleAck.sessions.map(record => record.finishedSeq),
    [20],
  )
})

test('marking a thread unread by hand keeps its finish', async () => {
  const table = memoryTable()
  const store = createAttentionStore({ table, now: () => 7_000 })

  store.recordFinish({ sessionId: 'thread', seq: 3, time: 1_000, reason: 'error' })
  const marked = await store.markUnread({ sessionId: 'thread' })
  assert.deepEqual(marked.sessions[0], {
    sessionId: 'thread',
    version: 7_002,
    finishedAt: 1_000,
    finishedSeq: 3,
    finishedReason: 'error',
    manuallyUnread: true,
  })
  await store.flush()
  assert.equal(table.rows.get('thread')?.manuallyUnread, true)

  const markedOnly = await store.markUnread({ sessionId: 'hand-marked' })
  assert.deepEqual(markedOnly.sessions.map(record => record.sessionId).sort(), ['hand-marked', 'thread'])
  assert.deepEqual(
    markedOnly.sessions.find(record => record.sessionId === 'hand-marked'),
    { sessionId: 'hand-marked', version: 7_003, finishedAt: null, finishedSeq: null, finishedReason: null, manuallyUnread: true },
  )
})

test('acknowledging keeps a hand mark, and opening the thread drops the whole record', async () => {
  const table = memoryTable()
  const store = createAttentionStore({ table, now: () => 8_000 })

  store.recordFinish({ sessionId: 'thread', seq: 3, time: 1_000, reason: 'completed' })
  const marked = await store.markUnread({ sessionId: 'thread' })
  const markedVersion = marked.sessions[0]?.version ?? 0
  await store.flush()

  const acknowledged = await store.acknowledge({ sessionId: 'thread', version: markedVersion })
  assert.deepEqual(acknowledged.sessions, [
    { sessionId: 'thread', version: 8_003, finishedAt: null, finishedSeq: null, finishedReason: null, manuallyUnread: true },
  ])
  await store.flush()
  assert.equal(table.rows.get('thread')?.manuallyUnread, true)

  const opened = await store.clearUnread({ sessionId: 'thread', version: 8_003 })
  assert.deepEqual(opened.sessions, [])
  await store.flush()
  assert.equal(table.rows.has('thread'), false)
})

test('adopting browser state never replaces a record the Host already holds', async () => {
  const table = memoryTable()
  const store = createAttentionStore({ table, now: () => 9_000 })

  store.recordFinish({ sessionId: 'known', seq: 4, time: 2_000, reason: 'completed' })
  await store.flush()
  const migrated = await store.migrate([
    { sessionId: 'known', finishedAt: 1_000, manuallyUnread: true },
    { sessionId: 'browser-only', finishedAt: 500, manuallyUnread: false },
    { sessionId: 'nothing-to-say', finishedAt: null, manuallyUnread: false },
  ])

  const byId = new Map(migrated.sessions.map(record => [record.sessionId, record]))
  assert.deepEqual(byId.get('known'), {
    sessionId: 'known',
    version: 9_001,
    finishedAt: 2_000,
    finishedSeq: 4,
    finishedReason: 'completed',
    manuallyUnread: false,
  })
  assert.equal(byId.get('browser-only')?.finishedAt, 500)
  assert.equal(byId.has('nothing-to-say'), false)
})

test('the least recently written records are trimmed past the bound', () => {
  const record = (sessionId: string, version: number): ThreadAttentionView => ({
    sessionId,
    version,
    finishedAt: version,
    finishedSeq: null,
    finishedReason: null,
    manuallyUnread: false,
  })
  assert.deepEqual(ThreadAttentionStoreModel.keysToTrim([record('newest', 3), record('oldest', 1), record('middle', 2)], 2), ['oldest'])
  assert.deepEqual(ThreadAttentionStoreModel.keysToTrim([record('a', 1)], 2), [])
})
