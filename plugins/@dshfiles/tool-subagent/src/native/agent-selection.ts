/**
 * dshfiles addition: the `agent` argument of a fresh-child delegation tool. Which agent a child starts as is decided
 * by the `@dshfiles/tool-subagent/agent-resolver` provider; this module turns its answer into start options.
 */

import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SubagentProvider } from '@deepseek-ai/dsh-subagent'
import {
  MAX_SUBAGENT_AGENT_PREAMBLE_CHARS,
  type SubagentAgentChoice,
  type SubagentAgentListing,
  type SubagentAgentResolver,
  type SubagentAgentSubject,
} from '../agent-resolver.ts'

/** Model-facing description of the `agent` parameter; constant so the tool schema never changes within a Session. */
export const AGENT_PARAMETER_DESCRIPTION =
  'Configured agent handle (without @) this child starts as: its model route, Agent preset, instructions and tools. '
  + 'Omit to use your agent\'s default subagent agent, else your own agent. `list_subagent_models` lists the agents you may start. '
  + 'Explicit `provider`/`model` override the agent\'s route.'

/** The resolver's refusal or a missing provider, as a tool error the model can act on. */
export class SubagentAgentRefused extends Error {
  override readonly name = 'SubagentAgentRefused'
}

/** The calling thread as the resolver reads it, from the live parent Agent's Session header. */
export function subagentAgentSubject(parent: Agent): SubagentAgentSubject {
  const header = parent.session.header
  return {
    sessionId: parent.id,
    cwd: header.cwd === undefined || header.cwd === '' ? undefined : header.cwd,
    parentSessionId: header.origin === 'subagent' ? header.parentSession : undefined,
  }
}

/**
 * The agent a delegation starts its child as, or undefined to keep upstream behavior (the child inherits its parent's
 * agent).
 * @param input.requested - the raw `agent` tool argument.
 * @param input.resolver - the `dshfilesSubagentAgents` provider, when one is loaded.
 * @param input.provider - the delegation backend.
 * @param input.toolName - the calling tool, for messages.
 * @throws SubagentAgentRefused for a fork given `agent`, a missing provider, a backend that cannot honor it, or a refusal.
 */
export function selectSubagentAgent(input: {
  readonly requested: unknown
  readonly resolver: SubagentAgentResolver | undefined
  readonly parent: Agent
  readonly provider: SubagentProvider
  readonly toolName: string
}): SubagentAgentChoice | undefined {
  const { requested, resolver, provider, toolName } = input
  if (requested !== undefined && (typeof requested !== 'string' || requested.trim() === '')) {
    throw new SubagentAgentRefused('`agent` must be a non-empty agent handle; omit it to use the default agent')
  }
  const handle = typeof requested === 'string' ? requested.trim().replace(/^@/u, '') : undefined
  // A fork inherits this conversation, built under the parent's instructions and tools; another agent's tools would
  // drop tools its transcript already called and break the shared prompt prefix.
  if (provider.inheritsParentContext) {
    if (handle === undefined) return undefined
    throw new SubagentAgentRefused(
      `\`${toolName}\` continues this conversation, so the child always runs as your own agent. `
      + 'Use `subagent` with `agent` to start a fresh child as another agent, or omit `agent`.',
    )
  }
  if (resolver === undefined) {
    if (handle === undefined) return undefined
    throw new SubagentAgentRefused(
      `cannot start the child as @${handle}: no agent registry is loaded on this Host. `
      + 'Enable the @dshfiles/agents plugin in this profile (then restart DSH), or omit `agent`.',
    )
  }
  const resolution = resolver.resolve({ parent: subagentAgentSubject(input.parent), handle })
  if (resolution.kind === 'inherit') return undefined
  if (resolution.kind === 'refused') throw new SubagentAgentRefused(resolution.message)
  if (provider.prepareContinuable === undefined) {
    throw new SubagentAgentRefused(
      `subagent backend "${provider.name}" runs outside this Host, so @${resolution.handle}'s tools cannot apply to it. `
      + 'Use a local backend (spawn), or omit `agent`.',
    )
  }
  if (resolution.route !== null && !provider.capabilities.agentOptions) {
    throw new SubagentAgentRefused(`subagent backend "${provider.name}" cannot set @${resolution.handle}'s model route; omit \`agent\` or use the spawn backend`)
  }
  if (resolution.preset !== null && !provider.capabilities.agentPreset) {
    throw new SubagentAgentRefused(`subagent backend "${provider.name}" cannot start @${resolution.handle}'s Agent preset; omit \`agent\` or use the spawn backend`)
  }
  return resolution
}

/** The agent's route over the tool's configured child options; an omitted effort clears the parent's effort. */
export function agentRouteOptions(configured: AgentOptions | undefined, choice: SubagentAgentChoice): AgentOptions | undefined {
  if (choice.route === null) return configured
  return {
    ...configured,
    provider: choice.route.provider,
    model: choice.route.model,
    reasoningEffort: choice.route.reasoningEffort === undefined ? undefined : ReasoningEffortId(choice.route.reasoningEffort),
  }
}

const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`)

/** The child prompt: the agent's bounded preamble, then the task, which is never clipped. */
export function agentPrompt(choice: SubagentAgentChoice | undefined, prompt: string): string {
  const preamble = choice?.preamble.trim() ?? ''
  if (preamble === '') return prompt
  return `${clip(preamble, MAX_SUBAGENT_AGENT_PREAMBLE_CHARS)}\n\n---\n\n${prompt}`
}

/** The `list_subagent_models` section naming the agents a caller may start. */
export function agentListingText(listing: SubagentAgentListing | undefined): string {
  if (listing === undefined) return 'Agents: none (no agent registry is loaded; `agent` is unavailable).'
  const lines = listing.agents.map(agent => {
    const route = agent.route === null ? 'default route' : `${agent.route.provider}/${agent.route.model}${agent.route.reasoningEffort === undefined ? '' : ` (${agent.route.reasoningEffort})`}`
    const marks = [agent.handle === listing.default ? 'default' : '', agent.handle === listing.parent ? 'your agent' : ''].filter(mark => mark !== '')
    return `${agent.handle}${marks.length === 0 ? '' : ` [${marks.join(', ')}]`} — ${agent.name}; ${route}${agent.preset === null ? '' : `; preset ${agent.preset}`}${agent.description === '' ? '' : `: ${agent.description}`}`
  })
  const fallback = listing.default === null ? `Omitting \`agent\` starts the child as ${listing.parent}.` : `Omitting \`agent\` starts the child as ${listing.default}.`
  return [`Agents you may start with \`subagent\`'s \`agent\` argument (you are ${listing.parent}):`, ...lines.length === 0 ? ['(none)'] : lines, fallback, listing.change].join('\n')
}
