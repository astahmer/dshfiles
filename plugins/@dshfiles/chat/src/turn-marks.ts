/**
 * What the turn map and the "Since you left" recap know about every Turn of a thread, including Turns the transcript
 * has not paged in: whether the agent asked a question, whether the Turn failed, which files it wrote.
 *
 * Published as the `@dshfiles/chat/turn-marks` dshx module. Chat owns the screen, so it declares the contract: the
 * `dshfilesTurnMarks` session projection key and its wire shape. `@dshfiles/turn-summary` (which depends on Chat)
 * registers the Host fold that serves it; without that plugin the projection is absent and every mark reads as a
 * plain prompt.
 */
import * as Schema from 'effect/Schema'

/** The session projection key the producer registers and Chat reads. */
export const TURN_MARKS_PROJECTION_KEY = 'dshfilesTurnMarks'

/** Files kept per Turn; the rest are counted in `fileCount` and the line totals. */
export const TURN_MARKS_FILE_LIMIT = 12

const count = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

export const turnMarkFileSchema = Schema.Struct({
  path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(1024)),
  added: count,
  removed: count,
})
export type TurnMarkFile = typeof turnMarkFileSchema.Type

/** One Turn's facts. `seq` is its `turn/start` sequence, the same anchor the native turn outline uses. */
export const turnMarkSchema = Schema.Struct({
  turn: count,
  seq: count,
  /** The agent called a question tool in this Turn. */
  question: Schema.Boolean,
  /** A question call has no result yet: the thread is waiting for the user. */
  questionOpen: Schema.Boolean,
  /** The Turn ended in an error. */
  failed: Schema.Boolean,
  /** Files written (edits the tool accepted), at most {@link TURN_MARKS_FILE_LIMIT}, in first-write order. */
  files: Schema.Array(turnMarkFileSchema),
  /** Every file written, including those past the limit. */
  fileCount: count,
  added: count,
  removed: count,
})
export type TurnMark = typeof turnMarkSchema.Type

export const turnMarksViewSchema = Schema.Array(turnMarkSchema)
export type TurnMarksView = typeof turnMarksViewSchema.Type

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Per-Turn question / failure / edit facts for Chat's turn map; see `@dshfiles/chat/turn-marks`. */
    dshfilesTurnMarks: TurnMarksView
  }
}

/** How a mark is drawn and filtered: the strongest fact wins (a failed Turn that also asked is a failure). */
export type TurnMarkKind = 'failed' | 'question' | 'edited' | 'prompt'

/** The turn map's filters. */
export type TurnMarkFilter = 'all' | 'questions' | 'errors' | 'edits'

export const TURN_MARK_FILTERS: readonly TurnMarkFilter[] = ['all', 'questions', 'errors', 'edits']

/** A wire file entry's fields, each still unchecked. */
interface FileFields {
  readonly path?: unknown
  readonly added?: unknown
  readonly removed?: unknown
}

/** A wire Turn entry's fields, each still unchecked. */
interface EntryFields {
  readonly turn?: unknown
  readonly seq?: unknown
  readonly question?: unknown
  readonly questionOpen?: unknown
  readonly failed?: unknown
  readonly files?: unknown
  readonly fileCount?: unknown
  readonly added?: unknown
  readonly removed?: unknown
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const isFlag = (value: unknown): value is boolean => typeof value === 'boolean'
/** Any non-null object reads as one of the field interfaces above: every field is optional and still unchecked. */
const isFields = (value: unknown): value is object => typeof value === 'object' && value !== null

const parseFile = (value: unknown): TurnMarkFile | undefined => {
  if (!isFields(value)) return undefined
  const { path, added, removed }: FileFields = value
  if (typeof path !== 'string' || path === '' || !isCount(added) || !isCount(removed)) return undefined
  return { path, added, removed }
}

/**
 * One wire entry, narrowed by hand: the map re-reads every Turn's entry when the projection changes, so a schema decode
 * per entry would sit on a long thread's open path. A malformed entry is dropped.
 */
const parseEntry = (value: unknown): TurnMark | undefined => {
  if (!isFields(value)) return undefined
  const { turn, seq, question, questionOpen, failed, fileCount, added, removed, files }: EntryFields = value
  if (!isCount(turn) || !isCount(seq) || !isCount(fileCount) || !isCount(added) || !isCount(removed) || !Array.isArray(files)) return undefined
  if (!isFlag(question) || !isFlag(questionOpen) || !isFlag(failed)) return undefined
  const narrowed: TurnMarkFile[] = []
  for (const file of files) {
    const next = parseFile(file)
    if (next !== undefined) narrowed.push(next)
  }
  return { turn, seq, question, questionOpen, failed, files: narrowed, fileCount, added, removed }
}

/** Narrow the projection's wire value, entry by entry: a malformed entry is dropped, never the whole map. */
const parseMarks = (value: unknown): ReadonlyMap<number, TurnMark> => {
  if (!Array.isArray(value) || value.length === 0) return EMPTY
  const marks = new Map<number, TurnMark>()
  for (const raw of value) {
    const entry = parseEntry(raw)
    if (entry !== undefined) marks.set(entry.turn, entry)
  }
  return marks
}

const EMPTY: ReadonlyMap<number, TurnMark> = new Map()

/** Pure rules shared by the rail, the Turns sheet and the recap. */
export class TurnMarksModel {
  static readonly key = TURN_MARKS_PROJECTION_KEY

  /** @returns marks by Turn number; empty when the projection is absent. */
  static readonly byTurn = parseMarks

  static readonly kindOf = (mark: TurnMark | undefined): TurnMarkKind => {
    if (mark === undefined) return 'prompt'
    if (mark.failed) return 'failed'
    if (mark.question) return 'question'
    if (mark.fileCount > 0) return 'edited'
    return 'prompt'
  }

  /** Whether a Turn of this kind shows under a filter; `all` keeps every Turn. */
  static readonly matches = (filter: TurnMarkFilter, kind: TurnMarkKind, mark?: TurnMark): boolean => {
    switch (filter) {
      case 'all':
        return true
      case 'questions':
        return kind === 'question' || mark?.question === true
      case 'errors':
        return kind === 'failed'
      case 'edits':
        return (mark?.fileCount ?? 0) > 0
    }
  }
}
