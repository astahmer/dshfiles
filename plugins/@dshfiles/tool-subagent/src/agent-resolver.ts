/**
 * The `@dshfiles/tool-subagent/agent-resolver` contract: which configured agent a fresh subagent starts as.
 *
 * The `subagent` tool owns the `agent` argument and the child start; an agent registry (`@dshfiles/agents`) provides
 * this resolver on the Host as the `dshfilesSubagentAgents` Cordis service. The registry depends on this package, never
 * the reverse (docs/plugin-boundaries.md). Without a provider the `agent` argument stays in the schema (so it is stable
 * across plugin load order and HMR) and the tool refuses it with a recovery message; an omitted `agent` keeps upstream
 * behavior.
 * @module @dshfiles/tool-subagent/agent-resolver
 */

import type {} from '@deepseek-ai/cordis'

/** The calling thread, as tool-search describes a thread to `@dshfiles/tool-search/access`. */
export interface SubagentAgentSubject {
  readonly sessionId: string
  readonly cwd: string | undefined
  /** The creating Session when the caller is itself a subagent, else undefined. */
  readonly parentSessionId: string | undefined
}

/** An agent's pinned model route. */
export interface SubagentAgentRoute {
  readonly provider: string
  readonly model: string
  readonly reasoningEffort?: string | undefined
}

/** The longest preamble the tool prepends to a child prompt; the task itself is never clipped. */
export const MAX_SUBAGENT_AGENT_PREAMBLE_CHARS = 4_000

/** A fresh child that starts as a configured agent. */
export interface SubagentAgentChoice {
  readonly kind: 'agent'
  readonly handle: string
  /** The agent's pinned route; null follows the tool's defaults. */
  readonly route: SubagentAgentRoute | null
  /** The agent's Agent preset id; null keeps the tool's default (the parent's preset). */
  readonly preset: string | null
  /** Identity and instructions to put before the task; empty for none. The tool clips it to the bound above. */
  readonly preamble: string
  /** Record `childSessionId` as this agent's thread. The tool awaits it before the child exists. */
  readonly record: (childSessionId: string) => Promise<void>
}

/**
 * The resolver's answer: `inherit` (no `agent` and no default: the child takes its parent's agent as before), a
 * {@link SubagentAgentChoice}, or a refusal whose message names the handles involved and how to change the rule.
 */
export type SubagentAgentResolution = { readonly kind: 'inherit' } | SubagentAgentChoice | { readonly kind: 'refused'; readonly message: string }

/** One agent the caller may start. */
export interface SubagentAgentOption {
  readonly handle: string
  readonly name: string
  readonly description: string
  readonly route: SubagentAgentRoute | null
  readonly preset: string | null
}

/** What `list_subagent_models` reports about agents. */
export interface SubagentAgentListing {
  /** The calling thread's agent. */
  readonly parent: string
  /** The agent an omitted `agent` starts as; null keeps the parent's agent. */
  readonly default: string | null
  readonly agents: readonly SubagentAgentOption[]
  /** How to change which agents are allowed. */
  readonly change: string
}

/** Provided by an agent registry; both methods are synchronous reads except `record`. */
export interface SubagentAgentResolver {
  /** `handle` is the tool's `agent` argument, or undefined when omitted. */
  readonly resolve: (request: { readonly parent: SubagentAgentSubject; readonly handle: string | undefined }) => SubagentAgentResolution
  readonly list: (parent: SubagentAgentSubject) => SubagentAgentListing
}

/** The Cordis service name the provider registers with `ctx.provide`. */
export const SUBAGENT_AGENT_RESOLVER_SERVICE = 'dshfilesSubagentAgents'

declare module '@deepseek-ai/cordis' {
  interface Context {
    dshfilesSubagentAgents?: SubagentAgentResolver
  }
}
