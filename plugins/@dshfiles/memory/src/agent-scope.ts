import { Effect } from 'effect'

/** What memory needs from the agents registry and the Session tree to find the agent behind a thread. */
export interface AgentScopeLookup<R> {
  /** The agent that started this Session, when one did. */
  readonly threadAgent: (sessionId: string) => Effect.Effect<{ readonly memoryScope: string | null } | null, never, R>
  /** The parent Session of a subagent, when it has one. */
  readonly parentOf: (sessionId: string) => Effect.Effect<string | undefined, never, R>
}

/** How far up a subagent's lineage memory looks; a deeper chain falls back to the project block. */
const MAX_AGENT_SCOPE_HOPS = 4

/**
 * The memory scope a thread reads: its own agent's scope, or — for a subagent — the scope of the agent whose thread
 * spawned it. A thread an agent started with no scope stops the walk: it is that agent's own thread and reads the
 * project block, not the scope of whoever started that agent.
 */
export const resolveAgentScope = <R>(input: { readonly sessionId: string; readonly lookup: AgentScopeLookup<R> }) =>
  Effect.gen(function* () {
    let current: string | undefined = input.sessionId
    for (let hop = 0; hop <= MAX_AGENT_SCOPE_HOPS && current !== undefined; hop++) {
      const agent = yield* input.lookup.threadAgent(current)
      if (agent !== null) return agent.memoryScope
      current = yield* input.lookup.parentOf(current)
    }
    return null
  })
