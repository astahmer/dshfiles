/** What memory needs from the agents registry and the Session tree to find the agent behind a thread. */
export interface AgentScopeLookup {
  /** The agent that started this Session, when one did. */
  readonly threadAgent: (sessionId: string) => Promise<{ readonly memoryScope: string | null } | null>
  /** The parent Session of a subagent, when it has one. */
  readonly parentOf: (sessionId: string) => Promise<string | undefined>
}

/** How far up a subagent's lineage memory looks; a deeper chain falls back to the project block. */
export const MAX_AGENT_SCOPE_HOPS = 4

/**
 * The memory scope a thread reads: its own agent's scope, or — for a subagent — the scope of the agent whose thread
 * spawned it. A thread an agent started with no scope stops the walk: it is that agent's own thread and reads the
 * project block, not the scope of whoever started that agent.
 */
export class AgentScope {
  static async resolve(input: { readonly sessionId: string; readonly lookup: AgentScopeLookup }): Promise<string | null> {
    let current: string | undefined = input.sessionId
    for (let hop = 0; hop <= MAX_AGENT_SCOPE_HOPS && current !== undefined; hop++) {
      const agent = await input.lookup.threadAgent(current)
      if (agent !== null) return agent.memoryScope
      current = await input.lookup.parentOf(current)
    }
    return null
  }
}
