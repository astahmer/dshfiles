import { InlineReferenceModel } from '@dshfiles/chat/inline-references'

import { AgentReferenceChip } from './agent-reference-chip.js'
import { AgentReference } from './agent-reference.js'

/** The saved handles a mention may name; the overlay's agent list replaces them, and Chat re-renders on each change. */
const vocabulary = InlineReferenceModel.vocabulary()
let handles: ReadonlySet<string> = new Set()

const setHandles = (next: ReadonlySet<string>): void => {
  const same = next.size === handles.size && [...next].every(handle => handles.has(handle))
  if (same) return
  handles = next
  vocabulary.bump()
}

/** A known agent's mention in an answer, a backlog comment or inline code; an unknown handle stays text. */
const reference = InlineReferenceModel.define<string>({
  id: 'agent-mention',
  surfaces: ['prose', 'code'],
  vocabulary,
  match: text => AgentReference.matches(text, handles).map(match => ({ start: match.start, end: match.end, value: match.handle })),
  render: input => <AgentReferenceChip handle={input.value} />,
})

export class AgentInlineReference {
  static readonly reference = reference
  static readonly setHandles = setHandles
  static readonly handles = (): ReadonlySet<string> => handles
}
