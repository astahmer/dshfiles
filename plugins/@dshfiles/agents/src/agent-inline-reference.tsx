import { InlineReferenceModel } from '@dshfiles/chat/inline-references'
import type { KeyboardEvent, MouseEvent } from 'react'
import { AgentReference } from './agent-reference.js'
import { previewAgentReference } from './agent-reference-links.js'

/** The saved handles a mention may name; the overlay's agent list replaces them, and Chat re-renders on each change. */
const vocabulary = InlineReferenceModel.vocabulary()
let handles: ReadonlySet<string> = new Set()

const setHandles = (next: ReadonlySet<string>): void => {
  const same = next.size === handles.size && [...next].every(handle => handles.has(handle))
  if (same) return
  handles = next
  vocabulary.bump()
}

/** One written `@{luna}` (or a legacy `@luna`): the text stays as written and opens the agent's card. */
const AgentReferenceLink = (props: { readonly handle: string; readonly text: string }): JSX.Element => {
  const open = (event: MouseEvent<HTMLElement> | KeyboardEvent<HTMLElement>): void => {
    event.preventDefault()
    // A row or card around the reference must not take the same gesture as its own.
    event.stopPropagation()
    previewAgentReference(props.handle, event.currentTarget)
  }
  return (
    <span
      aria-label={`Preview agent ${AgentReference.label(props.handle)}`}
      data-dshfiles-agent-reference={props.handle}
      onClick={event => {
        if (event.button !== 0 || document.getSelection()?.isCollapsed === false) return
        open(event)
      }}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') open(event)
      }}
      role="link"
      tabIndex={0}
    >
      {props.text}
    </span>
  )
}

/** A known agent's mention in an answer, a backlog comment or inline code; an unknown handle stays text. */
const reference = InlineReferenceModel.define<string>({
  id: 'agent-mention',
  surfaces: ['prose', 'code'],
  vocabulary,
  match: text => AgentReference.matches(text, handles).map(match => ({ start: match.start, end: match.end, value: match.handle })),
  render: input => <AgentReferenceLink handle={input.value} text={input.text} />,
})

export class AgentInlineReference {
  static readonly reference = reference
  static readonly setHandles = setHandles
  static readonly handles = (): ReadonlySet<string> => handles
}
