import { InlineReferenceModel } from '@dshfiles/chat/inline-references'
import { EntityPreview } from '@dshfiles/input-trigger/entity-registry'
import type { KeyboardEvent, MouseEvent } from 'react'
import { BacklogReference } from './backlog-reference.js'

/** Ask the shared reference card (input-trigger's entity registry) to show one item under an element. */
export const previewBacklogReference = (ref: string, element: Element): boolean =>
  BacklogReference.parse(ref) !== undefined && EntityPreview.request({ kind: BacklogReference.entityKind, id: ref }, element)

/** A written `b:<ref>`: the text stays as the author wrote it and opens the item's card. */
const BacklogReferenceLink = (props: { readonly reference: string; readonly text: string }): JSX.Element => {
  const onClick = (event: MouseEvent<HTMLElement>): void => {
    if (event.button !== 0 || document.getSelection()?.isCollapsed === false) return
    if (previewBacklogReference(props.reference, event.currentTarget)) event.preventDefault()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    if (previewBacklogReference(props.reference, event.currentTarget)) event.preventDefault()
  }
  return (
    <span
      aria-label={`Preview backlog item ${BacklogReference.label(props.reference)}`}
      data-dshfiles-backlog-reference={props.reference}
      onClick={onClick}
      onKeyDown={onKeyDown}
      role="link"
      tabIndex={0}
    >
      {props.text}
    </span>
  )
}

/** Plain text with each written `b:<ref>` as a link that opens the item's card. */
export const BacklogReferenceText = (props: { readonly text: string }): JSX.Element => {
  const parts: (string | JSX.Element)[] = []
  let cursor = 0
  for (const match of BacklogReference.matches(props.text)) {
    parts.push(props.text.slice(cursor, match.start))
    parts.push(<BacklogReferenceLink key={match.start} reference={match.ref} text={props.text.slice(match.start, match.end)} />)
    cursor = match.end
  }
  parts.push(props.text.slice(cursor))
  return <>{parts}</>
}

/**
 * `b:<ref>` in an answer or a backlog comment. Inline code counts (an Agent often backticks the token); Chat never offers
 * fenced code or link text.
 */
export const backlogInlineReference = InlineReferenceModel.define<string>({
  id: 'backlog-item',
  surfaces: ['prose', 'code'],
  match: text => BacklogReference.matches(text).map(match => ({ start: match.start, end: match.end, value: match.ref })),
  render: input => <BacklogReferenceLink reference={input.value} text={input.text} />,
})
