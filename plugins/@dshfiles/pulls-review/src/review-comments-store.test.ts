import { expect, test } from 'vitest'
import type { CommentSource } from './review-comments-api.js'
import { CommentThreadsModel, type CommentThreadsTable } from './review-comments-store.js'
import type { CommentThread } from './review-comments-api.js'

const memoryTable = (initial: readonly CommentThread[] = []): CommentThreadsTable & { readonly rows: Map<string, CommentThread> } => {
  const rows = new Map(initial.map(thread => [thread.id, thread]))
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

const turn: CommentSource = { kind: 'turn', sessionId: 'session-1', seq: 4 }
const otherTurn: CommentSource = { kind: 'turn', sessionId: 'session-1', seq: 5 }
const workspace: CommentSource = { kind: 'workspace', path: '/repo', base: 'main', head: 'abc' }

let nextId = 0

const storeFor = (initial: readonly CommentThread[] = [], now = () => 1_000) => {
  const table = memoryTable(initial)
  return { table, store: CommentThreadsModel.createStore({ table, now, newId: () => `thread-${++nextId}` }) }
}

test('a comment thread belongs to one review and keeps its anchor', async () => {
  const { table, store } = storeFor()
  const created = await store.create({ source: turn, path: 'src/a.ts', anchor: { side: 'new', line: 12 }, body: 'why?', author: { kind: 'user' } })
  expect(created.path).toBe('src/a.ts')
  expect(created.anchor).toEqual({ side: 'new', line: 12 })
  expect(created.replies).toEqual([])
  await store.create({ source: otherTurn, path: 'src/a.ts', anchor: { side: 'new', line: 1 }, body: 'elsewhere', author: { kind: 'user' } })

  expect(store.list(turn).map(thread => thread.body)).toEqual(['why?'])
  expect(store.list(workspace)).toEqual([])
  await store.flush()
  expect(table.rows.size).toBe(2)
})

test('a reply, a resolve and a reopen keep the thread and its author', async () => {
  const { store } = storeFor([], () => 2_000)
  const created = await store.create({
    source: workspace,
    path: 'src/a.ts',
    anchor: { side: 'old', line: 3 },
    body: 'stale',
    author: { kind: 'agent', sessionId: 's2' },
  })
  const replied = await store.reply({ id: created.id, body: 'fixed', author: { kind: 'user' } })
  expect(replied.replies).toHaveLength(1)
  expect(replied.replies[0]?.author).toEqual({ kind: 'user' })

  const resolved = await store.setResolved({ id: created.id, resolved: true })
  expect(resolved.resolvedAt).toBe(2_000)
  const reopened = await store.setResolved({ id: created.id, resolved: false })
  expect(reopened.resolvedAt).toBeUndefined()

  expect(store.list(workspace)).toHaveLength(1)
  expect(await store.delete(created.id)).toEqual({ deleted: true })
  expect(store.list(workspace)).toEqual([])
})

test('an unknown thread is refused instead of invented', async () => {
  const { store } = storeFor()
  await expect(store.reply({ id: 'missing', body: 'hi', author: { kind: 'user' } })).rejects.toThrow('no longer there')
  await expect(store.setResolved({ id: 'missing', resolved: true })).rejects.toThrow('no longer there')
  await expect(store.delete('missing')).rejects.toThrow('no longer there')
})

test('the oldest threads are the ones trimmed past the bound', async () => {
  const initial: CommentThread[] = [0, 1, 2].map(index => ({
    id: `old-${index}`,
    source: turn,
    path: 'a.ts',
    anchor: { side: 'new', line: 1 },
    body: `c${index}`,
    author: { kind: 'user' },
    createdAt: index,
    replies: [],
  }))
  expect(CommentThreadsModel.threadsToTrim(initial, 2)).toEqual(['old-0'])
})
