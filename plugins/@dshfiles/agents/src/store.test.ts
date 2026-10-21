import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { AgentTable, AgentThreadTable } from './store.js'
import type { Agent, AgentDraft, AgentThread } from './agent.js'
import { AgentRegistry } from './store.js'

const memoryTable = <Key extends string, Value>(
  initial: readonly Value[] = [],
  keyOf: (value: Value) => Key,
): { readonly rows: Map<Key, Value>; readonly table: KvTable<Key, Value> } => {
  const rows = new Map<Key, Value>(initial.map(value => [keyOf(value), value]))
  const table: KvTable<Key, Value> = {
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
      if (current === undefined) throw new Error(`missing row ${key}`)
      const next = change(current)
      rows.set(key, next)
      return next
    },
  }
  return { rows, table }
}

const storeOf = (now: () => number, initial: readonly Agent[] = []) => {
  const agents = memoryTable<string, Agent>(initial, agent => agent.handle)
  const threads = memoryTable<string, AgentThread>([], thread => thread.sessionId)
  const registry = (agentTable: AgentTable, threadTable: AgentThreadTable) =>
    AgentRegistry.createStore({ table: agentTable, threads: threadTable, now, reportError: () => undefined })
  return {
    rows: agents.rows,
    threadRows: threads.rows,
    store: registry(agents.table, threads.table),
    reopen: () => registry(agents.table, threads.table),
  }
}

const draftOf = (handle: string): AgentDraft => ({
  handle,
  name: handle,
  glyph: '🤖',
  description: '',
  instructions: '',
  preset: null,
  route: null,
  memoryScope: null,
  routine: '',
  delegation: { messaging: 'any', handles: [], subagents: true },
  enabled: true,
})

test('seeds the built-in agent and keeps it out of deletion', async () => {
  const { store } = storeOf(() => 1_000)
  assert.deepEqual(
    store.snapshot().agents.map(agent => agent.handle),
    ['dsh'],
  )
  const removed = await store.remove('dsh')
  assert.equal(removed.kind, 'built-in')
  assert.equal(store.resolve('dsh')?.builtIn, true)
})

test('saves a new agent with usage metadata and keeps it on update', async () => {
  const { store } = storeOf(() => 2_000)
  const saved = await store.save(draftOf('reviewer'))
  assert.equal(saved.kind, 'applied')
  assert.equal(saved.agent.createdAt, 2_000)
  assert.equal(saved.agent.threadCount, 0)
  assert.equal(saved.agent.builtIn, false)

  const used = await store.recordUse('reviewer')
  assert.equal(used.revision > saved.revision, true)

  const edited = await store.save({ ...draftOf('reviewer'), name: 'Review Bot' })
  assert.equal(edited.kind, 'applied')
  assert.equal(edited.agent.name, 'Review Bot')
  assert.equal(edited.agent.threadCount, 1)
  assert.equal(edited.agent.createdAt, 2_000)
})

test('removes a custom agent and reports a missing one', async () => {
  const { rows, store } = storeOf(() => 3_000)
  await store.save(draftOf('reviewer'))
  assert.equal(rows.size, 2)

  const removed = await store.remove('reviewer')
  assert.equal(removed.kind, 'applied')
  assert.equal(rows.has('reviewer'), false)
  assert.equal((await store.remove('reviewer')).kind, 'missing')
})

test('refuses past the agent limit without dropping existing rows', async () => {
  const now = () => 4_000
  const { store } = storeOf(now)
  for (let index = 0; index < 99; index += 1) await store.save(draftOf(`agent-${String(index)}`))
  const full = await store.save(draftOf('one-more'))
  assert.equal(full.kind, 'limit')
  assert.equal(store.resolve('agent-98')?.handle, 'agent-98')
})

test('keeps a dispatched thread and its usage across a restart', async () => {
  const { store, threadRows, reopen } = storeOf(() => 6_000)
  await store.save(draftOf('reviewer'))
  const used = await store.recordUse('reviewer', { sessionId: 'session-a', title: 'Review the pull request' })
  assert.equal(used.agents.find(agent => agent.handle === 'reviewer')?.threadCount, 1)
  assert.equal(threadRows.size, 1)

  // The same dispatch retried is idempotent: one row, one count, one last-used time.
  await store.recordUse('reviewer', { sessionId: 'session-a', title: 'Review the pull request' })
  const restored = reopen()
  const agent = restored.resolve('reviewer')
  assert.equal(agent?.threadCount, 1)
  assert.equal(agent?.lastUsedAt, 6_000)
  assert.deepEqual(
    restored.threads('reviewer').map(thread => thread.sessionId),
    ['session-a'],
  )
  assert.equal(restored.threadAgent('session-a')?.handle, 'reviewer')
  assert.equal(restored.threadAgent('session-b'), null)
})

test('lists an agent’s threads newest first and drops one when the agent goes', async () => {
  let clock = 7_000
  const { store, threadRows } = storeOf(() => clock)
  await store.save(draftOf('reviewer'))
  await store.save(draftOf('planner'))
  await store.recordUse('reviewer', { sessionId: 'session-old', title: 'Older' })
  clock = 8_000
  await store.recordUse('reviewer', { sessionId: 'session-new', title: 'Newer' })
  await store.recordUse('planner', { sessionId: 'session-plan', title: 'Plan' })
  assert.deepEqual(
    store.threads('reviewer').map(thread => thread.title),
    ['Newer', 'Older'],
  )
  assert.deepEqual(
    store.threads('planner').map(thread => thread.title),
    ['Plan'],
  )
  await store.remove('reviewer')
  assert.equal(threadRows.has('session-old'), false)
  assert.equal(threadRows.has('session-plan'), true)
  assert.equal(store.threadAgent('session-old'), null)
})

test('an unchanged agent keeps revision monotonic across restarts', async () => {
  const { store } = storeOf(() => 5_000)
  const first = store.snapshot().revision
  await store.save(draftOf('reviewer'))
  const second = store.snapshot().revision
  assert.equal(second > first, true)
  await store.flush()
})
