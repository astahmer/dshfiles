import type { UserTextNode, UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { InlineReferenceModel } from '@dshfiles/chat/inline-references'
import { MemoryReferenceChip } from './memory-reference-chip.tsx'
import { memoryReferenceMatches } from './memory-reference.ts'

interface MemoryCitation {
  readonly id: string
  readonly range: string | undefined
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface UserTextDataMap {
    /** One reference of a `memory:` citation in a sent message. */
    memory: { readonly id: string; readonly range: string | null }
  }
}

/**
 * `memory: t:abc, n:3` in an answer. The citation is matched over the block text before this run plus the run itself,
 * so a backticked id (its own inline-code run) still counts after a `memory:` written outside it. The first reference
 * of a citation covers the whole `memory: …` token when it sits in the same run; otherwise only the id links.
 */
const memoryInlineReference = InlineReferenceModel.define<MemoryCitation>({
  id: 'memory-citation',
  surfaces: ['prose', 'code'],
  match: (text, context) => {
    const offset = context.before.length
    return memoryReferenceMatches(context.before + text).flatMap(match => {
      if (match.start < offset) return []
      const start = (match.citationStart >= offset ? match.citationStart : match.start) - offset
      return [{ start, end: match.end - offset, value: { id: match.id, range: match.range } }]
    })
  },
  render: input => <MemoryReferenceChip id={input.value.id} range={input.value.range} text={input.text} />,
})

/**
 * A sent message is rich-composer's user text, not Chat's Markdown: the same citation matches as a user-text rule, and
 * the node renders the same link. Order 30 keeps it behind Session mentions (10) and Backlog items (20).
 */
const memoryUserTextRule: UserTextRule<'memory'> = {
  id: 'memory',
  order: 30,
  match(text, from) {
    const match = memoryReferenceMatches(text)
      .map(candidate => ({ ...candidate, linkStart: candidate.citationStart }))
      .find(candidate => candidate.linkStart >= from)
    if (match === undefined) return undefined
    return { id: 'memory', start: match.linkStart, end: match.end, data: { id: match.id, range: match.range ?? null } }
  },
}

/** The `conversation.user.text.node` renderer for that rule: the same chip, interactive or not. */
const MemoryUserTextLink = (props: { readonly node: UserTextNode<'memory'>; readonly raw: string; readonly interactive: boolean }): JSX.Element => (
  <MemoryReferenceChip id={props.node.data.id} interactive={props.interactive} range={props.node.data.range ?? undefined} text={props.raw} />
)

export class MemoryInlineReference {
  static readonly reference = memoryInlineReference
  static readonly userTextRule = memoryUserTextRule
  static readonly UserTextLink = MemoryUserTextLink
}
