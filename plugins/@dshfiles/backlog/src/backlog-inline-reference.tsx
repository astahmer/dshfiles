import { InlineReferenceModel } from '@dshfiles/chat/inline-references'
import { Option, Schema } from 'effect'
import type { KeyboardEvent, MouseEvent } from 'react'
import { BacklogAnchorModel } from './backlog-anchor.js'
import { BacklogReference, backlogReferencePreviewEvent, backlogReferencePreviewRequestSchema } from './backlog-reference.js'

/** Ask the shared card to show one item above an element the caller rendered itself. */
export const previewBacklogReference = (id: number, element: Element): boolean => {
  const rect = element.getBoundingClientRect()
  const anchor = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  const request = Option.getOrNull(Schema.decodeUnknownOption(backlogReferencePreviewRequestSchema)({ id, anchorId: BacklogAnchorModel.idOf(element), anchor }))
  if (request === null) return false
  window.dispatchEvent(new CustomEvent(backlogReferencePreviewEvent, { detail: request }))
  return true
}

/** A written `b:<id>`: the text stays as the author wrote it and opens the item's card. */
const BacklogReferenceLink = (props: { readonly id: number; readonly text: string }): JSX.Element => {
  const onClick = (event: MouseEvent<HTMLElement>): void => {
    if (event.button !== 0 || document.getSelection()?.isCollapsed === false) return
    if (previewBacklogReference(props.id, event.currentTarget)) event.preventDefault()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (previewBacklogReference(props.id, event.currentTarget)) event.preventDefault()
  }
  return (
    <span
      aria-label={`Preview backlog item ${BacklogReference.label(props.id)}`}
      data-dshfiles-backlog-reference={String(props.id)}
      onClick={onClick}
      onKeyDown={onKeyDown}
      role="link"
      tabIndex={0}
    >
      {props.text}
    </span>
  )
}

/**
 * `b:<id>` in an answer or a backlog comment. Inline code counts (an Agent often backticks the token); Chat never offers
 * fenced code or link text.
 */
export const backlogInlineReference = InlineReferenceModel.define<number>({
  id: 'backlog-item',
  surfaces: ['prose', 'code'],
  match: text => BacklogReference.matches(text).map(match => ({ start: match.start, end: match.end, value: match.id })),
  render: input => <BacklogReferenceLink id={input.value} text={input.text} />,
})
