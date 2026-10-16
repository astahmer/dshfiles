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

const linkFor = (block: Element, segment: TextSegment, match: MemoryReferenceMatch): void => {
  if (segment.node.parentElement?.closest(memoryReferenceSelector) !== null) return
  const link = block.ownerDocument.createElement('span')
  link.setAttribute('data-dshfiles-memory-reference', match.id)
  if (match.range !== undefined) link.setAttribute('data-dshfiles-memory-range', match.range)
  link.setAttribute('role', 'link')
  link.setAttribute('aria-label', `Preview memory ${match.id}${match.range === undefined ? '' : ` #${match.range}`}`)
  link.tabIndex = 0
  const range = block.ownerDocument.createRange()
  range.setStart(segment.node, match.start - segment.start)
  range.setEnd(segment.node, match.end - segment.start)
  try {
    range.surroundContents(link)
  } catch {
    return
  }
}

const markMemoryReferences = (): void => {
  for (const block of document.querySelectorAll(messageBlocksSelector)) {
    const segments = textSegments(block)
    const text = segments.map(segment => segment.node.textContent ?? '').join('')
    const matches = memoryReferenceMatches(text)
    for (const match of [...matches].reverse()) {
      const segment = segments.find(candidate => match.start >= candidate.start && match.end <= candidate.end)
      if (segment !== undefined) linkFor(block, segment, match)
    }
  }
}

const previewAt = (element: Element): boolean => {
  const id = element.getAttribute('data-dshfiles-memory-reference')
  const range = element.getAttribute('data-dshfiles-memory-range')
  const rect = element.getBoundingClientRect()
  const anchor = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  const candidate = range === null ? { id, anchor } : { id, range, anchor }
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
  const observer = new MutationObserver(() => {
    if (frame !== 0) return
    frame = requestAnimationFrame(() => {
      frame = 0
      markMemoryReferences()
    })
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  markMemoryReferences()
  window.addEventListener('click', onClick)
  window.addEventListener('keydown', onKeyDown)
  return () => {
    observer.disconnect()
    cancelAnimationFrame(frame)
    window.removeEventListener('click', onClick)
    window.removeEventListener('keydown', onKeyDown)
  }
}
