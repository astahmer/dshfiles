import { Option, Schema } from 'effect'

/**
 * One turn's changes come from the Host's own turn-start/turn-end snapshot, read through the same document-relative
 * routes the native "Edited N files" card and review tab read. They work for any version control, or none.
 */
const changedFileSchema = Schema.Struct({
  path: Schema.String.check(Schema.isMinLength(1)),
  display: Schema.String.check(Schema.isMinLength(1)),
  added: Schema.Number,
  deleted: Schema.Number,
  binary: Schema.optional(Schema.Literal(true)),
  oversized: Schema.optional(Schema.Literal(true)),
})
export type TurnChangedFile = typeof changedFileSchema.Type

const summarySchema = Schema.Struct({
  turn: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  files: Schema.Array(changedFileSchema),
  total: Schema.Number,
  added: Schema.Number,
  deleted: Schema.Number,
})
export type TurnSummary = typeof summarySchema.Type

const hunkSchema = Schema.Struct({
  oldStart: Schema.Number,
  oldLines: Schema.Number,
  newStart: Schema.Number,
  newLines: Schema.Number,
  lines: Schema.Array(Schema.String),
})

const fileDiffSchema = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('text'),
    path: Schema.String,
    display: Schema.String,
    before: Schema.Boolean,
    after: Schema.Boolean,
    coarse: Schema.Boolean,
    hunks: Schema.Array(hunkSchema),
  }),
  Schema.Struct({ kind: Schema.Literals(['binary', 'oversized']), path: Schema.String, display: Schema.String }),
])
export type TurnFileDiff = typeof fileDiffSchema.Type

const changesEventDataSchema = Schema.Struct({ turn: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)) })

/** A `workspace/changes` event: the turn it summarized and the sequence that addresses its summary. */
export interface TurnChangesEvent {
  readonly seq: number
  readonly turn: number
}

interface EventLikeEntry {
  readonly type: string
  readonly event?: { readonly type: string; readonly seq: number; readonly data?: unknown } | undefined
}

/** Every turn of a thread that changed files, oldest first. */
const turnEvents = (entries: readonly EventLikeEntry[]): readonly TurnChangesEvent[] => {
  const events: TurnChangesEvent[] = []
  for (const entry of entries) {
    if (entry.type !== 'event' || entry.event === undefined || entry.event.type !== 'workspace/changes') continue
    const data = Schema.decodeUnknownOption(changesEventDataSchema)(entry.event.data)
    if (Option.isSome(data)) events.push({ seq: entry.event.seq, turn: data.value.turn })
  }
  return events
}

const summaryUrl = (sessionId: string, seq: number): string => `api/changes.summary?${new URLSearchParams({ sessionId, seq: String(seq) })}`

const diffUrl = (sessionId: string, seq: number, index: number): string =>
  `api/changes.diff?${new URLSearchParams({ sessionId, seq: String(seq), index: String(index) })}`

const decodeSummary = (value: unknown): TurnSummary | undefined => Option.getOrUndefined(Schema.decodeUnknownOption(summarySchema)(value))

const decodeDiff = (value: unknown): TurnFileDiff | undefined => Option.getOrUndefined(Schema.decodeUnknownOption(fileDiffSchema)(value))

/** One file's turn comparison as a git patch, so the facet renders every scope with the same diff view. */
const patchOf = (diff: TurnFileDiff): string => {
  if (diff.kind !== 'text') return ''
  const header = [
    `diff --git a/${diff.path} b/${diff.path}`,
    ...(diff.before ? [] : ['new file mode 100644']),
    ...(diff.after ? [] : ['deleted file mode 100644']),
    `--- ${diff.before ? `a/${diff.path}` : '/dev/null'}`,
    `+++ ${diff.after ? `b/${diff.path}` : '/dev/null'}`,
  ]
  const hunks = diff.hunks.flatMap(hunk => [
    `@@ -${String(hunk.oldStart)},${String(hunk.oldLines)} +${String(hunk.newStart)},${String(hunk.newLines)} @@`,
    ...hunk.lines,
  ])
  return `${[...header, ...hunks].join('\n')}\n`
}

export class TurnChangesModel {
  static readonly events = turnEvents
  static readonly summaryUrl = summaryUrl
  static readonly diffUrl = diffUrl
  static readonly decodeSummary = decodeSummary
  static readonly decodeDiff = decodeDiff
  static readonly patchOf = patchOf
}
