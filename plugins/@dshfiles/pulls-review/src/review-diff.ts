import { z } from 'zod'

/** A rendered diff line: its text and the numbers each side assigns it. */
export interface DiffLine {
  readonly kind: 'context' | 'add' | 'del'
  readonly oldNumber?: number
  readonly newNumber?: number
  readonly text: string
}

/** One hunk with its numbered lines, in patch order. */
export interface DiffHunk {
  readonly header: string
  readonly oldStart: number
  readonly oldLines: number
  readonly newStart: number
  readonly newLines: number
  readonly lines: readonly DiffLine[]
}

/** One file-wide claim about the comparison, independent of where its lines came from. */
export interface FileComparison {
  readonly kind: 'text' | 'binary' | 'oversized' | 'missing'
  readonly hunks: readonly DiffHunk[]
  /** The Host stopped comparing and marked every line as replaced. */
  readonly coarse: boolean
  readonly before: boolean
  readonly after: boolean
  readonly truncated: boolean
}

/** The native tab's own per-file rendering cap; a longer comparison is cut with a note. */
export const MAX_RENDERED_LINES = 5_000

export const EMPTY_COMPARISON: FileComparison = { kind: 'missing', hunks: [], coarse: false, before: true, after: true, truncated: false }

const turnHunkSchema = z.object({
  oldStart: z.number().int().nonnegative(),
  oldLines: z.number().int().nonnegative(),
  newStart: z.number().int().nonnegative(),
  newLines: z.number().int().nonnegative(),
  lines: z.array(z.string()).max(MAX_RENDERED_LINES * 4),
})

const turnDiffSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('text'),
    path: z.string(),
    display: z.string(),
    before: z.boolean(),
    after: z.boolean(),
    coarse: z.boolean(),
    hunks: z.array(turnHunkSchema),
  }),
  z.object({ kind: z.literal('binary'), path: z.string(), display: z.string() }),
  z.object({ kind: z.literal('oversized'), path: z.string(), display: z.string() }),
])

export type TurnDiffPayload = z.infer<typeof turnDiffSchema>

const header = (hunk: Pick<DiffHunk, 'oldStart' | 'oldLines' | 'newStart' | 'newLines'>): string =>
  `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`

/** Number one hunk's prefixed lines: context counts on both sides, deletions on the old side, additions on the new. */
const numberHunkLines = (hunk: {
  readonly oldStart: number
  readonly oldLines?: number
  readonly newStart: number
  readonly newLines?: number
  readonly lines: readonly string[]
}): DiffHunk => {
  let oldNumber = hunk.oldStart
  let newNumber = hunk.newStart
  const lines = hunk.lines.map((line): DiffLine => {
    const text = line.slice(1)
    switch (line[0]) {
      case '+':
        return { kind: 'add', newNumber: newNumber++, text }
      case '-':
        return { kind: 'del', oldNumber: oldNumber++, text }
      default:
        return { kind: 'context', oldNumber: oldNumber++, newNumber: newNumber++, text }
    }
  })
  return {
    header: '',
    oldStart: hunk.oldStart,
    oldLines: hunk.oldLines ?? hunk.lines.filter(line => !line.startsWith('+')).length,
    newStart: hunk.newStart,
    newLines: hunk.newLines ?? hunk.lines.filter(line => !line.startsWith('-')).length,
    lines,
  }
}

const withHeaders = (hunks: readonly DiffHunk[]): readonly DiffHunk[] =>
  hunks.map(hunk => ({ ...hunk, header: hunk.header === '' ? header(hunk) : hunk.header }))

/** Cut a comparison at the per-file line budget, keeping the first hunks whole where they fit. */
const renderedHunks = (hunks: readonly DiffHunk[], limit = MAX_RENDERED_LINES): { readonly hunks: readonly DiffHunk[]; readonly truncated: boolean } => {
  let budget = limit
  let truncated = false
  const kept: DiffHunk[] = []
  for (const hunk of hunks) {
    if (budget <= 0) return { hunks: kept, truncated: true }
    if (hunk.lines.length > budget) {
      kept.push({ ...hunk, lines: hunk.lines.slice(0, budget) })
      truncated = true
    } else kept.push(hunk)
    budget -= Math.min(budget, hunk.lines.length)
  }
  return { hunks: kept, truncated }
}

/** One file's comparison as the turn snapshot serves it. */
const comparisonFromTurnDiff = (value: unknown): FileComparison => {
  const parsed = turnDiffSchema.safeParse(value)
  if (!parsed.success) return EMPTY_COMPARISON
  const diff = parsed.data
  if (diff.kind !== 'text') return { ...EMPTY_COMPARISON, kind: diff.kind }
  const numbered = renderedHunks(withHeaders(diff.hunks.map(hunk => numberHunkLines(hunk))))
  return { kind: 'text', hunks: numbered.hunks, coarse: diff.coarse, before: diff.before, after: diff.after, truncated: numbered.truncated }
}

const FILE_BREAK = /^diff --git /m

/** Split one `jj diff --git` / `git diff` into the hunks that belong to each file, in patch order. */
const splitPatchByFile = (patch: string): ReadonlyMap<string, string> => {
  const sections = new Map<string, string>()
  if (patch.trim().length === 0) return sections
  const starts: number[] = []
  for (const match of patch.matchAll(/^diff --git .*$/gm)) {
    if (match.index === undefined) continue
    starts.push(match.index)
  }
  if (starts.length === 0) return sections
  for (let index = 0; index < starts.length; index += 1) {
    const start = starts[index] ?? 0
    const end = starts[index + 1] ?? patch.length
    const section = patch.slice(start, end)
    const path = pathOfSection(section)
    if (path !== undefined) sections.set(path, section)
  }
  return sections
}

const pathOfSection = (section: string): string | undefined => {
  const plus = /^\+\+\+ b\/(.*)$/m.exec(section)
  if (plus?.[1] !== undefined) return plus[1]
  const renamed = /^rename to (.*)$/m.exec(section)
  if (renamed?.[1] !== undefined) return renamed[1]
  const minus = /^--- a\/(.*)$/m.exec(section)
  return minus?.[1]
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** Parse the hunks of one file's git patch section into numbered lines. */
const comparisonFromPatch = (section: string): FileComparison => {
  if (FILE_BREAK.test(section) === false && /^@@ /m.test(section) === false) {
    const binary = /^Binary files .* differ$/m.test(section) || /^GIT binary patch$/m.test(section)
    return { ...EMPTY_COMPARISON, kind: binary ? 'binary' : 'text' }
  }
  const raw: { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }[] = []
  let current: { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] } | undefined
  for (const line of section.split('\n')) {
    const match = HUNK_HEADER.exec(line)
    if (match !== null) {
      current = {
        oldStart: Number(match[1] ?? 0),
        oldLines: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3] ?? 0),
        newLines: match[4] === undefined ? 1 : Number(match[4]),
        lines: [],
      }
      raw.push(current)
      continue
    }
    if (current === undefined) continue
    if (line.startsWith('\\')) continue
    if (line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) current.lines.push(line)
  }
  const numbered = renderedHunks(withHeaders(raw.map(hunk => numberHunkLines(hunk))))
  return { kind: 'text', hunks: numbered.hunks, coarse: false, before: true, after: true, truncated: numbered.truncated }
}

/** One paired row of the side-by-side view: a deletion aligned with the addition that replaced it. */
export interface SplitRow {
  readonly left?: DiffLine
  readonly right?: DiffLine
}

/** Pair each run of deletions with the additions that follow it, row by row. */
const splitHunkLines = (lines: readonly DiffLine[]): readonly SplitRow[] => {
  const rows: SplitRow[] = []
  let deletions: DiffLine[] = []
  let additions: DiffLine[] = []
  const flush = (): void => {
    for (let at = 0; at < Math.max(deletions.length, additions.length); at += 1) {
      const left = deletions[at]
      const right = additions[at]
      rows.push({ ...(left === undefined ? {} : { left }), ...(right === undefined ? {} : { right }) })
    }
    deletions = []
    additions = []
  }
  for (const line of lines) {
    if (line.kind === 'del') deletions.push(line)
    else if (line.kind === 'add') additions.push(line)
    else {
      flush()
      rows.push({ left: { ...line, kind: 'context' }, right: { ...line, kind: 'context' } })
    }
  }
  flush()
  return rows
}

/** The one fact worth stating above a comparison's hunks, if any. */
const comparisonNote = (comparison: FileComparison): 'created' | 'deleted' | 'unchanged' | undefined => {
  if (!comparison.before) return 'created'
  if (!comparison.after) return 'deleted'
  if (comparison.hunks.length === 0) return 'unchanged'
  return undefined
}

/** Reading a turn snapshot or a git patch into the numbered comparison the review draws. */
export class ReviewDiffModel {
  static readonly numberHunkLines = numberHunkLines
  static readonly renderedHunks = renderedHunks
  static readonly comparisonFromTurnDiff = comparisonFromTurnDiff
  static readonly splitPatchByFile = splitPatchByFile
  static readonly comparisonFromPatch = comparisonFromPatch
  static readonly splitHunkLines = splitHunkLines
  static readonly comparisonNote = comparisonNote
}
