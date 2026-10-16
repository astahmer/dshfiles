import { z } from 'zod'

export const MAX_REVIEW_MARKS = 3_000
export const MAX_REVIEW_STORE_BYTES = 1_200_000

const reviewPathSchema = z.string().min(1).max(2048)
const reviewDigestSchema = z.string().regex(/^[a-f0-9]{64}$/)

export const reviewFileSchema = z
  .object({
    path: reviewPathSchema,
    contentDigest: reviewDigestSchema.nullable(),
  })
  .strict()

export const reviewMarkSchema = z
  .object({
    repositoryRoot: z.string().min(1).max(2048),
    commitId: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
    path: reviewPathSchema,
    contentDigest: reviewDigestSchema,
    reviewedAt: z.string().datetime(),
  })
  .strict()

export const reviewStoreSchema = z
  .object({
    schemaVersion: z.literal(1),
    marks: z.array(reviewMarkSchema).max(MAX_REVIEW_MARKS),
  })
  .strict()
  .superRefine((store, context) => {
    const keys = store.marks.map(mark => `${mark.repositoryRoot}\u0000${mark.commitId}\u0000${mark.path}\u0000${mark.contentDigest}`)
    if (new Set(keys).size !== keys.length) context.addIssue({ code: 'custom', message: 'Review marks must be unique.' })
  })

export type ReviewFile = z.infer<typeof reviewFileSchema>
export type ReviewMark = z.infer<typeof reviewMarkSchema>
export type ReviewStore = z.infer<typeof reviewStoreSchema>

export interface ReviewChange {
  readonly file: ReviewFile
  readonly reviewed: boolean
}

const emptyReviewStore = (): ReviewStore => ({ schemaVersion: 1, marks: [] })

export const readReviewStore = (source: string | null): ReviewStore => {
  if (source === null || new TextEncoder().encode(source).byteLength > MAX_REVIEW_STORE_BYTES) return emptyReviewStore()
  try {
    const decoded: unknown = JSON.parse(source)
    const result = reviewStoreSchema.safeParse(decoded)
    return result.success ? result.data : emptyReviewStore()
  } catch {
    return emptyReviewStore()
  }
}

export const isFileReviewed = (store: ReviewStore, repositoryRoot: string, commitId: string, file: ReviewFile): boolean =>
  file.contentDigest !== null &&
  store.marks.some(
    mark => mark.repositoryRoot === repositoryRoot && mark.commitId === commitId && mark.path === file.path && mark.contentDigest === file.contentDigest,
  )

/** Newest marks win; keeps both the count and byte bounds the browser store enforced. */
export const boundedReviewMarks = (ordered: readonly ReviewMark[]): ReviewMark[] => {
  const encoder = new TextEncoder()
  const emptySize = encoder.encode(JSON.stringify({ schemaVersion: 1, marks: [] })).byteLength
  const bounded: ReviewMark[] = []
  let storedBytes = emptySize
  for (const mark of ordered.slice(0, MAX_REVIEW_MARKS)) {
    const markBytes = encoder.encode(JSON.stringify(mark)).byteLength
    const separatorBytes = bounded.length === 0 ? 0 : 1
    if (storedBytes + markBytes + separatorBytes > MAX_REVIEW_STORE_BYTES) continue
    bounded.push(mark)
    storedBytes += markBytes + separatorBytes
  }
  return bounded
}

const byReviewedAtDescending = (left: ReviewMark, right: ReviewMark): number => right.reviewedAt.localeCompare(left.reviewedAt)

export const toggleFileReview = (store: ReviewStore, mark: ReviewMark, reviewed: boolean): ReviewStore => {
  const previous = store.marks.filter(item => item.repositoryRoot !== mark.repositoryRoot || item.commitId !== mark.commitId || item.path !== mark.path)
  if (!reviewed) return reviewStoreSchema.parse({ schemaVersion: 1, marks: previous })
  return reviewStoreSchema.parse({ schemaVersion: 1, marks: boundedReviewMarks([...previous, mark].sort(byReviewedAtDescending)) })
}

export const applyFileReviews = ({
  store,
  changes,
  repositoryRoot,
  commitId,
  reviewedAt,
}: {
  readonly store: ReviewStore
  readonly changes: readonly ReviewChange[]
  readonly repositoryRoot: string
  readonly commitId: string
  readonly reviewedAt: string
}): ReviewStore =>
  changes.reduce(
    (current, change) =>
      change.file.contentDigest === null
        ? current
        : toggleFileReview(
            current,
            { repositoryRoot, commitId, path: change.file.path, contentDigest: change.file.contentDigest, reviewedAt },
            change.reviewed,
          ),
    store,
  )

export const reviewProgress = (
  store: ReviewStore,
  repositoryRoot: string,
  commitId: string,
  files: readonly ReviewFile[],
): { readonly reviewed: number; readonly total: number } => {
  const reviewableFiles = files.filter(file => file.contentDigest !== null)
  return {
    reviewed: reviewableFiles.filter(file => isFileReviewed(store, repositoryRoot, commitId, file)).length,
    total: reviewableFiles.length,
  }
}
