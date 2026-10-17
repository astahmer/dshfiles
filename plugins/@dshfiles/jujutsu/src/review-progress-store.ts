import { defineDomain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import type { ReviewProgressSnapshot, ReviewProgressToggle } from './review-progress-api.js'
import { ReviewProgressModel, reviewMarkSchema, reviewStoreSchema, type ReviewMark } from './review-progress.js'

export const reviewProgressDomain = defineDomain({
  name: 'jujutsu_review_progress',
  version: 1,
  tables: {
    marks: { valueSchema: reviewMarkSchema, __key: 'marks' },
  },
})

export type ReviewMarksTable = KvTable<string, ReviewMark>

export interface ReviewMarkIdentity {
  readonly repositoryRoot: string
  readonly commitId: string
  readonly path: string
}

/** One row per reviewed file: re-reviewing changed content replaces its digest instead of adding a row. */
export const reviewMarkKey = (identity: ReviewMarkIdentity): string => `${identity.repositoryRoot}\u0000${identity.commitId}\u0000${identity.path}`

/** Monotone across Host restarts: a new snapshot always outranks every stored revision. */
export const nextReviewRevision = (current: number, now: number): number => Math.max(current + 1, now)

const byReviewedAtDescending = (left: ReviewMark, right: ReviewMark): number => right.reviewedAt.localeCompare(left.reviewedAt)

export interface ReviewProgressStore {
  snapshot(): ReviewProgressSnapshot
  toggle(input: ReviewProgressToggle): Promise<ReviewProgressSnapshot>
  flush(): Promise<void>
}

/** The Host's durable record of which exact file contents the user reviewed, shared by every browser and plugin. */
export const createReviewProgressStore = ({
  table,
  now = Date.now,
  reportError = error => console.error('Jujutsu review progress write failed', { error: error instanceof Error ? error.message.slice(0, 200) : String(error) }),
}: {
  readonly table: ReviewMarksTable
  readonly now?: () => number
  readonly reportError?: (error: unknown) => void
}): ReviewProgressStore => {
  const marks = new Map<string, ReviewMark>(table.entries())
  let revision = Math.max(now(), 1)
  let writes: Promise<void> = Promise.resolve()

  const enqueue = (operation: () => Promise<void | boolean>): Promise<void> => {
    const result = writes.then(operation).then(() => undefined)
    writes = result.catch(() => undefined)
    return result
  }

  const bounded = (): ReviewMark[] => ReviewProgressModel.boundedMarks([...marks.values()].sort(byReviewedAtDescending))

  const trim = (): void => {
    const kept = new Set(bounded().map(reviewMarkKey))
    for (const key of [...marks.keys()]) {
      if (kept.has(key)) continue
      marks.delete(key)
      void enqueue(() => table.delete(key)).catch(reportError)
    }
  }

  const snapshot = (): ReviewProgressSnapshot => ({ revision, store: reviewStoreSchema.parse({ schemaVersion: 1, marks: bounded() }) })

  return {
    snapshot,
    toggle: async input => {
      if (input.file.contentDigest === null) throw new Error('A file without a content digest cannot be marked reviewed.')
      const mark: ReviewMark = {
        repositoryRoot: input.repositoryRoot,
        commitId: input.commitId,
        path: input.file.path,
        contentDigest: input.file.contentDigest,
        reviewedAt: new Date(now()).toISOString(),
      }
      const key = reviewMarkKey(mark)
      revision = nextReviewRevision(revision, now())
      if (input.reviewed) {
        marks.set(key, mark)
        trim()
        if (marks.has(key)) await enqueue(() => table.put(key, mark))
      } else {
        marks.delete(key)
        await enqueue(() => table.delete(key))
      }
      return snapshot()
    },
    flush: () => writes,
  }
}
