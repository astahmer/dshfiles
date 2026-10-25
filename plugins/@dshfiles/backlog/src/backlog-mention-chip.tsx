import type { UserTextNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { BacklogReferenceChip } from './backlog-reference-chip.js'

interface BacklogMentionChipProps {
  readonly node: UserTextNode<'backlog'>
  readonly interactive: boolean
}

/** One sent Backlog mention uses the shared chip and preview behavior. */
export const BacklogMentionChip = ({ node, interactive }: BacklogMentionChipProps): JSX.Element => (
  <BacklogReferenceChip id={node.data.id} itemTitle={node.data.title} interactive={interactive} />
)
