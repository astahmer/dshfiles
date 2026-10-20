import { z } from 'zod'

export const AGENT_HANDLE_PATTERN = /^[a-z][a-z0-9-]{0,31}$/u
export const DEFAULT_AGENT_HANDLE = 'dsh'
export const MAX_AGENTS = 100
export const MAX_HANDLE_CHARS = 32
export const MAX_NAME_CHARS = 60
export const MAX_GLYPH_CHARS = 8
export const MAX_DESCRIPTION_CHARS = 200
export const MAX_INSTRUCTIONS_CHARS = 8_000
export const MAX_PRESET_CHARS = 64
export const MAX_PROVIDER_CHARS = 128
export const MAX_MODEL_CHARS = 256
export const MAX_EFFORT_CHARS = 64
/** Matches the backlog start-thread limit, so a dispatch prompt travels the same path as a typed one. */
export const MAX_MESSAGE_CHARS = 4_000
/** `agent:` and `a:` scope the shared `@` menu to agents; the other sources stay empty for them. */
export const AGENT_MENTION_SCOPES: readonly string[] = ['agent', 'a']

const handleSchema = z.string().regex(AGENT_HANDLE_PATTERN)
const timestampSchema = z.number().int().nonnegative()

export const agentRouteSchema = z
  .object({
    provider: z.string().min(1).max(MAX_PROVIDER_CHARS),
    model: z.string().min(1).max(MAX_MODEL_CHARS),
    reasoningEffort: z.string().min(1).max(MAX_EFFORT_CHARS).optional(),
  })
  .strict()

/** Everything a person or an agent decides about an agent; the rest is usage metadata. */
export const agentDraftSchema = z
  .object({
    handle: handleSchema,
    name: z.string().trim().min(1).max(MAX_NAME_CHARS),
    glyph: z.string().trim().max(MAX_GLYPH_CHARS),
    description: z.string().trim().max(MAX_DESCRIPTION_CHARS),
    instructions: z.string().max(MAX_INSTRUCTIONS_CHARS),
    preset: z.string().min(1).max(MAX_PRESET_CHARS).nullable(),
    route: agentRouteSchema.nullable(),
    enabled: z.boolean(),
  })
  .strict()

export const agentSchema = agentDraftSchema
  .extend({
    builtIn: z.boolean(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    lastUsedAt: timestampSchema.nullable(),
    threadCount: z.number().int().nonnegative(),
  })
  .strict()

export type AgentRoute = z.infer<typeof agentRouteSchema>
export type AgentDraft = z.infer<typeof agentDraftSchema>
export type Agent = z.infer<typeof agentSchema>

/** The fields an opening message needs; a full {@link Agent} satisfies it, so callers without usage metadata reuse the rules. */
export interface AgentIdentity {
  readonly handle: string
  readonly name: string
  readonly description: string
  readonly instructions: string
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
      enabled: true,
      builtIn: true,
      createdAt: now,
      updatedAt: now,
      lastUsedAt: null,
      threadCount: 0,
    }
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
    const header = [`Work as @${input.agent.handle} — ${input.agent.name}.`, input.agent.description].filter(line => line.trim() !== '').join('\n')
    const instructions = input.agent.instructions.trim()
    const separator = '\n\n---\n\n'
    if (instructions === '') return clip(`${header}${separator}${task}`, MAX_MESSAGE_CHARS)
    const room = MAX_MESSAGE_CHARS - header.length - '\n\n'.length - separator.length - task.length
    if (room <= 0) return clip(`${header}${separator}${task}`, MAX_MESSAGE_CHARS)
    return `${header}\n\n${clip(instructions, room)}${separator}${task}`
  }

  /** The thread title a dispatch opens with, clipped to the Session title limit. */
  static title(text: string): string {
    const first = text.trim().split('\n', 1)[0]?.trim() ?? ''
    return clip(first === '' ? 'New thread' : first, 200)
  }

  /** A draft from form fields, with the handle kept as typed but normalized when it is a fresh agent. */
  static normalizeDraft(draft: AgentDraft, options: { readonly creating: boolean }): AgentDraft {
    const handle = options.creating ? Agents.handleFrom(draft.handle === '' ? draft.name : draft.handle) : draft.handle
    return { ...draft, handle, instructions: draft.instructions.trimEnd() }
  }
}

export const agentLimits = {
  agents: MAX_AGENTS,
  name: MAX_NAME_CHARS,
  description: MAX_DESCRIPTION_CHARS,
  instructions: MAX_INSTRUCTIONS_CHARS,
  message: MAX_MESSAGE_CHARS,
} as const
