import { TOOL_ACCESS_ALL, toolAccessSchema } from '@dshfiles/tool-search/access'
import { Effect, Schema } from 'effect'

export const AGENT_HANDLE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u
export const DEFAULT_AGENT_HANDLE = 'dsh'
export const MAX_AGENTS = 100
const MAX_HANDLE_CHARS = 32
const MAX_NAME_CHARS = 60
const MAX_GLYPH_CHARS = 8
const MAX_DESCRIPTION_CHARS = 200
const MAX_INSTRUCTIONS_CHARS = 8_000
const MAX_PRESET_CHARS = 64
const MAX_PROVIDER_CHARS = 128
const MAX_MODEL_CHARS = 256
const MAX_EFFORT_CHARS = 64
export const MAX_SESSION_CHARS = 256
const MAX_MEMORY_SCOPE_CHARS = 80
const MAX_ROUTINE_CHARS = 400
const MAX_PEER_HANDLES = 50
/** The kit's identity palette has six slots (`IDENTITY_SLOT_COUNT`, the project tones); the theme decides their colours. */
export const AGENT_TONE_SLOTS = 6
/** Newest threads kept per agent; an older row is pruned so one agent cannot grow the table without bound. */
export const MAX_THREADS_PER_AGENT = 50
/** Matches the backlog start-thread limit, so a dispatch prompt travels the same path as a typed one. */
export const MAX_MESSAGE_CHARS = 4_000
/** `agent:` and `a:` scope the shared `@` menu to agents; the other sources stay empty for them. */
export const AGENT_MENTION_SCOPES: readonly string[] = ['agent', 'a']
/** The panel and the mention preview read one Host snapshot, so they share a query key. */
export const AGENTS_QUERY_ROOT = 'dshfiles-agents'

const handleSchema = Schema.String.check(Schema.isPattern(AGENT_HANDLE_PATTERN))
const timestampSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
/** A memory note scope an agent owns; the notes table already stores free-form scopes, so no new table. */
const agentMemoryScopeSchema = Schema.NullOr(
  Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_MEMORY_SCOPE_CHARS), Schema.isPattern(/^[A-Za-z0-9][A-Za-z0-9:._/-]*$/u)),
).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null)))

/** One identity palette slot, 0–5: the active theme paints it, so switching theme recolours the agent. */
const toneSchema = Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(AGENT_TONE_SLOTS - 1))

export const agentRouteSchema = Schema.Struct({
  provider: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_PROVIDER_CHARS)),
  model: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_MODEL_CHARS)),
  reasoningEffort: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_EFFORT_CHARS))),
})

/**
 * Which peers an agent's threads may message. `any` is the default (no rule), `listed` allows only `handles`, and
 * `none` keeps the agent's threads out of DSH's messaging tools. It constrains `dshx_comm_*`, it does not replace it.
 */
/** An agent with no rule messages anyone, broadcasts and delegates, so adding the rule changed no behavior. */
export const AGENT_DELEGATION_UNRESTRICTED = { messaging: 'any' as const, handles: [] as string[], subagents: true }

export const agentDelegationSchema = Schema.Struct({
  messaging: Schema.Literals(['any', 'listed', 'none']),
  handles: Schema.Array(handleSchema).check(Schema.isMaxLength(MAX_PEER_HANDLES)),
  /** Whether this agent's threads may create subagents or fan work out through the workflow tool. */
  subagents: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(true))),
}).pipe(Schema.withDecodingDefaultKey(Effect.sync(() => ({ ...AGENT_DELEGATION_UNRESTRICTED }))))

/**
 * Which agents this agent's subagents may run as (wave 2 wires the `subagent` tool's `agent` argument to it): `any`
 * or a list of handles, and the agent a subagent runs as when none is named (null: the parent thread's own agent).
 */
export const AGENT_SUBAGENTS_UNRESTRICTED = { allowed: 'any' as const, default: null }

export const agentSubagentsSchema = Schema.Struct({
  allowed: Schema.Union([Schema.Literal('any'), Schema.Array(handleSchema).check(Schema.isMaxLength(MAX_PEER_HANDLES))]),
  default: Schema.NullOr(handleSchema),
}).pipe(Schema.withDecodingDefaultKey(Effect.sync(() => ({ ...AGENT_SUBAGENTS_UNRESTRICTED }))))

/**
 * The tools this agent's threads get: sparse enabled/pinned entries per tool and per tool group, the
 * `@dshfiles/tool-search/access` contract. Empty (the default) means every tool on, none pinned.
 */
export const agentToolsSchema = toolAccessSchema.pipe(Schema.withDecodingDefaultKey(Effect.sync(() => ({ tools: {}, groups: {} }))))

/** Everything a person or an agent decides about an agent; the rest is usage metadata. */
const agentDraftFields = {
  handle: handleSchema,
  name: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_NAME_CHARS)),
  glyph: Schema.Trim.check(Schema.isMaxLength(MAX_GLYPH_CHARS)),
  description: Schema.Trim.check(Schema.isMaxLength(MAX_DESCRIPTION_CHARS)),
  instructions: Schema.String.check(Schema.isMaxLength(MAX_INSTRUCTIONS_CHARS)),
  preset: Schema.NullOr(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_PRESET_CHARS))),
  route: Schema.NullOr(agentRouteSchema),
  /** The memory note scope this agent's threads read, or null for the project block only. */
  memoryScope: agentMemoryScopeSchema,
  /** A routine line the opening message asks the thread to keep with DSH's own schedule tools; empty means none. */
  routine: Schema.String.check(Schema.isMaxLength(MAX_ROUTINE_CHARS)).pipe(Schema.withDecodingDefaultKey(Effect.succeed(''))),
  delegation: agentDelegationSchema,
  tools: agentToolsSchema,
  subagents: agentSubagentsSchema,
  enabled: Schema.Boolean,
}

/**
 * A draft names the colour three ways: a slot sets it, `null` returns to the default (hashed from the handle), and no
 * key keeps the stored one, so an agent tool that edits only the instructions leaves the colour alone.
 */
export const agentDraftSchema = Schema.Struct({ ...agentDraftFields, tone: Schema.optional(Schema.NullOr(toneSchema)) })

export const agentSchema = Schema.Struct({
  ...agentDraftFields,
  /** The colour slot the person chose; absent (every row stored before colours) means the handle's hashed default. */
  tone: Schema.optional(toneSchema),
  builtIn: Schema.Boolean,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  lastUsedAt: Schema.NullOr(timestampSchema),
  threadCount: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
})

/**
 * One thread an agent started. It is a real row, not a counter: the panel lists the threads, opens one, and a Host
 * restart keeps the history because it reads the same table the dispatch wrote.
 */
export const agentThreadSchema = Schema.Struct({
  sessionId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(MAX_SESSION_CHARS)),
  handle: handleSchema,
  title: Schema.String.check(Schema.isMaxLength(200)),
  startedAt: timestampSchema,
})

export type AgentThread = typeof agentThreadSchema.Type

export type AgentRoute = typeof agentRouteSchema.Type
export type AgentDelegation = typeof agentDelegationSchema.Type
export type AgentSubagents = typeof agentSubagentsSchema.Type
export type AgentTools = typeof agentToolsSchema.Type
export type AgentDraft = typeof agentDraftSchema.Type
export type Agent = typeof agentSchema.Type

/** The fields an opening message needs; a full {@link Agent} satisfies it, so callers without usage metadata reuse the rules. */
export interface AgentIdentity {
  readonly handle: string
  readonly name: string
  readonly description: string
  readonly instructions: string
  /** A standing routine; when present the thread is told to keep it with its own `schedule_*` tools. */
  readonly routine?: string | undefined
}

export interface AgentMention {
  readonly handle: string
  /** The text after the mention, trimmed; empty when the mention is the whole message. */
  readonly text: string
}

/** A leading `@handle`, so only an addressed message dispatches; a mention mid-sentence stays a mention. */
const LEADING_MENTION = /^\s*@([a-z][a-z0-9-]{0,31})(?=\s|$)/u

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`)

const slug = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, MAX_HANDLE_CHARS)

/** Pure rules behind the agent registry: handles, mentions, opening messages and ordering. */
export class Agents {
  /** A name as a mentionable handle, or `agent` when nothing usable is left. */
  static handleFrom(name: string): string {
    const candidate = slug(name)
    return AGENT_HANDLE_PATTERN.test(candidate) ? candidate : 'agent'
  }

  /** The mention at the start of a message, if any. */
  static parseMention(text: string): AgentMention | null {
    const match = LEADING_MENTION.exec(text)
    if (match === null) return null
    const handle = match[1]
    if (handle === undefined) return null
    return { handle, text: text.slice(match[0].length).trim() }
  }

  /** The `@handle` a message addresses, for the `@` menu to mark a row as already used. */
  static mentionedHandle(text: string): string | null {
    return Agents.parseMention(text)?.handle ?? null
  }

  static isScopedToAgents(query: string): boolean {
    const scope = /^([a-z]+):/iu.exec(query)?.[1]?.toLowerCase()
    return scope !== undefined && AGENT_MENTION_SCOPES.includes(scope)
  }

  static builtIn(now: number): Agent {
    return {
      handle: DEFAULT_AGENT_HANDLE,
      name: 'DSH',
      glyph: '🛠',
      description: 'The harness itself: default model, default tools.',
      instructions: '',
      preset: null,
      route: null,
      memoryScope: null,
      routine: '',
      delegation: { ...AGENT_DELEGATION_UNRESTRICTED },
      tools: { ...TOOL_ACCESS_ALL },
      subagents: { ...AGENT_SUBAGENTS_UNRESTRICTED },
      enabled: true,
      builtIn: true,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
      threadCount: 0,
    }
  }

  /** Whether an agent's threads may message one peer; a thread no agent started has no rule to break. */
  static mayMessage(delegation: AgentDelegation, targetHandle: string | null): boolean {
    if (delegation.messaging === 'any') return true
    if (delegation.messaging === 'none') return false
    return targetHandle !== null && delegation.handles.includes(targetHandle)
  }

  /** Whether an agent's threads may broadcast to a topic: a topic has no single peer, so `listed` cannot narrow it. */
  static mayBroadcast(delegation: AgentDelegation): boolean {
    return delegation.messaging !== 'none'
  }

  /** Whether an agent's threads may create subagents or start a workflow; the native tools take no target to narrow. */
  static maySpawnSubagents(delegation: AgentDelegation): boolean {
    return delegation.subagents
  }

  /** The scope an agent's threads would use if the person leaves the field empty; never stored on its own. */
  static defaultMemoryScope(handle: string): string {
    return `agent:${handle}`
  }

  /** Newest edit last is what the panel wants; the built-in agent always leads the list. */
  static order(agents: Iterable<Agent>): Agent[] {
    return [...agents].sort((left, right) => {
      if (left.builtIn !== right.builtIn) return left.builtIn ? -1 : 1
      return left.name.localeCompare(right.name) || left.handle.localeCompare(right.handle)
    })
  }

  /**
   * What a dispatch prompt says: identity, instructions, then the task. The task is never truncated in favour of the
   * instructions, so a long preamble cannot push the request out of the message.
   */
  static openingMessage(input: { readonly agent: AgentIdentity; readonly text: string; readonly fallback: string }): string {
    const task = input.text.trim() === '' ? input.fallback : input.text.trim()
    const { header, preamble, separator } = Agents.openingParts(input.agent)
    if (preamble === '') return clip(`${header}${separator}${task}`, MAX_MESSAGE_CHARS)
    const room = MAX_MESSAGE_CHARS - header.length - '\n\n'.length - separator.length - task.length
    if (room <= 0) return clip(`${header}${separator}${task}`, MAX_MESSAGE_CHARS)
    return `${header}\n\n${clip(preamble, room)}${separator}${task}`
  }

  /**
   * A message the person typed, opened the way a dispatch opens: identity, instructions, then their text exactly as
   * written. Nothing of the text is clipped or trimmed (the composer has no dispatch length limit); only the preamble
   * keeps its own bound.
   */
  static introducedMessage(input: { readonly agent: AgentIdentity; readonly text: string }): string {
    const { header, preamble, separator } = Agents.openingParts(input.agent)
    const intro = preamble === '' ? header : `${header}\n\n${clip(preamble, MAX_MESSAGE_CHARS)}`
    return `${intro}${separator}${input.text}`
  }

  /** The identity line, the instructions-and-routine preamble and the separator before the task. */
  private static openingParts(agent: AgentIdentity) {
    const header = [`Work as @${agent.handle} — ${agent.name}.`, agent.description].filter(line => line.trim() !== '').join('\n')
    const instructions = agent.instructions.trim()
    const routine = Agents.routineSection(agent.routine ?? '')
    const preamble = [instructions, routine].filter(section => section !== '').join('\n\n')
    return { header, preamble, separator: '\n\n---\n\n' }
  }

  /**
   * A routine is a standing instruction, not a scheduler: the thread keeps it with the `schedule_*` tools it already
   * has, so the reminder lives in DSH's session-scoped schedule store and dies with that Session.
   */
  static routineSection(routine: string): string {
    const text = routine.trim()
    if (text === '') return ''
    return `Routine: ${clip(text, MAX_ROUTINE_CHARS)}\nKeep it with this thread's own schedule tools (schedule_create, then schedule_update or schedule_delete); do not build a timer.`
  }

  /** The thread title a dispatch opens with, clipped to the Session title limit. */
  static title(text: string): string {
    const first = text.trim().split('\n', 1)[0]?.trim() ?? ''
    return clip(first === '' ? 'New thread' : first, 200)
  }

  /** A draft from form fields, with the handle kept as typed but normalized when it is a fresh agent. */
  static normalizeDraft(draft: AgentDraft, options: { readonly creating: boolean }): AgentDraft {
    const handle = options.creating ? Agents.handleFrom(draft.handle === '' ? draft.name : draft.handle) : draft.handle
    const memoryScope = draft.memoryScope === null || draft.memoryScope.trim() === '' ? null : draft.memoryScope.trim()
    return { ...draft, handle, memoryScope, instructions: draft.instructions.trimEnd() }
  }
}

export const agentLimits = {
  agents: MAX_AGENTS,
  name: MAX_NAME_CHARS,
  description: MAX_DESCRIPTION_CHARS,
  instructions: MAX_INSTRUCTIONS_CHARS,
  routine: MAX_ROUTINE_CHARS,
  message: MAX_MESSAGE_CHARS,
} as const
