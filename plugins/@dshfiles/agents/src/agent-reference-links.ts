import { Option } from 'effect'

import { AgentAnchorModel } from './agent-anchor.js'
import { AgentReference } from './agent-reference.js'

/** Ask the shared card to show one agent above an element the caller rendered itself. */
export const previewAgentReference = (handle: string, element: Element): boolean => {
  const rect = element.getBoundingClientRect()
  const anchor = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
  const parsed = AgentReference.decodePreviewRequest({ handle, anchorId: AgentAnchorModel.idOf(element), anchor })
  if (Option.isNone(parsed)) return false
  window.dispatchEvent(new CustomEvent(AgentReference.previewEvent, { detail: parsed.value }))
  return true
}

/**
 * A sent user message renders `@handle` through the native file-mention rule, as an inert file chip whose title is the
 * original `@mention`. It names an agent when the title is exactly one, so the same card serves both spellings. Written
 * mentions in answers and comments are Chat inline references (`agent-inline-reference.tsx`); this only listens for
 * activation of the native chip and never changes the transcript.
 */
const nativeMentionSelector = '[data-conversation-session] [data-ref-chip="file"]'
const AGENT_MENTION_TITLE = /^@([a-z][a-z0-9-]{0,31})$/u

const chipHandle = (target: EventTarget | null, handles: ReadonlySet<string>): { readonly element: Element; readonly handle: string } | null => {
  if (!(target instanceof Element) || target.closest('[data-composer-card]') !== null) return null
  const chip = target.closest(nativeMentionSelector)
  const handle = AGENT_MENTION_TITLE.exec(chip?.getAttribute('title') ?? '')?.[1]
  return chip === null || handle === undefined || !handles.has(handle) ? null : { element: chip, handle }
}

/** `handles` is read on every gesture, so an agent saved in the panel opens from the next click without a reinstall. */
export const installAgentMentionChips = (options: { readonly handles: () => ReadonlySet<string> }): (() => void) => {
  const activate = (event: Event, chip: { readonly element: Element; readonly handle: string }): void => {
    event.preventDefault()
    // A chip is the conversation's own button: stop its inert default instead of letting it swallow the card.
    event.stopPropagation()
    previewAgentReference(chip.handle, chip.element)
  }
  const click = (event: MouseEvent): void => {
    const chip = chipHandle(event.target, options.handles())
    if (chip === null || event.button !== 0 || document.getSelection()?.isCollapsed === false) return
    activate(event, chip)
  }
  const keyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const chip = chipHandle(event.target, options.handles())
    if (chip !== null) activate(event, chip)
  }
  // Capture, so the chip's own button never runs its default.
  window.addEventListener('click', click, true)
  window.addEventListener('keydown', keyDown, true)
  return () => {
    window.removeEventListener('click', click, true)
    window.removeEventListener('keydown', keyDown, true)
  }
}
