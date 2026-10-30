import type { AgentContinuationThread } from './agent-dispatch.js'
import type { BacklogLink } from './item.js'

export class AgentContinuation {
  static candidates(input: { readonly links: readonly BacklogLink[]; readonly threads: readonly AgentContinuationThread[] }): AgentContinuationThread[] {
    const linked = new Set(input.links.filter(link => link.type === 'thread').map(link => link.target))
    return input.threads.filter(thread => linked.has(thread.sessionId))
  }

  static ownsLinkedThread(input: {
    readonly links: readonly BacklogLink[]
    readonly sessionId: string
    readonly requestedHandle: string
    readonly ownerHandle: string | null
  }): boolean {
    return input.links.some(link => link.type === 'thread' && link.target === input.sessionId) && input.ownerHandle === input.requestedHandle
  }
}
