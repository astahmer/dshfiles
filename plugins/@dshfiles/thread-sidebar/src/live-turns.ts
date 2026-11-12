import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Option, Ref, Schema, Stream } from 'effect'
import { InflightTurns, type InflightTurn } from './inflight-turns.js'
import { SessionEvents, type SessionEvent } from './session-events.js'

/**
 * What a running turn is doing right now, for the thread list's live activity line (polish pass b:r4et): when the turn
 * started and its current step ("Running pnpm test", "Editing 3 files", "Thinking"). Folded on this Host from the
 * Session events it already observes, held in memory only (a turn does not survive the Host process), bounded and
 * dropped at `turn/end`. The client reads it in one call for every running thread; no per-thread subscription.
 */

export interface LiveTurn {
  readonly sessionId: string
  /** Host clock, epoch ms, of the turn's `turn/start`. */
  readonly startedAt: number
  /** The current step in words, or null before the first tool call of the turn. */
  readonly step: string | null
}

interface TurnState {
  readonly startedAt: number
  readonly step: string | null
  /** Files this turn edited, so a second edit reads "Editing 2 files". */
  readonly edited: readonly string[]
}

export type LiveTurnsState = ReadonlyMap<string, TurnState>

/** A Host with thousands of Sessions still holds a bounded map: the oldest turns drop first past this. */
const MAX_LIVE_TURNS = 500
const MAX_STEP_LENGTH = 60

const clip = (text: string): string => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > MAX_STEP_LENGTH ? `${line.slice(0, MAX_STEP_LENGTH - 1)}…` : line
}

const basename = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

/** `mcp__dsh__bash` and `bash` are the same tool to a reader. */
const toolName = (name: string): string => (name.split('__').at(-1) ?? name).toLowerCase()

/** The few argument fields the activity line reads; every other field of a tool's input is ignored. */
const callArgumentsSchema = Schema.Struct({
  command: Schema.optional(Schema.String),
  cmd: Schema.optional(Schema.String),
  file_path: Schema.optional(Schema.String),
  filePath: Schema.optional(Schema.String),
  path: Schema.optional(Schema.String),
})
type CallArguments = typeof callArgumentsSchema.Type
type ArgumentKey = keyof CallArguments

/** Tool arguments arrive as an object or as the model's JSON text; anything else reads as no arguments. */
const decodeCallArguments = Schema.decodeUnknownOption(Schema.Union([callArgumentsSchema, Schema.fromJsonString(callArgumentsSchema)]))

const toolCallSchema = Schema.Struct({ data: Schema.Struct({ name: Schema.String, arguments: Schema.optional(Schema.Unknown) }) })
const decodeToolCall = Schema.decodeUnknownOption(toolCallSchema)

const readArguments = (raw: unknown): CallArguments => {
  if (typeof raw === 'string' && (raw.length === 0 || raw.length > 200_000)) return {}
  return Option.getOrElse(decodeCallArguments(raw), () => ({}))
}

const stringField = (args: CallArguments, ...keys: readonly ArgumentKey[]): string | undefined => {
  for (const key of keys) {
    const value = args[key]
    if (value !== undefined && value.trim() !== '') return value
  }
  return undefined
}

const EDIT_TOOLS = new Set(['edit', 'write', 'apply_patch', 'editor_write', 'str_replace_editor', 'multiedit', 'notebookedit'])
const SHELL_TOOLS = new Set(['bash', 'shell', 'pwsh', 'powershell', 'terminal', 'exec', 'multi_host_exec'])

/** One tool call in words, and the turn's edited files after it. */
interface CallStep {
  readonly step: string
  readonly edited: readonly string[]
}

const FIXED_STEPS = new Map<string, string>([
  ['grep', 'Searching'],
  ['glob', 'Searching'],
  ['find_threads', 'Searching'],
  ['memory_search', 'Searching'],
  ['web_search', 'Searching the web'],
  ['web_fetch', 'Reading a web page'],
  ['subagent', 'Delegating to a subagent'],
  ['subagent_fork', 'Delegating to a subagent'],
  ['workflow', 'Delegating to a subagent'],
  ['ask_user_question', 'Asking you a question'],
  ['todo_write', 'Planning'],
])

const describeCall = (state: TurnState, name: string, args: CallArguments): CallStep => {
  const tool = toolName(name)
  const unchanged = (step: string): CallStep => ({ step, edited: state.edited })
  if (SHELL_TOOLS.has(tool)) {
    const command = stringField(args, 'command', 'cmd')
    return unchanged(command === undefined ? 'Running a command' : `Running ${clip(command.split('\n')[0] ?? command)}`)
  }
  if (EDIT_TOOLS.has(tool)) {
    const path = stringField(args, 'file_path', 'path', 'filePath')
    const edited = path === undefined || state.edited.includes(path) ? state.edited : [...state.edited, path].slice(-50)
    const step = edited.length > 1 ? `Editing ${String(edited.length)} files` : path === undefined ? 'Editing a file' : `Editing ${clip(basename(path))}`
    return { step, edited }
  }
  if (tool === 'read' || tool === 'read_image') {
    const path = stringField(args, 'file_path', 'path')
    return unchanged(path === undefined ? 'Reading a file' : `Reading ${clip(basename(path))}`)
  }
  return unchanged(FIXED_STEPS.get(tool) ?? `Using ${clip(tool.replaceAll('_', ' '))}`)
}

/** Fold one Session event into the live turns; every other event leaves the state as it is (same reference). */
const apply = (state: LiveTurnsState, input: SessionEvent): LiveTurnsState => {
  const { sessionId, event } = input
  switch (event.type) {
    case 'turn/start': {
      const next = new Map(state)
      next.delete(sessionId)
      next.set(sessionId, { startedAt: event.time, step: null, edited: [] })
      while (next.size > MAX_LIVE_TURNS) {
        const oldest = next.keys().next()
        if (oldest.done === true) break
        next.delete(oldest.value)
      }
      return next
    }
    case 'turn/end': {
      if (!state.has(sessionId)) return state
      const next = new Map(state)
      next.delete(sessionId)
      return next
    }
    case 'tool/call': {
      const turn = state.get(sessionId)
      const call = decodeToolCall(event)
      if (turn === undefined || Option.isNone(call)) return state
      const described = describeCall(turn, call.value.data.name, readArguments(call.value.data.arguments))
      if (described.step === turn.step && described.edited === turn.edited) return state
      return new Map(state).set(sessionId, { ...turn, ...described })
    }
    case 'tool/result': {
      // The model reads the result and decides what to do next: it is thinking until its next call.
      const turn = state.get(sessionId)
      if (turn === undefined || turn.step === 'Thinking') return state
      return new Map(state).set(sessionId, { ...turn, step: 'Thinking' })
    }
    default:
      return state
  }
}

/**
 * The folded turns, plus every turn the durable in-flight markers hold that the fold has not seen start: a plugin reload
 * or a Host restart empties the in-memory map, while the markers keep each open turn's start, so its clock stays right.
 */
const snapshot = (state: LiveTurnsState, inflight: readonly InflightTurn[] = []): readonly LiveTurn[] => [
  ...[...state.entries()].map(([sessionId, turn]) => ({ sessionId, startedAt: turn.startedAt, step: turn.step })),
  ...inflight.filter(turn => !state.has(turn.sessionId)).map(turn => ({ sessionId: turn.sessionId, startedAt: turn.startedAt, step: null })),
]

export class LiveTurnsModel {
  static readonly apply = apply
  static readonly snapshot = snapshot
  static readonly describeCall = describeCall
  static readonly readArguments = readArguments
}

export class LiveTurns extends Context.Service<LiveTurns, { readonly list: Effect.Effect<{ readonly turns: readonly LiveTurn[]; readonly now: number }> }>()(
  '@dshfiles/thread-sidebar/LiveTurns',
) {
  /** The fold runs as a worker on the shared Session event stream; `list` reads the latest map. */
  static readonly layer = Layer.effect(
    LiveTurns,
    Effect.gen(function* () {
      const state = yield* Ref.make<LiveTurnsState>(new Map())
      const inflight = yield* InflightTurns
      const events = yield* (yield* SessionEvents).subscribe
      yield* DshxPlugin.worker(Stream.runForEach(events, event => Ref.update(state, current => apply(current, event))))
      return LiveTurns.of({
        list: Effect.gen(function* () {
          const current = yield* Ref.get(state)
          // The markers are a fallback for the clock only; an unreadable file leaves the folded turns.
          const open = yield* inflight.list.pipe(Effect.orElseSucceed(() => []))
          return { turns: snapshot(current, open), now: Date.now() }
        }),
      })
    }),
  )
}
