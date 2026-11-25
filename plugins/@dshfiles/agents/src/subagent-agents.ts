import { MAX_SUBAGENT_AGENT_PREAMBLE_CHARS, type SubagentAgentListing, type SubagentAgentOption } from '@dshfiles/tool-subagent/agent-resolver'
import type { Agent } from './agent.js'

/** What a `subagent` call starts as, before the Host attaches a recorder: the agent, upstream inheritance, or a refusal. */
export type SubagentAgentDecision =
  | { readonly kind: 'inherit' }
  | { readonly kind: 'agent'; readonly agent: Agent }
  | { readonly kind: 'refused'; readonly message: string }

interface SubagentAgentsInput {
  readonly agents: ReadonlyMap<string, Agent>
  /** The calling thread's agent. */
  readonly parent: string
}

const mention = (handles: readonly string[]): string => (handles.length === 0 ? '(none)' : handles.map(handle => `@${handle}`).join(', '))

const changeHint = (parent: string): string =>
  `To change which agents @${parent}'s subagents may run as, edit @${parent}'s Subagents in the Agents panel or call agents_subagents_set.`

/** Whether the calling agent may start `handle`: its own agent always; others when its rule is `any` or lists them. */
const permits = (parentAgent: Agent | undefined, parent: string, handle: string): boolean => {
  if (handle === parent) return true
  const allowed = parentAgent?.subagents.allowed ?? 'any'
  return allowed === 'any' || allowed.includes(handle)
}

/** Enabled agents the calling agent may start, its own first. */
const allowed = (input: SubagentAgentsInput): Agent[] => {
  const parentAgent = input.agents.get(input.parent)
  return [...input.agents.values()]
    .filter(agent => agent.enabled && permits(parentAgent, input.parent, agent.handle))
    .sort((left, right) => (left.handle === input.parent ? -1 : right.handle === input.parent ? 1 : left.handle.localeCompare(right.handle)))
}

/**
 * The agent a fresh subagent starts as: the `agent` argument, else the calling agent's `subagents.default`, else
 * upstream inheritance (the child takes its parent thread's agent). An unknown, disabled or unlisted handle is refused
 * with the handles involved and how to change the rule.
 */
const decide = (input: SubagentAgentsInput & { readonly handle: string | undefined }): SubagentAgentDecision => {
  const parentAgent = input.agents.get(input.parent)
  const fromDefault = input.handle === undefined
  const requested = input.handle ?? parentAgent?.subagents.default ?? undefined
  if (requested === undefined) return { kind: 'inherit' }
  const valid = allowed(input).map(agent => agent.handle)
  const source = fromDefault ? `@${input.parent}'s default subagent agent @${requested}` : `@${requested}`
  const target = input.agents.get(requested)
  if (target === undefined)
    return {
      kind: 'refused',
      message: `${source} does not exist. Agents @${input.parent} may start: ${mention(valid)}. ${fromDefault ? `Pass \`agent\`, or change the default: ${changeHint(input.parent)}` : 'Pass one of them, or omit `agent`.'}`,
    }
  if (!target.enabled)
    return {
      kind: 'refused',
      message: `${source} is disabled. Enable it in the Agents panel, or pick another: ${mention(valid)}.`,
    }
  if (!permits(parentAgent, input.parent, requested))
    return {
      kind: 'refused',
      message: `@${input.parent}'s subagents may not run as @${requested}. Allowed: ${mention(valid)}. ${changeHint(input.parent)}`,
    }
  return { kind: 'agent', agent: target }
}

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`)

/**
 * The identity and instructions a subagent's prompt opens with, bounded. The built-in `@dsh` with no instructions
 * has nothing to add; a routine is not carried, since a subagent does not keep schedules.
 */
const preamble = (agent: Agent): string => {
  const instructions = agent.instructions.trim()
  if (agent.builtIn && instructions === '') return ''
  const header = [`Work as @${agent.handle} — ${agent.name}.`, agent.description].filter(line => line.trim() !== '').join('\n')
  return clip([header, instructions].filter(section => section !== '').join('\n\n'), MAX_SUBAGENT_AGENT_PREAMBLE_CHARS)
}

const optionOf = (agent: Agent): SubagentAgentOption => ({
  handle: agent.handle,
  name: agent.name,
  description: agent.description,
  route: agent.route,
  preset: agent.preset,
})

const listing = (input: SubagentAgentsInput): SubagentAgentListing => ({
  parent: input.parent,
  default: input.agents.get(input.parent)?.subagents.default ?? null,
  agents: allowed(input).map(optionOf),
  change: changeHint(input.parent),
})

/** Pure rules behind the `@dshfiles/tool-subagent/agent-resolver` provider. */
export class SubagentAgents {
  static readonly decide = decide
  static readonly preamble = preamble
  static readonly listing = listing
}
