import { CHAT_REFERENCE_PREFIX, ChatReferenceModel, type ChatReference } from './chat-reference.js'

export interface ChatReferenceLinkOptions {
  readonly sessionId: string
  /** Local bookmark names the Session repository really has; other words never become links. */
  readonly bookmarks: readonly string[]
  readonly onOpen: (reference: ChatReference) => void
}

const MARKER = 'data-dshfiles-jj-reference'
const PREFIXED = 'data-dshfiles-jj-prefixed'
const CONVERSATION = '[data-conversation-session]'

const ownConversation = (sessionId: string): Element | null => {
  for (const element of document.querySelectorAll(CONVERSATION)) {
    if (element.getAttribute('data-conversation-session') === sessionId) return element
  }
  return null
}

/**
 * Native renders inline code as inert text, so explicit revision and bookmark tokens become links without replacing
 * React's own nodes. The `jj:` prefix is a writing convention: it is what makes a name explicit, and the reader sees
 * the bare name, so a text node React rewrote is re-stripped on the next pass and one that changed stops being a link.
 */
export const installChatReferenceLinks = (options: ChatReferenceLinkOptions): (() => void) => {
  const referenceIn = (element: Element): ChatReference | undefined =>
    ChatReferenceModel.fromCode({
      value: element.textContent ?? '',
      bookmarks: options.bookmarks,
      prefixed: element.hasAttribute(PREFIXED),
    })
  const unmark = (element: Element): void => {
    element.removeAttribute(MARKER)
    element.removeAttribute(PREFIXED)
    element.removeAttribute('role')
    element.removeAttribute('tabindex')
  }
  const linkOf = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element) || target.closest('[data-composer-card]') !== null) return null
    const code = target.closest('code')
    const conversation = code?.closest(CONVERSATION)
    return code instanceof HTMLElement && conversation?.getAttribute('data-conversation-session') === options.sessionId ? code : null
  }
  const navigate = (element: HTMLElement): boolean => {
    const reference = referenceIn(element)
    if (reference === undefined) return false
    options.onOpen(reference)
    return true
  }
  const onClick = (event: MouseEvent): void => {
    if (event.button !== 0 || document.getSelection()?.isCollapsed === false) return
    const link = linkOf(event.target)
    if (link !== null && navigate(link)) event.preventDefault()
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const link = linkOf(event.target)
    if (link !== null && navigate(link)) event.preventDefault()
  }
  const markLinks = (): void => {
    for (const element of ownConversation(options.sessionId)?.querySelectorAll('code') ?? []) {
      if (element.closest('[data-composer-card]') !== null) continue
      const marked = element.getAttribute(MARKER) === options.sessionId
      const written = element.textContent ?? ''
      if (referenceIn(element) === undefined) {
        if (marked) unmark(element)
        continue
      }
      if (!marked) {
        // Native semantics win: this only ever adds link behaviour to code that carries none.
        if (element.hasAttribute('role') || element.hasAttribute('tabindex')) continue
        element.setAttribute(MARKER, options.sessionId)
        if (written.trim().startsWith(CHAT_REFERENCE_PREFIX)) element.setAttribute(PREFIXED, '')
        element.setAttribute('role', 'link')
        element.setAttribute('tabindex', '0')
      }
      const display = ChatReferenceModel.display(written)
      if (display !== written) element.textContent = display
    }
  }
  let frame = 0
  const observer = new MutationObserver(() => {
    if (frame === 0)
      frame = requestAnimationFrame(() => {
        frame = 0
        markLinks()
      })
  })
  observer.observe(document.body, { childList: true, subtree: true })
  markLinks()
  window.addEventListener('click', onClick)
  window.addEventListener('keydown', onKeyDown)
  return () => {
    observer.disconnect()
    cancelAnimationFrame(frame)
    window.removeEventListener('click', onClick)
    window.removeEventListener('keydown', onKeyDown)
    for (const element of ownConversation(options.sessionId)?.querySelectorAll(`[${MARKER}]`) ?? []) {
      const restorePrefix = element.hasAttribute(PREFIXED)
      unmark(element)
      if (restorePrefix) element.textContent = `${CHAT_REFERENCE_PREFIX}${element.textContent ?? ''}`
    }
  }
}
