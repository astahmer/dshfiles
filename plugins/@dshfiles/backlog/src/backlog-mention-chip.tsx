import type { UserTextNode } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { useRef, type MouseEvent } from 'react'

import { backlogReferenceLabel } from './backlog-reference.js'
import { previewBacklogReference } from './backlog-reference-links.js'

interface BacklogMentionChipProps {
  readonly node: UserTextNode<'backlog'>
  readonly interactive: boolean
}

const labelOf = (data: { readonly id: number; readonly title: string | null }): string =>
  data.title === null || data.title.trim() === '' ? backlogReferenceLabel(data.id) : `${backlogReferenceLabel(data.id)} ${data.title}`

/** One sent Backlog mention, rendered like its composer chip and opening the shared preview card when interactive. */
export const BacklogMentionChip = ({ node, interactive }: BacklogMentionChipProps): JSX.Element => {
  const reference = useRef<HTMLButtonElement | null>(null)
  const label = labelOf(node.data)
  const content = (
    <>
      <span aria-hidden className="dshfiles-backlog-mention-marker">
        {'@'}
      </span>
      <span className="dshfiles-backlog-mention-label">{label}</span>
    </>
  )
  if (!interactive)
    return (
      <span className="dshfiles-backlog-mention" data-ref-chip="backlog" title={label}>
        {content}
      </span>
    )
  const onActivate = (event: MouseEvent<HTMLButtonElement>): void => {
    if (event.detail > 1 || (event.detail !== 0 && document.getSelection()?.isCollapsed === false)) return
    const element = reference.current
    if (element !== null) previewBacklogReference(node.data.id, element)
  }
  return (
    <button
      aria-label={`Backlog item ${label}`}
      className="dshfiles-backlog-mention"
      data-ref-chip="backlog"
      onClick={onActivate}
      ref={reference}
      title={label}
      type="button"
    >
      {content}
    </button>
  )
}
