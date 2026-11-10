/** The sent-message spelling of an agent reference: `@{handle}`, read back into its chip. */
import type { UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'

import { AgentReference } from './agent-reference.js'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap {
    /** One agent the user referenced when sending the message. */
    agent: { readonly handle: string }
  }
}

const wireMention = /@\{([^}\s]{1,64})\}/u

/** Order 15 keeps it behind Session mentions (10) and ahead of Backlog chips (20). */
export const agentUserTextRule: UserTextRule<'agent'> = {
  id: 'agent',
  order: 15,
  match(text, from) {
    const mention = wireMention.exec(text.slice(from))
    const handle = mention?.[1]
    if (mention === null || handle === undefined || !AgentReference.isHandle(handle)) return undefined
    const start = from + (mention.index ?? 0)
    return { id: 'agent', start, end: start + mention[0].length, data: { handle } }
  },
}
