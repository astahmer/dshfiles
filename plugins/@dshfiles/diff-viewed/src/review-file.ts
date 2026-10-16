import { z } from 'zod'

const reviewCoordinatesSchema = z.object({
  sessionId: z.string().min(1),
  seq: z.coerce.number().int().nonnegative(),
  index: z.coerce.number().int().nonnegative(),
})

export type ReviewCoordinates = z.infer<typeof reviewCoordinatesSchema>

const changesSummarySchema = z.object({
  files: z.array(z.object({ path: z.string().min(1), display: z.string() })),
})

export type ChangesSummaryFiles = z.infer<typeof changesSummarySchema>['files']

/**
 * The review tab hands its file actions an authenticated open route carrying the
 * Session, the announcing `workspace/changes` sequence, and the file's summary index.
 */
const parseReviewCoordinates = (actionUrl: string): ReviewCoordinates | undefined => {
  const query = actionUrl.split('?')[1]
  if (query === undefined) return undefined
  const parsed = reviewCoordinatesSchema.safeParse(Object.fromEntries(new URLSearchParams(query)))
  return parsed.success ? parsed.data : undefined
}

/** The same document-relative summary route the changed-files card and review tab read. */
const changesSummaryUrl = (coordinates: Pick<ReviewCoordinates, 'sessionId' | 'seq'>): string =>
  `api/changes.summary?${new URLSearchParams({ sessionId: coordinates.sessionId, seq: String(coordinates.seq) })}`

const parseChangesSummaryFiles = (value: unknown): ChangesSummaryFiles | undefined => {
  const parsed = changesSummarySchema.safeParse(value)
  return parsed.success ? parsed.data.files : undefined
}

export class ReviewFileModel {
  static readonly parseReviewCoordinates = parseReviewCoordinates
  static readonly changesSummaryUrl = changesSummaryUrl
  static readonly parseChangesSummaryFiles = parseChangesSummaryFiles
}
