import { Option, Schema } from 'effect'
import type { RevisionReview, RevisionsReviewFailureReason, RevisionsReviewResult } from './api.js'

/** One selected revision as jj reports it; its diff is read once the selection is ordered. */
export interface ResolvedRevision {
  readonly requested: string
  readonly commitId: string
  readonly changeId: string
  readonly shortChangeId: string
  readonly description: string
  readonly parents: readonly string[]
}

const MAX_DESCRIPTION_CHARS = 300

/** One JSON line per revision, so a description holding a tab or a quote stays one field. */
const REVISION_TEMPLATE =
  '\'{"commitId":\' ++ self.commit_id().short(64).escape_json() ++ ' +
  '\',"changeId":\' ++ self.change_id().short(64).escape_json() ++ ' +
  '\',"shortChangeId":\' ++ self.change_id().shortest().prefix().escape_json() ++ ' +
  '\',"description":\' ++ self.description().first_line().escape_json() ++ ' +
  '\',"parents":[\' ++ self.parents().map(|c| c.commit_id().short(64).escape_json()).join(",") ++ \']}\' ++ "\\n"'

const COMMIT_ID_TEMPLATE = 'commit_id ++ "\\n"'

const revisionLineSchema = Schema.Struct({
  commitId: Schema.String,
  changeId: Schema.String,
  shortChangeId: Schema.String,
  description: Schema.String,
  parents: Schema.Array(Schema.String),
})
const decodeRevisionLine = Schema.decodeUnknownOption(Schema.fromJsonString(revisionLineSchema))

/** The one revision a selection names; a `requested` of more than one line would mean jj returned several. */
const decodeResolved = (requested: string, stdout: string): ResolvedRevision | undefined => {
  const lines = stdout.split('\n').filter(line => line.length > 0)
  if (lines.length !== 1) return undefined
  const line = decodeRevisionLine(lines[0] ?? '')
  return Option.isSome(line) ? { requested, ...line.value, description: line.value.description.slice(0, MAX_DESCRIPTION_CHARS) } : undefined
}

/** Argv reading one requested id; the API pattern keeps it one revset symbol, never an expression. */
const describeArgs = (revision: string): readonly string[] => ['log', '-r', revision, '--no-graph', '-T', REVISION_TEMPLATE]

/** Ancestors first: jj's own topological order, so a stacked selection reads the way it was built. */
const orderArgs = (commitIds: readonly string[]): readonly string[] => [
  'log',
  '-r',
  commitIds.join(' | '),
  '--reversed',
  '--no-graph',
  '-T',
  COMMIT_ID_TEMPLATE,
]

/** One revision's own change. `jj diff -r` also compares a merge against its merged parents, which `--from` would not. */
const diffArgs = (commitId: string): readonly string[] => ['diff', '--git', '-r', commitId]

const PATCH_SEPARATOR = '\u0000'

/** Every selected revision's own patch in one read: each commit id sits between two NULs, its patch right after. */
const patchesArgs = (commitIds: readonly string[]): readonly string[] => [
  'log',
  '-r',
  commitIds.join(' | '),
  '--git',
  '--patch',
  '--no-graph',
  '-T',
  `"\\0" ++ commit_id.short(64) ++ "\\0"`,
]

const COMMIT_ID = /^[0-9a-f]{40,64}$/u

/** Every requested id's revision in one read, ancestors first: the ordering read is the describe read. */
const describeManyArgs = (revisions: readonly string[]): readonly string[] => [
  'log',
  '-r',
  revisions.join(' | '),
  '--reversed',
  '--no-graph',
  '-T',
  REVISION_TEMPLATE,
]

/**
 * The revisions one `jj log --reversed` printed, each tagged with the requested id that names it; undefined unless every
 * requested id names exactly one returned revision, so an ambiguous or missing id still takes the one-at-a-time path.
 */
const decodeSelection = (requested: readonly string[], stdout: string): readonly ResolvedRevision[] | undefined => {
  const matchedBy = new Map<string, number>()
  const found = new Map<string, ResolvedRevision>()
  for (const line of stdout.split('\n').filter(text => text.length > 0)) {
    const decoded = decodeRevisionLine(line)
    if (Option.isNone(decoded)) return undefined
    const matching = requested.filter(id => decoded.value.commitId.startsWith(id) || decoded.value.changeId.startsWith(id))
    const match = matching[0]
    if (match === undefined || matching.length > 1) return undefined
    matchedBy.set(match, (matchedBy.get(match) ?? 0) + 1)
    const revision: ResolvedRevision = {
      requested: match,
      ...decoded.value,
      description: decoded.value.description.slice(0, MAX_DESCRIPTION_CHARS),
    }
    if (!found.has(revision.commitId)) found.set(revision.commitId, revision)
  }
  const everyRequestedFound = requested.every(id => matchedBy.get(id) === 1)
  return everyRequestedFound ? [...found.values()] : undefined
}

/** The patches one `jj log --patch` printed, by commit id; undefined when the framing is not exactly one id and one patch per revision. */
const decodePatches = (stdout: string): Map<string, string> | undefined => {
  const parts = stdout.split(PATCH_SEPARATOR)
  if (parts.length < 3 || parts.length % 2 === 0 || parts[0] !== '') return undefined
  const patches = new Map<string, string>()
  for (let index = 1; index + 1 < parts.length; index += 2) {
    const commitId = parts[index] ?? ''
    if (!COMMIT_ID.test(commitId)) return undefined
    patches.set(commitId, parts[index + 1] ?? '')
  }
  return patches
}

/** Put `resolved` in jj's order; a revision jj left out of the ordering read stays, last, rather than vanishing. */
const inOrder = (resolved: readonly ResolvedRevision[], stdout: string): readonly ResolvedRevision[] => {
  const position = new Map(
    stdout
      .split('\n')
      .filter(line => line.length > 0)
      .map((commitId, index) => [commitId, index]),
  )
  const rank = (revision: ResolvedRevision): number => position.get(revision.commitId) ?? Number.MAX_SAFE_INTEGER
  return [...resolved].sort((left, right) => rank(left) - rank(right))
}

/**
 * How many unconnected runs a selection falls into: a revision with no selected parent starts one. One run is a
 * stack; more means revisions between them are not part of this review, which the review says instead of hiding.
 */
const segments = (revisions: readonly Pick<ResolvedRevision, 'commitId' | 'parents'>[]): number => {
  const selected = new Set(revisions.map(revision => revision.commitId))
  return revisions.filter(revision => !revision.parents.some(parent => selected.has(parent))).length
}

const failure = (path: string, reason: RevisionsReviewFailureReason, message: string): RevisionsReviewResult => ({ status: 'failed', path, reason, message })

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`

const MAX_REPORT_FILES = 20

const revisionLines = (revision: RevisionReview): readonly string[] => {
  const header = `${revision.shortChangeId} · ${revision.description.length === 0 ? '(no description)' : revision.description} · ${plural(revision.fileCount, 'file')} · +${String(revision.additions)} −${String(revision.deletions)}`
  const files = revision.files.slice(0, MAX_REPORT_FILES).map(file => `  - ${file.path} (+${String(file.additions)} −${String(file.deletions)})`)
  const hidden = revision.fileCount - Math.min(revision.files.length, MAX_REPORT_FILES)
  return [
    header,
    ...files,
    ...(hidden > 0 ? [`  … ${String(hidden)} more`] : []),
    ...(revision.truncated ? ['  This revision was too large to read whole.'] : []),
  ]
}

/** The text `pulls_review_revisions` returns to an agent: each revision and its own files, oldest first. */
const reportText = (result: RevisionsReviewResult): string => {
  if (result.status === 'failed') return result.message
  const lines = [
    `pulls.review · ${plural(result.revisions.length, 'revision')} · ${plural(result.fileCount, 'changed file')} · +${String(result.additions)} −${String(result.deletions)}`,
  ]
  if (result.segments > 1) lines.push(`The selection has gaps: ${String(result.segments)} separate runs, each revision shown as its own change.`)
  for (const revision of result.revisions) lines.push(...revisionLines(revision))
  for (const skipped of result.unresolved) lines.push(`Skipped ${skipped.revision}: ${skipped.message}`)
  return lines.join('\n')
}

export const RevisionReviewModel = {
  decodeResolved,
  decodeSelection,
  describeArgs,
  describeManyArgs,
  orderArgs,
  diffArgs,
  patchesArgs,
  decodePatches,
  inOrder,
  segments,
  failure,
  reportText,
}
