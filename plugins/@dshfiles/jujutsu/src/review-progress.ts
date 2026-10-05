import { z } from 'zod'

export const MAX_REVIEW_MARKS = 3_000
export const MAX_REVIEW_STORE_BYTES = 1_200_000

const reviewMarkSchema = z.object({
  repositoryRoot: z.string().min(1).max(2048),
  commitId: z.string().regex(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/),
  path: z.string().min(1).max(2048),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  reviewedAt: z.string().datetime(),
}).strict()

const reviewStoreSchema = z.object({
  schemaVersion: z.literal(1),
  marks: z.array(reviewMarkSchema).max(MAX_REVIEW_MARKS),
}).strict().superRefine((store, context) => {
  const keys = store.marks.map(mark => `${mark.repositoryRoot}\u0000${mark.commitId}\u0000${mark.path}\u0000${mark.contentDigest}`)
  if (new Set(keys).size !== keys.length) context.addIssue({ code: 'custom', message: 'Review marks must be unique.' })
})

export type ReviewMark = z.infer<typeof reviewMarkSchema>
export type ReviewStore = z.infer<typeof reviewStoreSchema>

export interface ReviewFile {
  readonly path: string
  readonly contentDigest: string | null
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

export const isFileReviewed = (
  store: ReviewStore,
  repositoryRoot: string,
  commitId: string,
  file: ReviewFile,
): boolean => file.contentDigest !== null && store.marks.some(mark =>
  mark.repositoryRoot === repositoryRoot &&
  mark.commitId === commitId &&
  mark.path === file.path &&
  mark.contentDigest === file.contentDigest,
)

export const toggleFileReview = (
  store: ReviewStore,
  mark: ReviewMark,
  reviewed: boolean,
): ReviewStore => {
  const previous = store.marks.filter(item =>
    item.repositoryRoot !== mark.repositoryRoot || item.commitId !== mark.commitId || item.path !== mark.path,
  )
  const ordered = reviewed
    ? [...previous, mark].sort((left, right) => right.reviewedAt.localeCompare(left.reviewedAt)).slice(0, MAX_REVIEW_MARKS)
    : previous
  const encoder = new TextEncoder()
  const emptySize = encoder.encode(JSON.stringify({ schemaVersion: 1, marks: [] })).byteLength
  const boundedMarks: ReviewMark[] = []
  let storedBytes = emptySize
  for (const item of ordered) {
    const itemBytes = encoder.encode(JSON.stringify(item)).byteLength
    const separatorBytes = boundedMarks.length === 0 ? 0 : 1
    if (storedBytes + itemBytes + separatorBytes > MAX_REVIEW_STORE_BYTES) continue
    boundedMarks.push(item)
    storedBytes += itemBytes + separatorBytes
  }
  return reviewStoreSchema.parse({ schemaVersion: 1, marks: boundedMarks })
}

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
