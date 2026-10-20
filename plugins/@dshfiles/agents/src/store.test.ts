import assert from 'node:assert/strict'
import { test } from 'vitest'
import type { AgentTable } from './store.js'
import type { Agent } from './agent.js'
import { AgentRegistry } from './store.js'

const memoryTable = (initial: readonly Agent[] = []) => {
  const rows = new Map<string, Agent>(initial.map(agent => [agent.handle, agent]))
  const table: AgentTable = {
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
  const { rows, table } = memoryTable(initial)
  return { rows, store: AgentRegistry.createStore({ table, now, reportError: () => undefined }) }
}

const draftOf = (handle: string) => ({
  handle,
  name: handle,
  glyph: '🤖',
  description: '',
  instructions: '',
  preset: null,
  route: null,
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

test('an unchanged agent keeps revision monotonic across restarts', async () => {
  const { store } = storeOf(() => 5_000)
  const first = store.snapshot().revision
  await store.save(draftOf('reviewer'))
  const second = store.snapshot().revision
  assert.equal(second > first, true)
  await store.flush()
})
