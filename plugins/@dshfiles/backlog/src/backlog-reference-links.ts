import { backlogReferenceMatches, backlogReferencePreviewEvent, backlogReferencePreviewRequestSchema, backlogReferenceLabel } from './backlog-reference.js'
import { BacklogAnchorModel } from './backlog-anchor.js'

const referenceSelector = '[data-dshfiles-backlog-reference]'
/** Inline code holds a written reference; a fenced block holds an example, and links already carry their own target. */
const ignoredTextSelector = `a, button, pre, [role="link"]:not(${referenceSelector}), [data-composer-card], [data-ref-chip], [data-dshfiles-backlog-preview], ${referenceSelector}`
const messageBlocksSelector =
  '[data-conversation-session] [class*="_userRow"] [class*="_bubble"], [data-conversation-session] p, [data-conversation-session] li, [data-conversation-session] blockquote, [data-conversation-session] h1, [data-conversation-session] h2, [data-conversation-session] h3, [data-conversation-session] h4, [data-conversation-session] h5, [data-conversation-session] h6, [data-conversation-session] td'

type TextSegment = { readonly node: Text; readonly start: number; readonly end: number }

const textSegments = (block: Element): readonly TextSegment[] => {
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT)
  const segments: TextSegment[] = []
  let offset = 0
  let node = walker.nextNode()
  while (node !== null) {
    const parent = node.parentElement
    if (node instanceof Text && parent !== null && parent.closest(ignoredTextSelector) === null) {
      const text = node.textContent ?? ''
      segments.push({ node, start: offset, end: offset + text.length })
      offset += text.length
    }
    node = walker.nextNode()
  }
  return segments
}

const linkFor = (block: Element, segment: TextSegment, id: number, start: number, end: number): void => {
  const document = block.ownerDocument
  const link = document.createElement('span')
  link.setAttribute('data-dshfiles-backlog-reference', String(id))
  link.setAttribute('role', 'link')
  link.setAttribute('aria-label', `Preview backlog item ${backlogReferenceLabel(id)}`)
  link.tabIndex = 0
  BacklogAnchorModel.idOf(link)
  const range = document.createRange()
  range.setStart(segment.node, start - segment.start)
  range.setEnd(segment.node, end - segment.start)
  try {
    range.surroundContents(link)
  } catch {
    return
  }
}

const markReferences = (blocks: Iterable<Element>): void => {
  for (const block of blocks) {
    const segments = textSegments(block)
    const text = segments.map(segment => segment.node.textContent ?? '').join('')
    const matches = backlogReferenceMatches(text)
    for (const match of [...matches].reverse()) {
      const segment = segments.find(candidate => match.start >= candidate.start && match.end <= candidate.end)
      if (segment !== undefined) linkFor(block, segment, match.id, match.start, match.end)
    }
  }
}

/**
 * The blocks a batch of mutation records can have changed. Rescanning only these keeps streaming
 * decoration proportional to the new tokens instead of to the loaded transcript.
 */
const dirtyBlocks = (records: readonly MutationRecord[]): readonly Element[] => {
  const blocks = new Set<Element>()
  const add = (node: Node | null): void => {
    const element = node instanceof Element ? node : (node?.parentElement ?? null)
    if (element === null) return
    const own = element.closest(messageBlocksSelector)
    if (own !== null) blocks.add(own)
    for (const nested of element.querySelectorAll(messageBlocksSelector)) blocks.add(nested)
  }
  for (const record of records) {
    if (record.type === 'characterData') {
      add(record.target)
      continue
    }
    for (const node of record.addedNodes) add(node)
    // A replaced child list changes that block's text; a replaced transcript reports its container.
    add(record.target)
  }
  return [...blocks]
}

/** Ask the shared card to show one item above an element the caller rendered itself. */
export const previewBacklogReference = (id: number, element: Element): boolean => {
  const rect = element.getBoundingClientRect()
  const anchor = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  const parsed = backlogReferencePreviewRequestSchema.safeParse({ id, anchorId: BacklogAnchorModel.idOf(element), anchor })
  if (!parsed.success) return false
  window.dispatchEvent(new CustomEvent(backlogReferencePreviewEvent, { detail: parsed.data }))
  return true
}

const previewAt = (element: Element): boolean => previewBacklogReference(Number(element.getAttribute('data-dshfiles-backlog-reference')), element)

const linkFrom = (target: EventTarget | null): Element | null =>
  target instanceof Element && target.closest('[data-composer-card]') === null ? target.closest(referenceSelector) : null

const onClick = (event: MouseEvent): void => {
  const link = linkFrom(event.target)
  if (link === null || event.button !== 0 || document.getSelection()?.isCollapsed === false) return
  if (previewAt(link)) event.preventDefault()
}

const onKeyDown = (event: KeyboardEvent): void => {
  if (event.key !== 'Enter' && event.key !== ' ') return
  const link = linkFrom(event.target)
  if (link !== null && previewAt(link)) event.preventDefault()
}

export const installBacklogReferenceLinks = (): (() => void) => {
  let frame = 0
  const pending = new Set<Element>()
  const observer = new MutationObserver(records => {
    for (const block of dirtyBlocks(records)) pending.add(block)
    if (pending.size === 0 || frame !== 0) return
    frame = requestAnimationFrame(() => {
      frame = 0
      const blocks = [...pending]
      pending.clear()
      markReferences(blocks)
    })
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  markReferences(document.querySelectorAll(messageBlocksSelector))
  // That first pass wrote the links already, so drop its records instead of rescanning them.
  observer.takeRecords()
  window.addEventListener('click', onClick)
  window.addEventListener('keydown', onKeyDown)
  return () => {
    observer.disconnect()
    cancelAnimationFrame(frame)
    window.removeEventListener('click', onClick)
    window.removeEventListener('keydown', onKeyDown)
  }
}
