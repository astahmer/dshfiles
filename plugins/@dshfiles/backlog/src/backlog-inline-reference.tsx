import { InlineReferenceModel } from '@dshfiles/chat/inline-references'
import { BacklogReferenceChip } from './backlog-reference-chip.js'
import { BacklogReference } from './backlog-reference.js'

/** Plain text with each written `b:<ref>` as the item's chip, which opens its card on click or hover. */
export const BacklogReferenceText = (props: { readonly text: string }): JSX.Element => {
  const parts: (string | JSX.Element)[] = []
  let cursor = 0
  for (const match of BacklogReference.matches(props.text)) {
    parts.push(props.text.slice(cursor, match.start))
    parts.push(<BacklogReferenceChip key={match.start} reference={match.ref} />)
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
  render: input => <BacklogReferenceChip reference={input.value} />,
})
