import assert from 'node:assert/strict'
import { test } from 'vitest'
import { MAX_REVIEW_MARKS, type ReviewFile, type ReviewMark } from './review-progress.js'
import { ReviewProgressStoreModel, type ReviewMarksTable } from './review-progress-store.js'

const memoryTable = (initial: readonly ReviewMark[] = []): ReviewMarksTable & { readonly rows: Map<string, ReviewMark> } => {
  const rows = new Map(initial.map(mark => [ReviewProgressStoreModel.key(mark), mark]))
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

const mark = (overrides: Partial<ReviewMark> = {}): ReviewMark => ({
  repositoryRoot: '/workspace/project',
  commitId: 'a'.repeat(40),
  path: 'src/main.ts',
  contentDigest: 'b'.repeat(64),
  reviewedAt: '2026-10-05T12:00:00.000Z',
  ...overrides,
})

const file = (overrides: Partial<ReviewFile> = {}): ReviewFile => ({ path: 'src/main.ts', contentDigest: 'b'.repeat(64), ...overrides })

test('a revision always outranks every stored revision, even after a clock step back', () => {
  assert.equal(ReviewProgressStoreModel.nextRevision(0, 1_000), 1_000)
  assert.equal(ReviewProgressStoreModel.nextRevision(1_000, 900), 1_001)
})

test('a reviewed file is stored durably and answered with a new revision', async () => {
  const table = memoryTable()
  const store = ReviewProgressStoreModel.create({ table, now: () => 5_000 })

  const snapshot = await store.toggle({ repositoryRoot: '/workspace/project', commitId: 'a'.repeat(40), file: file(), reviewed: true })

  assert.equal(snapshot.revision, 5_001)
  assert.deepEqual(snapshot.store.marks, [{ ...mark(), reviewedAt: new Date(5_000).toISOString() }])
  await store.flush()
  assert.deepEqual([...table.rows.keys()], [ReviewProgressStoreModel.key(mark())])
})

test('re-reviewing changed content replaces the digest on the same row', async () => {
  const table = memoryTable()
  const store = ReviewProgressStoreModel.create({ table, now: () => 6_000 })

  await store.toggle({ repositoryRoot: '/workspace/project', commitId: 'a'.repeat(40), file: file(), reviewed: true })
  const edited = await store.toggle({
    repositoryRoot: '/workspace/project',
    commitId: 'a'.repeat(40),
    file: file({ contentDigest: 'c'.repeat(64) }),
    reviewed: true,
  })

  assert.deepEqual(
    edited.store.marks.map(item => item.contentDigest),
    ['c'.repeat(64)],
  )
  await store.flush()
  assert.equal(table.rows.size, 1)
  assert.equal(table.rows.get(ReviewProgressStoreModel.key(mark()))?.contentDigest, 'c'.repeat(64))
})

test('unmarking a file deletes its row', async () => {
  const table = memoryTable([mark()])
  const store = ReviewProgressStoreModel.create({ table, now: () => 7_000 })
  assert.equal(store.snapshot().store.marks.length, 1)

  const cleared = await store.toggle({ repositoryRoot: '/workspace/project', commitId: 'a'.repeat(40), file: file(), reviewed: false })

  assert.deepEqual(cleared.store.marks, [])
  await store.flush()
  assert.equal(table.rows.size, 0)
})

test('a file without a content digest cannot be marked reviewed', async () => {
  const store = ReviewProgressStoreModel.create({ table: memoryTable(), now: () => 8_000 })
  await assert.rejects(store.toggle({ repositoryRoot: '/workspace/project', commitId: 'a'.repeat(40), file: file({ contentDigest: null }), reviewed: true }))
})

test('the oldest marks are trimmed past the bound', async () => {
  const seeded = Array.from({ length: MAX_REVIEW_MARKS }, (_item, index) =>
    mark({ path: `src/f${String(index)}.ts`, contentDigest: index.toString(16).padStart(64, '0'), reviewedAt: new Date(index * 1_000).toISOString() }),
  )
  const table = memoryTable(seeded)
  const store = ReviewProgressStoreModel.create({ table, now: () => MAX_REVIEW_MARKS * 1_000 })

  await store.toggle({ repositoryRoot: '/workspace/project', commitId: 'a'.repeat(40), file: file({ path: 'src/newest.ts' }), reviewed: true })
  await store.flush()

  assert.equal(table.rows.size, MAX_REVIEW_MARKS)
  assert.equal(table.rows.has(ReviewProgressStoreModel.key(mark({ path: 'src/f0.ts' }))), false)
  assert.equal(table.rows.has(ReviewProgressStoreModel.key(mark({ path: 'src/newest.ts' }))), true)
  assert.equal(store.snapshot().store.marks.length, MAX_REVIEW_MARKS)
})
