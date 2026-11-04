import { InlineReferenceModel } from '@dshfiles/chat/inline-references'
import type { KeyboardEvent, MouseEvent } from 'react'
import { MemoryAnchorModel } from './memory-anchor.ts'
import { MemoryReferenceModel, memoryReferenceMatches, memoryReferencePreviewEvent } from './memory-reference.ts'

interface MemoryCitation {
  readonly id: string
  readonly range: string | undefined
}

const previewAt = (citation: MemoryCitation, element: Element): boolean => {
  const anchorId = MemoryAnchorModel.idOf(element)
  const rect = element.getBoundingClientRect()
  const anchor = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  const candidate = citation.range === undefined ? { id: citation.id, anchorId, anchor } : { id: citation.id, range: citation.range, anchorId, anchor }
  const request = MemoryReferenceModel.decodePreviewRequest(candidate)
  if (request === null) return false
  window.dispatchEvent(new CustomEvent(memoryReferencePreviewEvent, { detail: request }))
  return true
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

export class MemoryInlineReference {
  static readonly reference = memoryInlineReference
}
