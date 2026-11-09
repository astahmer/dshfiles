import type { UserTextNode } from '@deepseek-ai/dsh-client-ui-conversation/client'

import { AgentReferenceChip } from './agent-reference-chip.js'

/** The `conversation.user.text.node` renderer for a sent `@{handle}`, the same chip answers use. */
export const AgentMentionChip = (props: { readonly node: UserTextNode<'agent'>; readonly interactive: boolean }): JSX.Element => (
  <AgentReferenceChip handle={props.node.data.handle} interactive={props.interactive} />
)
