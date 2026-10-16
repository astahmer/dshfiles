import { describe, expect, it } from 'vitest'
import {
  applyFileReviews,
  boundedReviewMarks,
  isFileReviewed,
  readReviewStore,
  reviewProgress,
  toggleFileReview,
  type ReviewMark,
  type ReviewStore,
} from './review-progress.js'

const mark = (overrides: Partial<ReviewMark> = {}): ReviewMark => ({
  repositoryRoot: '/workspace/project',
  commitId: 'a'.repeat(40),
  path: 'src/main.ts',
  contentDigest: 'b'.repeat(64),
  reviewedAt: '2026-10-05T12:00:00.000Z',
  ...overrides,
})

describe('exact-content file review progress', () => {
  it('persists exact patch identity and scopes counts to one repository and revision', () => {
    const store = toggleFileReview({ schemaVersion: 1, marks: [] }, mark(), true)
    const files = [
      { path: 'src/main.ts', contentDigest: 'b'.repeat(64) },
      { path: 'src/other.ts', contentDigest: 'c'.repeat(64) },
      { path: 'src/truncated.ts', contentDigest: null },
    ]

    expect(readReviewStore(JSON.stringify(store))).toEqual(store)
    expect(reviewProgress(store, '/workspace/project', 'a'.repeat(40), files)).toEqual({ reviewed: 1, total: 2 })
    expect(reviewProgress(store, '/workspace/other', 'a'.repeat(40), files)).toEqual({ reviewed: 0, total: 2 })
    expect(reviewProgress(store, '/workspace/project', 'd'.repeat(40), files)).toEqual({ reviewed: 0, total: 2 })
  })

  it('clears review when same-line-count diff content changes', () => {
    const original = mark()
    const edited = mark({ contentDigest: 'c'.repeat(64) })
    const store = toggleFileReview({ schemaVersion: 1, marks: [] }, original, true)

    expect(isFileReviewed(store, edited.repositoryRoot, edited.commitId, { path: edited.path, contentDigest: edited.contentDigest })).toBe(false)
    expect(toggleFileReview(store, edited, true).marks).toEqual([edited])
  })

  it('ignores corrupt data and removes only the selected file mark', () => {
    const first = mark()
    const second = mark({ path: 'src/other.ts', contentDigest: 'c'.repeat(64) })
    const store: ReviewStore = { schemaVersion: 1, marks: [first, second] }

    expect(readReviewStore('{')).toEqual({ schemaVersion: 1, marks: [] })
    expect(toggleFileReview(store, first, false).marks).toEqual([second])
  })

  it('applies a batch of review changes and skips files without a content digest', () => {
    const store = applyFileReviews({
      store: { schemaVersion: 1, marks: [] },
      changes: [
        { file: { path: 'src/main.ts', contentDigest: 'b'.repeat(64) }, reviewed: true },
        { file: { path: 'src/truncated.ts', contentDigest: null }, reviewed: true },
      ],
      repositoryRoot: '/workspace/project',
      commitId: 'a'.repeat(40),
      reviewedAt: '2026-10-05T12:00:00.000Z',
    })

    expect(store.marks).toEqual([mark()])
    expect(
      applyFileReviews({
        store,
        changes: [{ file: { path: 'src/main.ts', contentDigest: 'b'.repeat(64) }, reviewed: false }],
        repositoryRoot: '/workspace/project',
        commitId: 'a'.repeat(40),
        reviewedAt: '2026-10-05T12:00:01.000Z',
      }).marks,
    ).toEqual([])
  })

  it('keeps the newest marks inside the count and byte bounds', () => {
    const newest = mark({ reviewedAt: '2026-10-05T12:00:02.000Z' })
    const middle = mark({ path: 'src/middle.ts', reviewedAt: '2026-10-05T12:00:01.000Z' })
    const oldest = mark({ path: 'src/oldest.ts', reviewedAt: '2026-10-05T12:00:00.000Z' })

    expect(boundedReviewMarks([newest, middle, oldest]).map(item => item.path)).toEqual(['src/main.ts', 'src/middle.ts', 'src/oldest.ts'])
    expect(boundedReviewMarks(Array.from({ length: 3_001 }, () => newest))).toHaveLength(3_000)
  })
})
