import { Agents, type Agent, type AgentIdentity } from '@dshfiles/agents/contract'

import type { StartThreadAgent, StartThreadItem, StartThreadRequest, StartThreadTarget } from './start-thread.js'
import { StartThreadForm } from './start-thread.js'

/** What a leading `@handle` comment box did: started a thread, stayed an ordinary comment, or failed. */
export type AgentDispatchOutcome =
  | { readonly kind: 'dispatched' }
  | { readonly kind: 'skipped'; readonly reason: 'no-mention' | 'unknown-agent' | 'disabled-agent' | 'agents-unavailable' }
  | { readonly kind: 'failed'; readonly reason: string }

/** One enabled agent as the comment box offers it, without the instructions a dispatch does not need to show. */
export interface AgentChoice {
  readonly handle: string
  readonly name: string
  readonly glyph: string
  readonly description: string
}

/** The Host lookup and thread start the comment box needs; owned by the client entry. */
export interface AgentDispatchPort {
  dispatch(input: { readonly item: StartThreadItem; readonly text: string }): Promise<AgentDispatchOutcome>
  /** Enabled agents, loaded once when an `@` is typed; an unavailable agents bundle answers an empty list. */
  choices(): Promise<readonly AgentChoice[]>
}

/** A mention is dispatched only from the item's own comment box; the grammar and the prompt come from the agents contract. */
export class AgentComments {
  /** The fields inline completion and the panel need, without the instructions. */
  static choice(agent: Agent): AgentChoice {
    return { handle: agent.handle, name: agent.name, glyph: agent.glyph, description: agent.description }
  }

  /** The request fields an agent contributes to a start-thread call. */
  static agent(agent: Agent): StartThreadAgent {
    const fields = {
      handle: agent.handle,
      name: agent.name,
      instructions: agent.instructions,
      preset: agent.preset,
      route: agent.route,
    }
    return agent.routine === undefined || agent.routine === '' ? fields : { ...fields, routine: agent.routine }
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
   * The start-thread request for an agent comment: the agent's preset and route, its instructions, the item context
   * the thread must name, and the comment text. The caller supplies the target because only it knows the projects.
   * A dispatch never opens the thread it starts: the comment box keeps the item in front of the user, and the report
   * the start writes offers the thread instead.
   */
  static request(input: {
    readonly items: readonly StartThreadItem[]
    readonly agent: Agent
    readonly task: string
    readonly target: StartThreadTarget
  }): StartThreadRequest {
    const task = input.task.trim()
    const context = StartThreadForm.message(input.items)
    return {
      items: input.items,
      target: input.target,
      agent: AgentComments.agent(input.agent),
      provider: null,
      model: null,
      reasoningEffort: undefined,
      message: AgentComments.opening(input.agent, task === '' ? context : `${context}\n\n${task}`),
      send: true,
      open: false,
    }
  }
}
