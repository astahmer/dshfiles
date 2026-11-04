import { InlineReferenceModel } from '@dshfiles/chat/inline-references'
import { EntityPreview } from '@dshfiles/input-trigger/entity-registry'
import type { KeyboardEvent, MouseEvent } from 'react'
import { BacklogReference } from './backlog-reference.js'

/** Ask the shared reference card (input-trigger's entity registry) to show one item under an element. */
export const previewBacklogReference = (id: number, element: Element): boolean =>
  BacklogReference.id(String(id)) !== undefined && EntityPreview.request({ kind: BacklogReference.entityKind, id: String(id) }, element)

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
