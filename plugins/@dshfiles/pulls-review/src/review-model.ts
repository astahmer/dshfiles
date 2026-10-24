import { viewedFileFromKey, viewedKey, type ViewedMarksSnapshot } from '@dshfiles/diff-viewed/marks-api'
import { z } from 'zod'
import type { ReviewResult, ScopeKey } from './api.js'
import { ReviewedMarksModel } from './reviewed.js'

/** Where one review's files, comparisons, marks and comments come from. */
export type ReviewSource =
  | { readonly kind: 'turn'; readonly sessionId: string; readonly seq: number; readonly turn: number }
  | { readonly kind: 'workspace'; readonly path: string; readonly base: string; readonly head: string; readonly range: string }

/** One changed file, as either source describes it. */
export interface ReviewFile {
  readonly path: string
  readonly display: string
  readonly status?: string
  readonly additions: number
  readonly deletions: number
  readonly binary: boolean
  readonly oversized: boolean
  /** pulls.review's scope for a workspace review; `all` for a turn review. */
  readonly scope: string
  /** The source's own index: the summary index for a turn, the file order for a workspace. */
  readonly index: number
}

/** One rail group: a pulls.review scope, or the single list a turn review shows. */
export interface ReviewGroup {
  readonly key: ScopeKey | 'all'
  readonly label: string
  readonly summary?: string
  readonly files: readonly ReviewFile[]
  readonly additions: number
  readonly deletions: number
}

const changesSummarySchema = z.object({
  turn: z.number().int().positive(),
  files: z.array(
    z.object({
      path: z.string().min(1),
      display: z.string().min(1),
      added: z.number().int().nonnegative(),
      deleted: z.number().int().nonnegative(),
      binary: z.boolean().optional(),
      oversized: z.boolean().optional(),
    }),
  ),
})

export type TurnChangesSummary = z.infer<typeof changesSummarySchema>

/** Parse the Host's per-turn summary, or nothing when the record is gone or malformed. */
const turnSummaryFrom = (value: unknown): TurnChangesSummary | undefined => {
  const parsed = changesSummarySchema.safeParse(value)
  return parsed.success ? parsed.data : undefined
}

const TURN_SCOPE = 'all'

/** The single group a turn review shows in the rail. */
export const TURN_GROUP_LABEL = 'Files'

/** Build one review's file list from its turn summary. */
const turnFiles = (summary: TurnChangesSummary): readonly ReviewFile[] =>
  summary.files.map((file, index) => ({
    path: file.path,
    display: file.display,
    additions: file.added,
    deletions: file.deleted,
    binary: file.binary === true,
    oversized: file.oversized === true,
    scope: TURN_SCOPE,
    index,
  }))

/** Build the rail groups of a turn review: one list, because a turn snapshot carries no scope grouping. */
const turnGroups = (files: readonly ReviewFile[]): readonly ReviewGroup[] => [
  {
    key: TURN_SCOPE,
    label: TURN_GROUP_LABEL,
    files,
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
  },
]

/** Build one workspace review's file list, keeping pulls.review's scopes and file order. */
const workspaceFiles = (result: Extract<ReviewResult, { status: 'ok' }>): readonly ReviewFile[] => {
  const scopeOfPath = new Map<string, string>()
  for (const scope of result.scopes) for (const path of scope.filePaths) scopeOfPath.set(path, scope.key)
  return result.files.map((file, index) => ({
    path: file.path,
    display: file.path,
    status: file.status,
    additions: file.additions,
    deletions: file.deletions,
    binary: false,
    oversized: false,
    scope: scopeOfPath.get(file.path) ?? 'other',
    index,
  }))
}

/** Group a workspace review's files by the scopes pulls.review produced, in scope order. */
const workspaceGroups = (result: Extract<ReviewResult, { status: 'ok' }>, files: readonly ReviewFile[]): readonly ReviewGroup[] => {
  const byPath = new Map(files.map(file => [file.path, file]))
  const groups: ReviewGroup[] = []
  const claimed = new Set<string>()
  for (const scope of result.scopes) {
    const scoped = scope.filePaths.flatMap(path => {
      const file = byPath.get(path)
      if (file === undefined) return []
      claimed.add(path)
      return [file]
    })
    if (scoped.length === 0) continue
    groups.push({ key: scope.key, label: scope.label, summary: scope.summary, files: scoped, additions: scope.additions, deletions: scope.deletions })
  }
  const left = files.filter(file => !claimed.has(file.path))
  if (left.length > 0) {
    groups.push({
      key: 'other',
      label: 'Other',
      summary: "Other changes that don't fit an existing category.",
      files: left,
      additions: left.reduce((total, file) => total + file.additions, 0),
      deletions: left.reduce((total, file) => total + file.deletions, 0),
    })
  }
  return groups
}

const reviewTotals = (files: readonly ReviewFile[]): { readonly files: number; readonly additions: number; readonly deletions: number } => ({
  files: files.length,
  additions: files.reduce((total, file) => total + file.additions, 0),
  deletions: files.reduce((total, file) => total + file.deletions, 0),
})

/** A stable key for one review, shared by comments and local progress. */
const reviewKey = (source: ReviewSource): string =>
  source.kind === 'turn' ? JSON.stringify(['turn', source.sessionId, source.seq]) : JSON.stringify(['workspace', source.path, source.base, source.head])

/** What a comment thread is anchored to; the same identity as {@link reviewKey}, kept structured on the Host. */
const commentSource = (source: ReviewSource) =>
  source.kind === 'turn'
    ? ({ kind: 'turn', sessionId: source.sessionId, seq: source.seq } as const)
    : ({ kind: 'workspace', path: source.path, base: source.base, head: source.head } as const)

/** The viewed-key set of a turn review, from the Host's diff-viewed snapshot. */
const viewedPathsOf = (snapshot: ViewedMarksSnapshot | undefined, source: Extract<ReviewSource, { kind: 'turn' }>): ReadonlySet<string> => {
  const viewed = new Set<string>()
  for (const key of snapshot?.marks ?? []) {
    const file = viewedFileFromKey(key)
    if (file === undefined || file === null) continue
    if (file.sessionId === source.sessionId && file.seq === source.seq) viewed.add(file.path)
  }
  return viewed
}

/** The viewed key one turn file owns. */
const viewedKeyOf = (source: Extract<ReviewSource, { kind: 'turn' }>, path: string): string => viewedKey({ sessionId: source.sessionId, seq: source.seq, path })

/** The local review record's key for a workspace review. */
const workspaceReviewedKeyOf = (source: Extract<ReviewSource, { kind: 'workspace' }>): string => ReviewedMarksModel.keyOf(source.path, source.base, source.head)

/** The review address the native deliverables package opens for one turn. */
const changesReviewAddress = (source: Extract<ReviewSource, { kind: 'turn' }>): string =>
  `dsh-resource://changes-review/session/${source.sessionId}/${String(source.seq)}/${String(source.turn)}`

const addressSchema = z.object({
  sessionId: z.string().min(1),
  seq: z.coerce.number().int().nonnegative(),
  turn: z.coerce.number().int().positive(),
})

/** Read the turn coordinates out of a `changes-review` address. */
const parseChangesReviewAddress = (address: string): Extract<ReviewSource, { kind: 'turn' }> | undefined => {
  if (!address.startsWith('dsh-resource://changes-review/')) return undefined
  let parts: string[]
  try {
    parts = new URL(address).pathname.split('/').filter(part => part.length > 0)
  } catch {
    return undefined
  }
  if (parts[0] !== 'session' || parts.length !== 4) return undefined
  const parsed = addressSchema.safeParse({ sessionId: parts[1], seq: parts[2], turn: parts[3] })
  return parsed.success ? { kind: 'turn', ...parsed.data } : undefined
}

/** The tab title one turn review shows before its summary arrives. */
const reviewTitle = (source: ReviewSource): string => (source.kind === 'turn' ? `Turn ${String(source.turn)}` : source.range)

/** One review's files, groups, keys and addresses, shared by the surface, the tab and the marks hook. */
export class ReviewModel {
  static readonly turnSummaryFrom = turnSummaryFrom
  static readonly turnFiles = turnFiles
  static readonly turnGroups = turnGroups
  static readonly workspaceFiles = workspaceFiles
  static readonly workspaceGroups = workspaceGroups
  static readonly reviewTotals = reviewTotals
  static readonly reviewKey = reviewKey
  static readonly commentSource = commentSource
  static readonly viewedPathsOf = viewedPathsOf
  static readonly viewedKeyOf = viewedKeyOf
  static readonly workspaceReviewedKeyOf = workspaceReviewedKeyOf
  static readonly changesReviewAddress = changesReviewAddress
  static readonly parseChangesReviewAddress = parseChangesReviewAddress
  static readonly reviewTitle = reviewTitle
}
