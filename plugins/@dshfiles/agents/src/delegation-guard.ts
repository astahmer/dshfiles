import { Agents, type Agent } from './agent.js'

/**
 * The native tools that start new work under an agent. Their names come from the profile's composition (`toolName` on
 * each `@deepseek-ai/dsh-tool-subagent` row plus the workflow tool), because no Host metadata marks a tool as a
 * delegation tool; a profile that renames one of them has to extend this list.
 */
export const DELEGATION_TOOL_NAMES: readonly string[] = ['subagent', 'subagent_fork', 'workflow']

/** Refuses a delegation call when the agent that started the calling thread may not spawn subagents. */
export class DelegationGuard {
  static refusal(input: { readonly toolName: string; readonly agent: Agent | null }): string | undefined {
    if (!DELEGATION_TOOL_NAMES.includes(input.toolName)) return undefined
    if (input.agent === null) return undefined
    if (Agents.maySpawnSubagents(input.agent.delegation)) return undefined
    return `@${input.agent.handle} may not start subagents or workflows. Change its delegation setting to allow them.`
  }
}
