/**
 * The Host fold behind Chat's turn map and "Since you left" recap: the `dshfilesTurnMarks` session projection
 * (contract: `@dshfiles/chat/turn-marks`). It walks the whole log, so the facts cover Turns the transcript never paged
 * in, and it reads the same tool traffic as the turn footer: an accepted edit's file and line counts
 * ({@link EditLines.of}), a question tool call, a Turn that ended in an error.
 *
 * Cost: one small entry per Turn (files capped per Turn), and the `turns` array is replaced only at Turn boundaries
 * and when a question opens or is answered, so the change feed pushes a few times per Turn, like the native outline.
 */
import type { Context } from '@deepseek-ai/cordis'
import { TURN_MARKS_FILE_LIMIT, TURN_MARKS_PROJECTION_KEY, turnMarksViewSchema, type TurnMark, type TurnMarkFile } from '@dshfiles/chat/turn-marks'
import { zodSchemaFromEffect } from '@dshfiles/dshx/api'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { EditLines } from './edit-lines.js'

/** Turns kept; a thread past it drops its oldest marks (they read as plain prompts). */
export const TURN_MARKS_TURN_LIMIT = 4000

const EDIT_TOOLS: ReadonlySet<string> = new Set(['edit', 'write', 'apply_patch', 'str_replace_editor'])

/** The native timed question tool, and an MCP-namespaced copy of it. */
const isQuestionTool = (name: string): boolean => name === 'ask_user_question' || name.endsWith('__ask_user_question')

const countSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

const pendingEditSchema = Schema.Struct({ callId: Schema.String, path: Schema.String, added: countSchema, removed: countSchema })
type PendingEdit = typeof pendingEditSchema.Type

const openTurnSchema = Schema.Struct({
  turn: countSchema,
  /** Edit calls still waiting for their result. */
  pending: Schema.Array(pendingEditSchema),
  /** Edits the tool accepted, folded into the mark at `turn/end`. */
  accepted: Schema.Array(pendingEditSchema),
  /** Question calls without a result yet. */
  questions: Schema.Array(Schema.String),
})

const stateSchema = Schema.Struct({ turns: turnMarksViewSchema, open: Schema.NullOr(openTurnSchema) })
export type TurnMarksState = typeof stateSchema.Type

const initialState = (): TurnMarksState => ({ turns: [], open: null })

/**
 * The event fields the fold reads, each still unchecked: the registry runs this for every event of every live Session,
 * so it checks `type` first and narrows only the few fields it needs by hand (no schema decode on the hot path).
 */
interface EventFields {
  readonly type?: unknown
  readonly seq?: unknown
  readonly data?: unknown
}
interface DataFields {
  readonly turn?: unknown
  readonly callId?: unknown
  readonly name?: unknown
  readonly arguments?: unknown
  readonly message?: unknown
  readonly reason?: unknown
}
interface MessageFields {
  readonly toolCallId?: unknown
  readonly isError?: unknown
}
interface ReasonFields {
  readonly kind?: unknown
}
/** Any non-null object reads as one of the field interfaces above: every field is optional and still unchecked. */
const asFields = (value: unknown): object | undefined => (typeof value === 'object' && value !== null ? value : undefined)
const asCount = (value: unknown): number | undefined => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined)
const asText = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined)

/** Edit tools name their file `file_path` (native) or `path` (apply_patch and MCP copies). */
const decodeEditArguments = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ file_path: Schema.optional(Schema.String), path: Schema.optional(Schema.String) })),
)

const editPath = (argumentsText: string): string | undefined => {
  const decoded = decodeEditArguments(argumentsText)
  if (Option.isNone(decoded)) return undefined
  const path = decoded.value.file_path ?? decoded.value.path
  return path === undefined || path === '' ? undefined : path.slice(0, 1024)
}

/** Replace the newest mark (the open Turn's) with `next`, keeping every other entry's identity. */
const replaceLast = (turns: readonly TurnMark[], turn: number, update: (mark: TurnMark) => TurnMark): readonly TurnMark[] => {
  const last = turns.at(-1)
  if (last === undefined || last.turn !== turn) return turns
  const next = update(last)
  return next === last ? turns : [...turns.slice(0, -1), next]
}

/** Accepted edits per file, in first-write order, plus the totals across every file. */
const foldEdits = (edits: readonly PendingEdit[]): Pick<TurnMark, 'files' | 'fileCount' | 'added' | 'removed'> => {
  const byPath = new Map<string, { added: number; removed: number }>()
  let added = 0
  let removed = 0
  for (const edit of edits) {
    const previous = byPath.get(edit.path) ?? { added: 0, removed: 0 }
    byPath.set(edit.path, { added: previous.added + edit.added, removed: previous.removed + edit.removed })
    added += edit.added
    removed += edit.removed
  }
  const files: TurnMarkFile[] = [...byPath].slice(0, TURN_MARKS_FILE_LIMIT).map(([path, lines]) => ({ path, ...lines }))
  return { files, fileCount: byPath.size, added, removed }
}

/** One event folded into the marks. Pure: the same log always folds to the same state. */
const applyEvent = (state: TurnMarksState, event: EventFields): TurnMarksState => {
  const type = event.type
  if (type !== 'turn/start' && type !== 'tool/call' && type !== 'tool/result' && type !== 'turn/end') return state
  const data: DataFields | undefined = asFields(event.data)
  if (data === undefined) return state
  if (type === 'turn/start') {
    const turn = asCount(data.turn)
    const seq = asCount(event.seq)
    if (turn === undefined || seq === undefined) return state
    const last = state.turns.at(-1)
    if (last !== undefined && turn <= last.turn) return state
    const mark: TurnMark = { turn, seq, question: false, questionOpen: false, failed: false, files: [], fileCount: 0, added: 0, removed: 0 }
    const turns = [...state.turns, mark]
    return {
      turns: turns.length > TURN_MARKS_TURN_LIMIT ? turns.slice(-TURN_MARKS_TURN_LIMIT) : turns,
      open: { turn, pending: [], accepted: [], questions: [] },
    }
  }
  const open = state.open
  if (open === null) return state
  if (type === 'tool/call') {
    const callId = asText(data.callId)
    const name = asText(data.name)
    if (asCount(data.turn) !== open.turn || callId === undefined || name === undefined) return state
    if (isQuestionTool(name)) {
      return {
        turns: replaceLast(state.turns, open.turn, mark => (mark.question && mark.questionOpen ? mark : { ...mark, question: true, questionOpen: true })),
        open: { ...open, questions: [...open.questions, callId] },
      }
    }
    const argumentsText = asText(data.arguments)
    if (!EDIT_TOOLS.has(name) || argumentsText === undefined) return state
    const path = editPath(argumentsText)
    if (path === undefined) return state
    const lines = EditLines.of(name, argumentsText)
    return { ...state, open: { ...open, pending: [...open.pending, { callId, path, ...lines }] } }
  }
  if (type === 'tool/result') {
    const message: MessageFields | undefined = asFields(data.message)
    const toolCallId = asText(message?.toolCallId)
    if (toolCallId === undefined) return state
    if (open.questions.includes(toolCallId)) {
      const questions = open.questions.filter(id => id !== toolCallId)
      return {
        turns: questions.length > 0 ? state.turns : replaceLast(state.turns, open.turn, mark => ({ ...mark, questionOpen: false })),
        open: { ...open, questions },
      }
    }
    const edit = open.pending.find(candidate => candidate.callId === toolCallId)
    if (edit === undefined) return state
    const pending = open.pending.filter(candidate => candidate !== edit)
    return { ...state, open: { ...open, pending, accepted: message?.isError === true ? open.accepted : [...open.accepted, edit] } }
  }
  if (asCount(data.turn) !== open.turn) return state
  const reason: ReasonFields | undefined = asFields(data.reason)
  const failed = asText(reason?.kind) === 'error'
  const edits = foldEdits(open.accepted)
  const turns = replaceLast(state.turns, open.turn, mark =>
    !failed && edits.fileCount === 0 && !mark.questionOpen ? mark : { ...mark, ...edits, failed, questionOpen: false },
  )
  return { turns, open: null }
}

export class TurnMarksProjectionModel {
  static readonly initialState = initialState
  static readonly applyEvent = applyEvent
}

/** Bump with any change to the state shape or the fold, so stale checkpoints refold. */
const STATE_VERSION = 1

export const turnMarksProjectionDefinition = {
  key: TURN_MARKS_PROJECTION_KEY,
  stateVersion: STATE_VERSION,
  // `ctx.sessionProjections` still validates with Zod; the Effect schema crosses through dshx's adapter.
  stateSchema: zodSchemaFromEffect(stateSchema),
  init: initialState,
  apply: applyEvent,
  wire: {
    viewSchema: zodSchemaFromEffect(turnMarksViewSchema),
    // The view is the state's own array, so an open Turn's edits publish nothing until the Turn ends.
    view: (state: TurnMarksState): readonly TurnMark[] => state.turns,
  },
}

interface ProjectionRegistry {
  readonly register: (definition: typeof turnMarksProjectionDefinition) => () => void
}

const isProjectionRegistry = (value: unknown): value is ProjectionRegistry =>
  typeof value === 'object' && value !== null && 'register' in value && typeof value.register === 'function'

/** Registers only when the Host runs a projection registry; without it Chat's marks read as plain prompts. */
export const installTurnMarksProjection = (ctx: Context): void => {
  ctx.inject(['sessionProjections'], scoped => {
    const registry: unknown = scoped.get('sessionProjections')
    if (!isProjectionRegistry(registry)) return
    scoped.effect(() => registry.register(turnMarksProjectionDefinition), 'turn-summary turn marks projection')
  })
}
