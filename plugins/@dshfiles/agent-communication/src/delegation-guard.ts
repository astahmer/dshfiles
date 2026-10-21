import { Agents, type AgentDelegation } from '@dshfiles/agents/contract'

/** What the Host knows about the agent that started a thread, as far as messaging is concerned. */
export interface DelegationSender {
  readonly handle: string
  readonly delegation: AgentDelegation
}

export type DelegationDecision = { readonly allowed: true } | { readonly allowed: false; readonly reason: string }

/**
 * Enforces an agent's delegation targets where a message is dispatched. The rule itself lives in the agents contract;
 * this only decides what the Host facts mean, and a thread no agent started has no rule to break.
 */
export class CommunicationDelegation {
  static direct(input: { readonly sender: DelegationSender | null; readonly targetHandle: string | null }): DelegationDecision {
    if (input.sender === null) return { allowed: true }
    if (Agents.mayMessage(input.sender.delegation, input.targetHandle)) return { allowed: true }
    const target = input.targetHandle === null ? 'a thread no agent started' : `@${input.targetHandle}`
    const reason =
      input.sender.delegation.messaging === 'none'
        ? `@${input.sender.handle} may not message other Agents.`
        : `@${input.sender.handle} may only message ${input.sender.delegation.handles.map(handle => `@${handle}`).join(', ') || 'listed peers'}, not ${target}.`
    return { allowed: false, reason }
  }

  static broadcast(input: { readonly sender: DelegationSender | null }): DelegationDecision {
    if (input.sender === null) return { allowed: true }
    if (Agents.mayBroadcast(input.sender.delegation)) return { allowed: true }
    return { allowed: false, reason: `@${input.sender.handle} may not broadcast to other Agents.` }
  }
}
