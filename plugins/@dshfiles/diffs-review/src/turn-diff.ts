import { ReviewImageModel, type ChangedImageEntry } from './review-image-query.js'
import { TurnChangesModel, TurnChangesReadError } from './turn-changes.js'

/** One turn can list many files; the facet reads at most this many comparisons and says so. */
const MAX_TURN_DIFFS = 150

export interface FacetFile {
  readonly path: string
  readonly display: string
  readonly added: number
  readonly deleted: number
}

/** What the Changes facet shows for one scope: its files, their text patch, and its changed images. */
export interface FacetDiff {
  readonly files: readonly FacetFile[]
  readonly patch: string
  readonly images: readonly ChangedImageEntry[]
  readonly truncated: boolean
  readonly label: string
}

type FetchJson = (url: string, signal: AbortSignal) => Promise<unknown>

/** Fetch one document-relative Host route as JSON; a non-2xx or empty (204) answer is an error the facet can show. */
const fetchJson: FetchJson = async (url, signal) => {
  const response = await fetch(url, { signal })
  if (!response.ok || response.status === 204) throw new TurnChangesReadError(response.status)
  return response.json()
}

/**
 * One turn's changes from DSH's turn snapshot: text files as one patch, binary or oversized ones without a patch, and
 * the images among them by their current version in the thread's folder.
 */
const read = async (input: {
  readonly sessionId: string
  readonly seq: number
  readonly cwd: string | undefined
  readonly signal: AbortSignal
  readonly fetchJson?: FetchJson | undefined
}): Promise<FacetDiff> => {
  const readJson = input.fetchJson ?? fetchJson
  const summary = TurnChangesModel.decodeSummary(await readJson(TurnChangesModel.summaryUrl(input.sessionId, input.seq), input.signal))
  if (summary === undefined) throw new Error("This turn's change summary could not be read. Refresh to try again.")
  const listed = summary.files.slice(0, MAX_TURN_DIFFS)
  const patches = await Promise.all(
    listed.map(async (file, index) => {
      if (file.binary === true || file.oversized === true) return ''
      const diff = TurnChangesModel.decodeDiff(await readJson(TurnChangesModel.diffUrl(input.sessionId, input.seq, index), input.signal))
      return diff === undefined ? '' : TurnChangesModel.patchOf(diff)
    }),
  )
  const workspacePath = summary.cwd ?? input.cwd
  return {
    files: listed.map(file => ({ path: file.path, display: file.display, added: file.added, deleted: file.deleted })),
    patch: patches.join(''),
    images:
      workspacePath === undefined
        ? []
        : ReviewImageModel.turnImages({ workspacePath, files: listed.filter(file => file.binary === true || file.oversized === true) }),
    truncated: summary.files.length > listed.length,
    label: `Turn ${String(summary.turn)}`,
  }
}

export class TurnDiffModel {
  static readonly read = read
}
