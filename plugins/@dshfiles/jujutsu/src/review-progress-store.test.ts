import { describe, expect, it } from '@effect/vitest'
import { Effect, Option } from 'effect'
import { TestClock } from 'effect/testing'
import { MAX_REVIEW_MARKS, type ReviewFile, type ReviewMark } from './review-progress.js'
import { ReviewProgressStoreModel, type ReviewMarksTable } from './review-progress-store.js'

/** The storage domain table, kept in memory: the Host's durable store is the external system here. */
const memoryTable = (initial: readonly ReviewMark[] = []): ReviewMarksTable & { readonly rows: Map<string, ReviewMark> } => {
  const rows = new Map(initial.map(mark => [ReviewProgressStoreModel.key(mark), mark]))
  return {
    rows,
    get: key => Effect.sync(() => Option.fromUndefinedOr(rows.get(key))),
    entries: Effect.sync(() => [...rows.entries()]),
    size: Effect.sync(() => rows.size),
    put: (key, value) => Effect.sync(() => void rows.set(key, value)),
    delete: key => Effect.sync(() => rows.delete(key)),
    update: (key, change) =>
      Effect.sync(() => {
        const next = change(rows.get(key) ?? mark())
        rows.set(key, next)
        return next
      }),
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

describe('review progress store', () => {
  it('a revision always outranks every stored revision, even after a clock step back', () => {
    expect(ReviewProgressStoreModel.nextRevision(0, 1_000)).toBe(1_000)
    expect(ReviewProgressStoreModel.nextRevision(1_000, 900)).toBe(1_001)
  })

  it.effect('a reviewed file is stored durably and answered with a new revision', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(5_000)
      const table = memoryTable()
      const store = yield* ReviewProgressStoreModel.make(table)

      const snapshot = yield* store.toggle({ repositoryRoot: '/workspace/project', commitId: 'a'.repeat(40), file: file(), reviewed: true })

      expect(snapshot.revision).toBe(5_001)
      expect(snapshot.store.marks).toEqual([{ ...mark(), reviewedAt: new Date(5_000).toISOString() }])
      expect([...table.rows.keys()]).toEqual([ReviewProgressStoreModel.key(mark())])
    }),
  )

  it.effect('re-reviewing changed content replaces the digest on the same row', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(6_000)
      const table = memoryTable()
      const store = yield* ReviewProgressStoreModel.make(table)

      yield* store.toggle({ repositoryRoot: '/workspace/project', commitId: 'a'.repeat(40), file: file(), reviewed: true })
      const edited = yield* store.toggle({
        repositoryRoot: '/workspace/project',
        commitId: 'a'.repeat(40),
        file: file({ contentDigest: 'c'.repeat(64) }),
        reviewed: true,
      })

      expect(edited.store.marks.map(item => item.contentDigest)).toEqual(['c'.repeat(64)])
      expect(table.rows.size).toBe(1)
      expect(table.rows.get(ReviewProgressStoreModel.key(mark()))?.contentDigest).toBe('c'.repeat(64))
    }),
  )

  it.effect('unmarking a file deletes its row', () =>
    Effect.gen(function* () {
      yield* TestClock.setTime(7_000)
      const table = memoryTable([mark()])
      const store = yield* ReviewProgressStoreModel.make(table)
      expect((yield* store.snapshot).store.marks).toHaveLength(1)

      const cleared = yield* store.toggle({ repositoryRoot: '/workspace/project', commitId: 'a'.repeat(40), file: file(), reviewed: false })

      expect(cleared.store.marks).toEqual([])
      expect(table.rows.size).toBe(0)
    }),
  )

  it.effect('a file without a content digest cannot be marked reviewed', () =>
    Effect.gen(function* () {
      const store = yield* ReviewProgressStoreModel.make(memoryTable())
      const error = yield* Effect.flip(
        store.toggle({ repositoryRoot: '/workspace/project', commitId: 'a'.repeat(40), file: file({ contentDigest: null }), reviewed: true }),
      )
      expect(error._tag).toBe('ReviewMarkInvalid')
    }),
  )

  it.effect('the oldest marks are trimmed past the bound', () =>
    Effect.gen(function* () {
      const seeded = Array.from({ length: MAX_REVIEW_MARKS }, (_item, index) =>
        mark({ path: `src/f${String(index)}.ts`, contentDigest: index.toString(16).padStart(64, '0'), reviewedAt: new Date(index * 1_000).toISOString() }),
      )
      yield* TestClock.setTime(MAX_REVIEW_MARKS * 1_000)
      const table = memoryTable(seeded)
      const store = yield* ReviewProgressStoreModel.make(table)

      yield* store.toggle({ repositoryRoot: '/workspace/project', commitId: 'a'.repeat(40), file: file({ path: 'src/newest.ts' }), reviewed: true })

      expect(table.rows.size).toBe(MAX_REVIEW_MARKS)
      expect(table.rows.has(ReviewProgressStoreModel.key(mark({ path: 'src/f0.ts' })))).toBe(false)
      expect(table.rows.has(ReviewProgressStoreModel.key(mark({ path: 'src/newest.ts' })))).toBe(true)
      expect((yield* store.snapshot).store.marks).toHaveLength(MAX_REVIEW_MARKS)
    }),
  )
})
