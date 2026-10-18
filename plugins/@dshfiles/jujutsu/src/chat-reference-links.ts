import {
  CHAT_REFERENCE_PREFIX,
  ChatReferenceModel,
  chatReferencePreviewDismissEvent,
  chatReferencePreviewEvent,
  chatReferencePreviewRequestSchema,
  type ChatReference,
} from './chat-reference.js'

export interface ChatReferenceLinkOptions {
  readonly sessionId: string
  /** Local bookmark names the Session repository really has; other words never become links. */
  readonly bookmarks: readonly string[]
  /** The Session repository the preview reads: the Host turns this path into a repoId. */
  readonly cwd: string
  readonly onOpen: (reference: ChatReference) => void
}

/** A pointer sweeping across a line of text should not flash a card, so hovering waits. */
const PREVIEW_OPEN_DELAY_MS = 160

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
  const previewAt = (element: HTMLElement): boolean => {
    const reference = referenceIn(element)
    if (reference === undefined) return false
    const rect = element.getBoundingClientRect()
    const parsed = chatReferencePreviewRequestSchema.safeParse({
      cwd: options.cwd,
      reference,
      anchor: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    })
    if (!parsed.success) return false
    window.dispatchEvent(new CustomEvent(chatReferencePreviewEvent, { detail: parsed.data }))
    return true
  }
  let openTimer: number | undefined
  let hovered: HTMLElement | null = null
  const cancelPreview = (): void => {
    if (openTimer === undefined) return
    window.clearTimeout(openTimer)
    openTimer = undefined
  }
  const dismissPreview = (): void => {
    hovered = null
    cancelPreview()
    window.dispatchEvent(new Event(chatReferencePreviewDismissEvent))
  }
  const onPointerOver = (event: PointerEvent): void => {
    const link = linkOf(event.target)
    if (link === null || link === hovered) return
    hovered = link
    cancelPreview()
    openTimer = window.setTimeout(() => {
      openTimer = undefined
      previewAt(link)
    }, PREVIEW_OPEN_DELAY_MS)
  }
  const onPointerOut = (event: PointerEvent): void => {
    const link = linkOf(event.target)
    if (link === null || link !== hovered) return
    if (event.relatedTarget instanceof Node && link.contains(event.relatedTarget)) return
    dismissPreview()
  }
  const onFocusIn = (event: FocusEvent): void => {
    const link = linkOf(event.target)
    if (link !== null) previewAt(link)
  }
  const onFocusOut = (event: FocusEvent): void => {
    if (linkOf(event.target) !== null) dismissPreview()
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
  const markLinks = (codes: Iterable<Element>): void => {
    for (const element of codes) {
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
  /** A code element this installer owns: it belongs to the Session's own conversation. */
  const isOwnCode = (element: Element): boolean => element.closest(CONVERSATION)?.getAttribute('data-conversation-session') === options.sessionId
  /**
   * The code elements a batch of mutation records can have changed. Rescanning only these keeps
   * streaming decoration proportional to the new tokens instead of to the loaded transcript.
   */
  const dirtyCodes = (records: readonly MutationRecord[]): readonly Element[] => {
    const codes = new Set<Element>()
    const add = (node: Node | null): void => {
      const element = node instanceof Element ? node : (node?.parentElement ?? null)
      if (element === null) return
      const own = element.closest('code')
      if (own !== null && isOwnCode(own)) codes.add(own)
      for (const nested of element.querySelectorAll('code')) if (isOwnCode(nested)) codes.add(nested)
    }
    for (const record of records) {
      if (record.type === 'characterData') {
        add(record.target)
        continue
      }
      for (const node of record.addedNodes) add(node)
      // A replaced child list changes that code's text; a replaced transcript reports its container.
      add(record.target)
    }
    return [...codes]
  }
  let frame = 0
  const pending = new Set<Element>()
  const observer = new MutationObserver(records => {
    for (const element of dirtyCodes(records)) pending.add(element)
    if (pending.size === 0 || frame !== 0) return
    frame = requestAnimationFrame(() => {
      frame = 0
      const codes = [...pending]
      pending.clear()
      markLinks(codes)
    })
  })
  observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  markLinks(ownConversation(options.sessionId)?.querySelectorAll('code') ?? [])
  // That first pass marked what it found, so drop its records instead of rescanning them.
  observer.takeRecords()
  window.addEventListener('click', onClick)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('pointerover', onPointerOver)
  window.addEventListener('pointerout', onPointerOut)
  window.addEventListener('focusin', onFocusIn)
  window.addEventListener('focusout', onFocusOut)
  return () => {
    observer.disconnect()
    cancelAnimationFrame(frame)
    cancelPreview()
    window.removeEventListener('click', onClick)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('pointerover', onPointerOver)
    window.removeEventListener('pointerout', onPointerOut)
    window.removeEventListener('focusin', onFocusIn)
    window.removeEventListener('focusout', onFocusOut)
    for (const element of ownConversation(options.sessionId)?.querySelectorAll(`[${MARKER}]`) ?? []) {
      const restorePrefix = element.hasAttribute(PREFIXED)
      unmark(element)
      if (restorePrefix) element.textContent = `${CHAT_REFERENCE_PREFIX}${element.textContent ?? ''}`
    }
  }
}
