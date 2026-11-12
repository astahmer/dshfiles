import { DshxPlugin } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Ref, Stream } from 'effect'
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

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => typeof value === 'object' && value !== null && !Array.isArray(value)

const clip = (text: string): string => {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > MAX_STEP_LENGTH ? `${line.slice(0, MAX_STEP_LENGTH - 1)}…` : line
}

const basename = (path: string): string => path.split(/[\\/]/).filter(Boolean).at(-1) ?? path

/** `mcp__dsh__bash` and `bash` are the same tool to a reader. */
const toolName = (name: string): string => (name.split('__').at(-1) ?? name).toLowerCase()

const parseArguments = (raw: unknown): Readonly<Record<string, unknown>> => {
  if (isRecord(raw)) return raw
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 200_000) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

const stringField = (args: Readonly<Record<string, unknown>>, ...keys: readonly string[]): string | undefined => {
  for (const key of keys) {
    const value = args[key]
    if (typeof value === 'string' && value.trim() !== '') return value
  }
  return undefined
}

const EDIT_TOOLS = new Set(['edit', 'write', 'apply_patch', 'editor_write', 'str_replace_editor', 'multiedit', 'notebookedit'])
const SHELL_TOOLS = new Set(['bash', 'shell', 'pwsh', 'powershell', 'terminal', 'exec', 'multi_host_exec'])

/** The words for one tool call, and the turn's edited files after it. */
const describeCall = (state: TurnState, name: string, rawArguments: unknown): { readonly step: string; readonly edited: readonly string[] } => {
  const tool = toolName(name)
  const args = parseArguments(rawArguments)
  if (SHELL_TOOLS.has(tool)) {
    const command = stringField(args, 'command', 'cmd')
    return { step: command === undefined ? 'Running a command' : `Running ${clip(command.split('\n')[0] ?? command)}`, edited: state.edited }
  }
  if (EDIT_TOOLS.has(tool)) {
    const path = stringField(args, 'file_path', 'path', 'filePath')
    const edited = path === undefined || state.edited.includes(path) ? state.edited : [...state.edited, path].slice(-50)
    if (edited.length > 1) return { step: `Editing ${String(edited.length)} files`, edited }
    return { step: path === undefined ? 'Editing a file' : `Editing ${clip(basename(path))}`, edited }
  }
  if (tool === 'read' || tool === 'read_image') {
    const path = stringField(args, 'file_path', 'path')
    return { step: path === undefined ? 'Reading a file' : `Reading ${clip(basename(path))}`, edited: state.edited }
  }
  if (tool === 'grep' || tool === 'glob' || tool === 'find_threads' || tool === 'memory_search') return { step: 'Searching', edited: state.edited }
  if (tool === 'web_search') return { step: 'Searching the web', edited: state.edited }
  if (tool === 'web_fetch') return { step: 'Reading a web page', edited: state.edited }
  if (tool === 'subagent' || tool === 'subagent_fork' || tool === 'workflow') return { step: 'Delegating to a subagent', edited: state.edited }
  if (tool === 'ask_user_question') return { step: 'Asking you a question', edited: state.edited }
  if (tool === 'todo_write') return { step: 'Planning', edited: state.edited }
  return { step: `Using ${clip(tool.replaceAll('_', ' '))}`, edited: state.edited }
}

/** Fold one Session event into the live turns; every other event leaves the state as it is (same reference). */
const apply = (state: LiveTurnsState, input: SessionEvent): LiveTurnsState => {
  const event: unknown = input.event
  if (!isRecord(event) || typeof event.type !== 'string') return state
  const { sessionId } = input
  switch (event.type) {
    case 'turn/start': {
      const next = new Map(state)
      next.delete(sessionId)
      next.set(sessionId, { startedAt: typeof event.time === 'number' ? event.time : Date.now(), step: null, edited: [] })
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
      const data = event.data
      if (turn === undefined || !isRecord(data) || typeof data.name !== 'string') return state
      const described = describeCall(turn, data.name, data.arguments)
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
