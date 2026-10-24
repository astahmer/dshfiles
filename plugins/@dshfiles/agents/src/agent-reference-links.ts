import { AgentAnchorModel } from './agent-anchor.js'
import {
  agentReferenceMatches,
  agentReferenceLabel,
  agentReferencePreviewEvent,
  agentReferencePreviewRequestSchema,
  type AgentReferenceMatch,
} from './agent-reference.js'

const referenceSelector = '[data-dshfiles-agent-reference]'
/** Inline code holds a written mention; a fenced block holds an example, and links already carry their own target. */
const ignoredTextSelector = `a, button, pre, [role="link"]:not(${referenceSelector}), [data-composer-card], [data-ref-chip], [data-dshfiles-agent-preview], ${referenceSelector}`
const markdownBlocks = ['p', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td']
const messageBlocksSelector = [
  '[data-conversation-session] [class*="_userRow"] [class*="_bubble"]',
  ...markdownBlocks.map(block => `[data-conversation-session] ${block}`),
  // A backlog comment and every other compact Markdown surface (an item body, a preview card).
  ...markdownBlocks.map(block => `[data-markdown-variant] ${block}`),
].join(', ')

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

const linkFor = (block: Element, segment: TextSegment, match: AgentReferenceMatch): void => {
  const link = block.ownerDocument.createElement('span')
  link.setAttribute('data-dshfiles-agent-reference', match.handle)
  link.setAttribute('role', 'link')
  link.setAttribute('aria-label', `Preview agent ${agentReferenceLabel(match.handle)}`)
  link.tabIndex = 0
  AgentAnchorModel.idOf(link)
  const range = block.ownerDocument.createRange()
  range.setStart(segment.node, match.start - segment.start)
  range.setEnd(segment.node, match.end - segment.start)
  try {
    range.surroundContents(link)
  } catch {
    return
  }
}

const markReferences = (blocks: Iterable<Element>, handles: ReadonlySet<string>): void => {
  for (const block of blocks) {
    const segments = textSegments(block)
    const text = segments.map(segment => segment.node.textContent ?? '').join('')
    const matches = agentReferenceMatches(text, handles)
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

/** Ask the shared card to show one agent above an element the caller rendered itself. */
export const previewAgentReference = (handle: string, element: Element): boolean => {
  const rect = element.getBoundingClientRect()
  const anchor = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  const parsed = agentReferencePreviewRequestSchema.safeParse({ handle, anchorId: AgentAnchorModel.idOf(element), anchor })
  if (!parsed.success) return false
  window.dispatchEvent(new CustomEvent(agentReferencePreviewEvent, { detail: parsed.data }))
  return true
}

/**
 * A sent user message renders `@handle` through the native file-mention rule, as an inert file chip whose title is the
 * original `@mention`. It names an agent when the title is exactly one, so the same card serves both spellings.
 */
const nativeMentionSelector = '[data-conversation-session] [data-ref-chip="file"]'
const AGENT_MENTION_TITLE = /^@([a-z][a-z0-9-]{0,31})$/u

const handleOfChip = (element: Element, handles: ReadonlySet<string>): string | undefined => {
  const handle = AGENT_MENTION_TITLE.exec(element.getAttribute('title') ?? '')?.[1]
  return handle !== undefined && handles.has(handle) ? handle : undefined
}

type Link = { readonly element: Element; readonly handle: string }

const linkFrom = (target: EventTarget | null, handles: ReadonlySet<string>): Link | null => {
  if (!(target instanceof Element) || target.closest('[data-composer-card]') !== null) return null
  const reference = target.closest(referenceSelector)
  if (reference !== null) return { element: reference, handle: reference.getAttribute('data-dshfiles-agent-reference') ?? '' }
  const chip = target.closest(nativeMentionSelector)
  if (chip === null) return null
  const handle = handleOfChip(chip, handles)
  return handle === undefined ? null : { element: chip, handle }
}

const onClick = (event: MouseEvent, handles: () => ReadonlySet<string>): void => {
  const link = linkFrom(event.target, handles())
  if (link === null || event.button !== 0 || document.getSelection()?.isCollapsed === false) return
  event.preventDefault()
  // A chip is the conversation's own button: stop its inert default instead of letting it swallow the card.
  event.stopPropagation()
  previewAgentReference(link.handle, link.element)
}

const onKeyDown = (event: KeyboardEvent, handles: () => ReadonlySet<string>): void => {
  if (event.key !== 'Enter' && event.key !== ' ') return
  const link = linkFrom(event.target, handles())
  if (link === null) return
  event.preventDefault()
  event.stopPropagation()
  previewAgentReference(link.handle, link.element)
}

/** `handles` is read on every pass, so an agent saved in the panel decorates the next message without a reinstall. */
export const installAgentReferenceLinks = (options: { readonly handles: () => ReadonlySet<string> }): (() => void) => {
  let frame = 0
  const pending = new Set<Element>()
  const observer = new MutationObserver(records => {
    for (const block of dirtyBlocks(records)) pending.add(block)
    if (pending.size === 0 || frame !== 0) return
    frame = requestAnimationFrame(() => {
      frame = 0
      const blocks = [...pending]
      pending.clear()
      markReferences(blocks, options.handles())
    })
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  markReferences(document.querySelectorAll(messageBlocksSelector), options.handles())
  // That first pass wrote the links already, so drop its records instead of rescanning them.
  observer.takeRecords()
  const click = (event: MouseEvent): void => onClick(event, options.handles)
  const keyDown = (event: KeyboardEvent): void => onKeyDown(event, options.handles)
  // Capture, so a chip's own button never runs its default and a mention scrolls the card with the message.
  window.addEventListener('click', click, true)
  window.addEventListener('keydown', keyDown, true)
  return () => {
    observer.disconnect()
    cancelAnimationFrame(frame)
    window.removeEventListener('click', click, true)
    window.removeEventListener('keydown', keyDown, true)
  }
}
