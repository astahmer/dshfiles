import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { toStorageSchema } from '@dshfiles/dshx/host'
import type { StorageDomainReadFailed, StorageDomainWriteFailed, StorageTable } from '@dshfiles/dshx/effect/storage-domain'
import { Clock, Effect, Ref, Schema, Semaphore } from 'effect'
import type { ReviewProgressSnapshot, ReviewProgressToggle } from './review-progress-api.js'
import { ReviewMarkInvalid } from './errors.js'
import { ReviewProgressModel, reviewMarkSchema, reviewStoreSchema, type ReviewMark } from './review-progress.js'

export const reviewProgressDomain = defineDomain({
  name: 'jujutsu_review_progress',
  version: 1,
  tables: {
    marks: { valueSchema: toStorageSchema(reviewMarkSchema), __key: 'marks' },
  },
})

export type ReviewMarksTable = StorageTable<string, ReviewMark>

export interface ReviewMarkIdentity {
  readonly repositoryRoot: string
  readonly commitId: string
  readonly path: string
}

/** One row per reviewed file: re-reviewing changed content replaces its digest instead of adding a row. */
const reviewMarkKey = (identity: ReviewMarkIdentity): string => `${identity.repositoryRoot}\u0000${identity.commitId}\u0000${identity.path}`

/** Monotone across Host restarts: a new snapshot always outranks every stored revision. */
const nextReviewRevision = (current: number, now: number): number => Math.max(current + 1, now)

const byReviewedAtDescending = (left: ReviewMark, right: ReviewMark): number => right.reviewedAt.localeCompare(left.reviewedAt)

const decodeStore = Schema.decodeUnknownEffect(reviewStoreSchema)

export interface ReviewProgressStore {
  readonly snapshot: Effect.Effect<ReviewProgressSnapshot>
  readonly toggle: (input: ReviewProgressToggle) => Effect.Effect<ReviewProgressSnapshot, ReviewMarkInvalid | StorageDomainWriteFailed>
}

/** The Host's durable record of which exact file contents the user reviewed, shared by every browser and plugin. */
const makeReviewProgressStore = Effect.fnUntraced(function* (table: ReviewMarksTable): Effect.fn.Return<ReviewProgressStore, StorageDomainReadFailed> {
  const marks = yield* Ref.make(new Map<string, ReviewMark>(yield* table.entries))
  const revision = yield* Ref.make(Math.max(yield* Clock.currentTimeMillis, 1))
  const writing = yield* Semaphore.make(1)

  const bounded = (current: ReadonlyMap<string, ReviewMark>): ReviewMark[] =>
    ReviewProgressModel.boundedMarks([...current.values()].sort(byReviewedAtDescending))

  // The bounded marks always decode: they are records the table schema validated, trimmed to the store bound.
  const snapshot = Effect.gen(function* () {
    const store = yield* decodeStore({ schemaVersion: 1, marks: bounded(yield* Ref.get(marks)) }).pipe(Effect.orDie)
    return { revision: yield* Ref.get(revision), store }
  })

  const toggle = (input: ReviewProgressToggle) =>
    writing.withPermit(
      Effect.gen(function* () {
        if (input.file.contentDigest === null) return yield* new ReviewMarkInvalid({})
        const now = yield* Clock.currentTimeMillis
        const mark: ReviewMark = {
          repositoryRoot: input.repositoryRoot,
          commitId: input.commitId,
          path: input.file.path,
          contentDigest: input.file.contentDigest,
          reviewedAt: new Date(now).toISOString(),
        }
        const key = reviewMarkKey(mark)
        yield* Ref.update(revision, current => nextReviewRevision(current, now))
        if (!input.reviewed) {
          yield* Ref.update(marks, current => new Map([...current].filter(([existing]) => existing !== key)))
          yield* table.delete(key)
          return yield* snapshot
        }
        const updated = new Map(yield* Ref.get(marks)).set(key, mark)
        const kept = new Set(bounded(updated).map(reviewMarkKey))
        const trimmed = [...updated.keys()].filter(existing => !kept.has(existing))
        yield* Ref.set(marks, new Map([...updated].filter(([existing]) => kept.has(existing))))
        if (kept.has(key)) yield* table.put(key, mark)
        yield* Effect.forEach(trimmed, existing => table.delete(existing), { discard: true })
        return yield* snapshot
      }),
    )

  return { snapshot, toggle }
})

export class ReviewProgressStoreModel {
  static readonly key = reviewMarkKey
  static readonly nextRevision = nextReviewRevision
  static readonly make = makeReviewProgressStore
}
