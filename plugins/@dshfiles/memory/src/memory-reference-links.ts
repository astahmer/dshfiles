import { MemoryAnchorModel } from './memory-anchor.ts'
import { memoryReferenceMatches, memoryReferencePreviewEvent, memoryReferencePreviewRequestSchema, type MemoryReferenceMatch } from './memory-reference.ts'

const memoryReferenceSelector = '[data-dshfiles-memory-reference]'
const ignoredTextSelector = 'a, button, [role="link"]:not([data-dshfiles-memory-reference]), [data-composer-card], [data-dshfiles-memory-preview]'
const messageBlocksSelector =
  '[data-conversation-session] [class*="_userRow"] [class*="_bubble"], [data-conversation-session] p, [data-conversation-session] li, [data-conversation-session] blockquote'

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

/**
 * The whole `memory: t:abc` is the link when the citation sits in one text node; a backticked id is its own element, so
 * that reference falls back to its own range instead of dropping the link.
 */
const linkStartFor = (segment: TextSegment, match: MemoryReferenceMatch): number =>
  match.citationStart >= segment.start && match.end <= segment.end ? match.citationStart : match.start

const linkFor = (block: Element, segment: TextSegment, match: MemoryReferenceMatch): void => {
  if (segment.node.parentElement?.closest(memoryReferenceSelector) !== null) return
  const link = block.ownerDocument.createElement('span')
  link.setAttribute('data-dshfiles-memory-reference', match.id)
  if (match.range !== undefined) link.setAttribute('data-dshfiles-memory-range', match.range)
  link.setAttribute('role', 'link')
  link.setAttribute('aria-label', `Preview memory ${match.id}${match.range === undefined ? '' : ` #${match.range}`}`)
  link.tabIndex = 0
  const range = block.ownerDocument.createRange()
  range.setStart(segment.node, linkStartFor(segment, match) - segment.start)
  range.setEnd(segment.node, match.end - segment.start)
  try {
    range.surroundContents(link)
  } catch {
    return
  }
}

const markMemoryReferences = (blocks: Iterable<Element>): void => {
  for (const block of blocks) {
    const segments = textSegments(block)
    const text = segments.map(segment => segment.node.textContent ?? '').join('')
    const matches = memoryReferenceMatches(text)
    for (const match of [...matches].reverse()) {
      const segment = segments.find(candidate => match.start >= candidate.start && match.end <= candidate.end)
      if (segment !== undefined) linkFor(block, segment, match)
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

const previewAt = (element: Element): boolean => {
  const id = element.getAttribute('data-dshfiles-memory-reference')
  const range = element.getAttribute('data-dshfiles-memory-range')
  const anchorId = MemoryAnchorModel.idOf(element)
  const rect = element.getBoundingClientRect()
  const anchor = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  const candidate = range === null ? { id, anchorId, anchor } : { id, range, anchorId, anchor }
  const parsed = memoryReferencePreviewRequestSchema.safeParse(candidate)
  if (!parsed.success) return false
  window.dispatchEvent(new CustomEvent(memoryReferencePreviewEvent, { detail: parsed.data }))
  return true
}

const linkFrom = (target: EventTarget | null): Element | null =>
  target instanceof Element && target.closest('[data-composer-card]') === null ? target.closest(memoryReferenceSelector) : null

const onClick = (event: MouseEvent): void => {
  const link = linkFrom(event.target)
  if (link === null || event.button !== 0 || document.getSelection()?.isCollapsed === false) return
  if (previewAt(link)) event.preventDefault()
}

const onKeyDown = (event: KeyboardEvent): void => {
  if (event.key !== 'Enter') return
  const link = linkFrom(event.target)
  if (link !== null && previewAt(link)) event.preventDefault()
}

export const installMemoryReferenceLinks = (): (() => void) => {
  let frame = 0
  const pending = new Set<Element>()
  const observer = new MutationObserver(records => {
    for (const block of dirtyBlocks(records)) pending.add(block)
    if (pending.size === 0 || frame !== 0) return
    frame = requestAnimationFrame(() => {
      frame = 0
      const blocks = [...pending]
      pending.clear()
      markMemoryReferences(blocks)
    })
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  markMemoryReferences(document.querySelectorAll(messageBlocksSelector))
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
