import { Option } from 'effect'
import * as Schema from 'effect/Schema'

/** A route carries its numbers as text; decode to a non-negative integer once, at this boundary. */
const routeNumberSchema = Schema.NumberFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

const reviewCoordinatesSchema = Schema.Struct({
  sessionId: Schema.String.check(Schema.isMinLength(1)),
  seq: routeNumberSchema,
  index: routeNumberSchema,
})

export type ReviewCoordinates = typeof reviewCoordinatesSchema.Type

const changesSummarySchema = Schema.Struct({
  files: Schema.Array(Schema.Struct({ path: Schema.String.check(Schema.isMinLength(1)), display: Schema.String })),
})

export type ChangesSummaryFiles = (typeof changesSummarySchema.Type)['files']

/**
 * The review tab hands its file actions an authenticated open route carrying the
 * Session, the announcing `workspace/changes` sequence, and the file's summary index.
 */
const parseReviewCoordinates = (actionUrl: string): ReviewCoordinates | undefined => {
  const query = actionUrl.split('?')[1]
  if (query === undefined) return undefined
  const parsed = Schema.decodeUnknownOption(reviewCoordinatesSchema)(Object.fromEntries(new URLSearchParams(query)))
  return Option.isSome(parsed) ? parsed.value : undefined
}

/** The same document-relative summary route the changed-files card and review tab read. */
const changesSummaryUrl = (coordinates: Pick<ReviewCoordinates, 'sessionId' | 'seq'>): string =>
  `api/changes.summary?${new URLSearchParams({ sessionId: coordinates.sessionId, seq: String(coordinates.seq) })}`

const parseChangesSummaryFiles = (value: unknown): ChangesSummaryFiles | undefined => {
  const parsed = Schema.decodeUnknownOption(changesSummarySchema)(value)
  return Option.isSome(parsed) ? parsed.value.files : undefined
}

/**
 * One turn's listed files, or null when the Host no longer serves its summary. The Host keeps a turn's summary only
 * while that Session's change recorder is loaded (a Host restart or an unloaded Session answers 404), and the native
 * review tab hides its file actions then, so "no summary" hides the toggle instead of reporting an error.
 */
const readSummaryFiles = async (
  fetchImpl: (url: string, init: { readonly signal: AbortSignal }) => Promise<Pick<Response, 'ok' | 'json'>>,
  url: string,
  signal: AbortSignal,
): Promise<ChangesSummaryFiles | null> => {
  const response = await fetchImpl(url, { signal })
  return response.ok ? (parseChangesSummaryFiles(await response.json()) ?? null) : null
}

/**
 * A turn's summary never changes once announced, so it is read once per page: a remount for the next selected file, a
 * refocus or a reconnect would only re-ask a Host that may have dropped the recorder since, and every such 404 lands in
 * the browser console as a failed request.
 */
const summaryQueryOptions = {
  staleTime: Number.POSITIVE_INFINITY,
  retry: false,
  refetchOnMount: false,
  refetchOnWindowFocus: false,
  refetchOnReconnect: false,
} as const

export class ReviewFileModel {
  static readonly parseReviewCoordinates = parseReviewCoordinates
  static readonly changesSummaryUrl = changesSummaryUrl
  static readonly parseChangesSummaryFiles = parseChangesSummaryFiles
  static readonly readSummaryFiles = readSummaryFiles
  static readonly summaryQueryOptions = summaryQueryOptions
}
