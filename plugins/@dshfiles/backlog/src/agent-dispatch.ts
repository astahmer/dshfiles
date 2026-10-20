import { Agents, type Agent, type AgentIdentity } from '@dshfiles/agents/contract'

import type { StartThreadAgent, StartThreadItem, StartThreadRequest, StartThreadTarget } from './start-thread.js'

/** What a leading `@handle` comment box did: started a thread, stayed an ordinary comment, or failed. */
export type AgentDispatchOutcome =
  | { readonly kind: 'dispatched' }
  | { readonly kind: 'skipped'; readonly reason: 'no-mention' | 'unknown-agent' | 'disabled-agent' | 'agents-unavailable' }
  | { readonly kind: 'failed'; readonly reason: string }

/** The Host lookup and thread start the comment box needs; owned by the client entry. */
export interface AgentDispatchPort {
  dispatch(input: { readonly item: StartThreadItem; readonly text: string }): Promise<AgentDispatchOutcome>
}

/** A mention is dispatched only from the item's own comment box; the grammar and the prompt come from the agents contract. */
export class AgentComments {
  /** The request fields an agent contributes to a start-thread call. */
  static agent(agent: Agent): StartThreadAgent {
    return { handle: agent.handle, name: agent.name, instructions: agent.instructions, preset: agent.preset, route: agent.route }
  }

  /** The opening message for a chosen agent: identity, then its instructions, then the task. */
  static opening(agent: AgentIdentity, task: string): string {
    return Agents.openingMessage({ agent, text: task, fallback: `Work as @${agent.handle}.` })
  }

  /** The `@handle` a comment addresses, without resolving it, so a plain comment can fall back in the same tick. */
  static mention(text: string): { readonly handle: string; readonly task: string } | null {
    const mention = Agents.parseMention(text)
    return mention === null ? null : { handle: mention.handle, task: mention.text }
  }

  /**
   * The start-thread request for an agent comment: the agent's preset and route, and its instructions in front of the
   * comment text. The caller supplies the target because only it knows the registered projects.
   */
  static request(input: {
    readonly item: StartThreadItem
    readonly agent: Agent
    readonly task: string
    readonly target: StartThreadTarget
  }): StartThreadRequest {
    return {
      item: input.item,
      target: input.target,
      agent: AgentComments.agent(input.agent),
      provider: null,
      model: null,
      reasoningEffort: undefined,
      message: AgentComments.opening(input.agent, input.task),
      send: true,
    }
  }
}
