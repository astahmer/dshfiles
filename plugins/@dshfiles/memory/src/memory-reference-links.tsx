import type { UserTextNode, UserTextRule } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { InlineReferenceModel } from '@dshfiles/chat/inline-references'
import type { KeyboardEvent, MouseEvent } from 'react'
import { EntityPreview } from '@dshfiles/input-trigger/entity-registry'
import { MemoryAnchorModel } from './memory-anchor.ts'
import { MemoryReferenceModel, memoryReferenceMatches } from './memory-reference.ts'

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

const previewAt = (citation: MemoryCitation, element: Element): boolean => {
  const anchorId = MemoryAnchorModel.idOf(element)
  const rect = element.getBoundingClientRect()
  const anchor = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  const candidate = citation.range === undefined ? { id: citation.id, anchorId, anchor } : { id: citation.id, range: citation.range, anchorId, anchor }
  const request = MemoryReferenceModel.decodePreviewRequest(candidate)
  if (request === null) return false
  // Validated above; the shared reference card (input-trigger's entity registry) draws it.
  return EntityPreview.request({ kind: MemoryReferenceModel.entityKind, id: request.id, range: request.range }, element)
}

const MemoryReferenceLink = (props: { readonly citation: MemoryCitation; readonly text: string }): JSX.Element => {
  const { id, range } = props.citation
  const onClick = (event: MouseEvent<HTMLElement>): void => {
    if (event.button !== 0 || document.getSelection()?.isCollapsed === false) return
    if (previewAt(props.citation, event.currentTarget)) event.preventDefault()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Enter' && previewAt(props.citation, event.currentTarget)) event.preventDefault()
  }
  return (
    <span
      aria-label={`Preview memory ${id}${range === undefined ? '' : ` #${range}`}`}
      data-dshfiles-memory-range={range}
      data-dshfiles-memory-reference={id}
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
  render: input => <MemoryReferenceLink citation={input.value} text={input.text} />,
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

/** The `conversation.user.text.node` renderer for that rule; a queued or previewed message keeps it as text. */
const MemoryUserTextLink = (props: { readonly node: UserTextNode<'memory'>; readonly raw: string; readonly interactive: boolean }): JSX.Element =>
  props.interactive ? (
    <MemoryReferenceLink citation={{ id: props.node.data.id, range: props.node.data.range ?? undefined }} text={props.raw} />
  ) : (
    <>{props.raw}</>
  )

export class MemoryInlineReference {
  static readonly reference = memoryInlineReference
  static readonly userTextRule = memoryUserTextRule
  static readonly UserTextLink = MemoryUserTextLink
}
