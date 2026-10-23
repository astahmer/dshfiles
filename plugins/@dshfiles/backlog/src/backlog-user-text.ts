/** The user-text rule that turns a sent Backlog mention back into its chip. */
import type { UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'

import { nextBacklogMention } from './backlog-mention-text.js'

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap {
    /** One item the user referenced when sending the message. */
    backlog: { readonly id: number; readonly title: string | null }
  }
}

/** Order 20 keeps the rule behind Session mentions (10) and ahead of whitespace cleanup (1000). */
export const backlogUserTextRule: UserTextRule<'backlog'> = {
  id: 'backlog',
  order: 20,
  match(text, from) {
    const mention = nextBacklogMention(text, from)
    if (mention === undefined) return undefined
    return { id: 'backlog', start: mention.start, end: mention.end, data: { id: mention.id, title: mention.title } }
  },
}
