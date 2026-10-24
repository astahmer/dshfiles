import { test, expect } from 'vitest'
import { viewedKey } from './marks-api.js'
import { ViewedMarksModel, type ViewedMark, type ViewedMarksTable } from './marks-store.js'

const memoryTable = (initial: readonly ViewedMark[] = []): ViewedMarksTable & { readonly rows: Map<string, ViewedMark> } => {
  const rows = new Map(initial.map(mark => [mark.key, mark]))
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

const file = { sessionId: 'session-1', seq: 4, path: 'src/a.ts' }

test('a mark is stored durably and belongs to its own turn', async () => {
  const table = memoryTable()
  const store = ViewedMarksModel.createStore({ table, now: () => 5_000 })

  const toggled = await store.toggle(file)
  expect(toggled.marks).toEqual([viewedKey(file)])
  await store.flush()
  expect([...table.rows.keys()]).toEqual([viewedKey(file)])

  const reopened = ViewedMarksModel.createStore({ table, now: () => 5_100 })
  expect(reopened.snapshot()).toEqual({ revision: 5_100, marks: [viewedKey(file)] })
  expect(reopened.snapshot().marks).not.toContain(viewedKey({ ...file, seq: 9 }))
  expect(reopened.snapshot().marks).not.toContain(viewedKey({ ...file, sessionId: 'session-2' }))

  const cleared = await reopened.toggle(file)
  expect(cleared.marks).toEqual([])
  await reopened.flush()
  expect([...table.rows.keys()]).toEqual([])
})

test('a new mark always outranks every stored version, even after a clock step back', async () => {
  const table = memoryTable([{ key: viewedKey(file), version: 10_000 }])
  const store = ViewedMarksModel.createStore({ table, now: () => 900 })

  expect(store.snapshot().revision).toBe(10_000)
  const toggled = await store.toggle({ ...file, seq: 5 })
  expect(toggled.revision).toBe(10_001)
  expect(toggled.marks).toEqual([viewedKey(file), viewedKey({ ...file, seq: 5 })])
})

test('the oldest marks are trimmed past the bound', async () => {
  const table = memoryTable()
  const store = ViewedMarksModel.createStore({ table, now: () => 5_000 })

  for (let seq = 0; seq < 2_001; seq++) await store.toggle({ ...file, seq })
  await store.flush()
  const marks = store.snapshot().marks
  expect(marks.length).toBe(2_000)
  expect(marks).not.toContain(viewedKey({ ...file, seq: 0 }))
  expect(marks).toContain(viewedKey({ ...file, seq: 2_000 }))
  expect(table.rows.size).toBe(2_000)
})

test('the least recently written marks are the ones trimmed', () => {
  const mark = (key: string, version: number): ViewedMark => ({ key, version })
  expect(ViewedMarksModel.keysToTrim([mark('newest', 3), mark('oldest', 1), mark('middle', 2)], 2)).toEqual(['oldest'])
  expect(ViewedMarksModel.keysToTrim([mark('a', 1)], 2)).toEqual([])
  expect(ViewedMarksModel.nextVersion(1_000, 900)).toBe(1_001)
})

test('marking is idempotent so a scroll handler never flips a file back', async () => {
  const table = memoryTable()
  const store = ViewedMarksModel.createStore({ table, now: () => 5_000 })

  const first = await store.mark(file, true)
  expect(first.marks).toEqual([viewedKey(file)])
  const revision = first.revision
  const again = await store.mark(file, true)
  expect(again).toEqual(first)
  expect(again.revision).toBe(revision)

  const cleared = await store.mark(file, false)
  expect(cleared.marks).toEqual([])
  const clearedAgain = await store.mark(file, false)
  expect(clearedAgain.marks).toEqual([])
  await store.flush()
  expect(table.rows.size).toBe(0)
})
