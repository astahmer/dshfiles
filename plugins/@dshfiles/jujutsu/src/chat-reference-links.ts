import {
  CHAT_REFERENCE_PREFIX,
  ChatReferenceModel,
  chatReferencePreviewDismissEvent,
  chatReferencePreviewEvent,
  chatReferencePreviewRequestSchema,
  chatReferenceTitleRequestEvent,
  chatReferenceTitleRequestSchema,
  chatReferenceTitleResolvedEvent,
  chatReferenceTitleResolvedSchema,
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
const SOURCE = 'data-dshfiles-jj-source'
const LABEL = 'data-dshfiles-jj-label'
const TITLE = 'data-dshfiles-jj-title'
const ORIGINAL_ARIA_LABEL = 'data-dshfiles-jj-original-aria-label'
const ORIGINAL_TITLE = 'data-dshfiles-jj-original-title'
const CONVERSATION = '[data-conversation-session]'

const ownConversation = (sessionId: string): Element | null => {
  for (const element of document.querySelectorAll(CONVERSATION)) {
    if (element.getAttribute('data-conversation-session') === sessionId) return element
  }
  return null
}

/** Native inline code becomes an accessible link without replacing React's own nodes. */
export const installChatReferenceLinks = (options: ChatReferenceLinkOptions): (() => void) => {
  const referenceIn = (element: Element): ChatReference | undefined => {
    const text = element.textContent ?? ''
    const source = element.getAttribute(SOURCE)
    const label = element.getAttribute(LABEL)
    const written = source !== null && label === text ? source : text
    return ChatReferenceModel.fromCode({
      value: written,
      bookmarks: options.bookmarks,
      prefixed: written.trim().startsWith(CHAT_REFERENCE_PREFIX) || element.hasAttribute(PREFIXED),
    })
  }
  const unmark = (element: Element): void => {
    const originalAriaLabel = element.getAttribute(ORIGINAL_ARIA_LABEL)
    const originalTitle = element.getAttribute(ORIGINAL_TITLE)
    if (originalAriaLabel === null) element.removeAttribute('aria-label')
    else element.setAttribute('aria-label', originalAriaLabel)
    if (originalTitle === null) element.removeAttribute('title')
    else element.setAttribute('title', originalTitle)
    element.removeAttribute(MARKER)
    element.removeAttribute(PREFIXED)
    element.removeAttribute(SOURCE)
    element.removeAttribute(LABEL)
    element.removeAttribute(TITLE)
    element.removeAttribute(ORIGINAL_ARIA_LABEL)
    element.removeAttribute(ORIGINAL_TITLE)
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
  const referenceKey = (reference: ChatReference): string =>
    `${reference.kind}:${reference.kind === 'revision' ? reference.value.toLocaleLowerCase() : reference.value}`
  const titles = new Map<string, string>()
  const requestedTitles = new Set<string>()
  const setDisplay = (element: Element, source: string, reference: ChatReference, title?: string): void => {
    const fallback = ChatReferenceModel.display(source)
    const label = title === undefined ? fallback : ChatReferenceModel.titleLabel({ title, fallback })
    element.setAttribute(SOURCE, source)
    element.setAttribute(LABEL, label)
    if (title === undefined) {
      element.removeAttribute(TITLE)
      const originalAriaLabel = element.getAttribute(ORIGINAL_ARIA_LABEL)
      if (originalAriaLabel === null) element.removeAttribute('aria-label')
      else element.setAttribute('aria-label', originalAriaLabel)
      const originalTitle = element.getAttribute(ORIGINAL_TITLE)
      if (originalTitle === null) element.removeAttribute('title')
      else element.setAttribute('title', originalTitle)
    } else {
      element.setAttribute(TITLE, title)
      element.setAttribute('title', title)
      const kind = reference.kind === 'revision' ? 'revision' : 'bookmark'
      element.setAttribute('aria-label', `Jujutsu ${kind}: ${title} (${reference.value})`)
    }
    if (element.textContent !== label) element.textContent = label
  }
  const requestTitle = (element: HTMLElement): void => {
    if (element.getAttribute(MARKER) !== options.sessionId) return
    const reference = referenceIn(element)
    if (reference === undefined) return
    const key = referenceKey(reference)
    if (titles.has(key) || requestedTitles.has(key)) return
    const parsed = chatReferenceTitleRequestSchema.safeParse({ sessionId: options.sessionId, cwd: options.cwd, reference })
    if (!parsed.success) return
    requestedTitles.add(key)
    window.dispatchEvent(new CustomEvent(chatReferenceTitleRequestEvent, { detail: parsed.data }))
  }
  let titleObserver: IntersectionObserver | undefined
  const Observer = window.IntersectionObserver
  if (Observer !== undefined) {
    titleObserver = new Observer(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting || !(entry.target instanceof HTMLElement)) continue
          titleObserver?.unobserve(entry.target)
          requestTitle(entry.target)
        }
      },
      { rootMargin: '120px 0px' },
    )
  }
  const observeTitle = (element: HTMLElement): void => {
    const reference = referenceIn(element)
    if (reference === undefined || titles.has(referenceKey(reference))) return
    if (titleObserver === undefined) {
      window.requestAnimationFrame(() => requestTitle(element))
      return
    }
    titleObserver.observe(element)
  }
  const onTitleResolved = (event: Event): void => {
    if (!(event instanceof CustomEvent)) return
    const parsed = chatReferenceTitleResolvedSchema.safeParse(event.detail)
    if (!parsed.success || parsed.data.sessionId !== options.sessionId || parsed.data.cwd !== options.cwd) return
    const key = referenceKey(parsed.data.reference)
    titles.set(key, parsed.data.title)
    for (const element of ownConversation(options.sessionId)?.querySelectorAll(`[${MARKER}]`) ?? []) {
      const reference = referenceIn(element)
      const source = element.getAttribute(SOURCE)
      if (reference === undefined || source === null || referenceKey(reference) !== key) continue
      setDisplay(element, source, reference, parsed.data.title)
    }
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
      const text = element.textContent ?? ''
      const source = element.getAttribute(SOURCE)
      const label = element.getAttribute(LABEL)
      const written = source !== null && label === text ? source : text
      const reference = referenceIn(element)
      if (reference === undefined) {
        if (marked) unmark(element)
        continue
      }
      if (!marked) {
        // Native semantics win: this only ever adds link behaviour to code that carries none.
        if (element.hasAttribute('role') || element.hasAttribute('tabindex')) continue
        if (element.hasAttribute('aria-label')) element.setAttribute(ORIGINAL_ARIA_LABEL, element.getAttribute('aria-label') ?? '')
        if (element.hasAttribute('title')) element.setAttribute(ORIGINAL_TITLE, element.getAttribute('title') ?? '')
        element.setAttribute(MARKER, options.sessionId)
        element.setAttribute('role', 'link')
        element.setAttribute('tabindex', '0')
      }
      if (written.trim().startsWith(CHAT_REFERENCE_PREFIX)) element.setAttribute(PREFIXED, '')
      else element.removeAttribute(PREFIXED)
      const key = referenceKey(reference)
      const previousTitle = source === written && label === text ? (element.getAttribute(TITLE) ?? undefined) : undefined
      const title = titles.get(key) ?? previousTitle
      setDisplay(element, written, reference, title)
      if (element instanceof HTMLElement && title === undefined) observeTitle(element)
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
  window.addEventListener(chatReferenceTitleResolvedEvent, onTitleResolved)
  return () => {
    observer.disconnect()
    titleObserver?.disconnect()
    cancelAnimationFrame(frame)
    cancelPreview()
    window.removeEventListener('click', onClick)
    window.removeEventListener('keydown', onKeyDown)
    window.removeEventListener('pointerover', onPointerOver)
    window.removeEventListener('pointerout', onPointerOut)
    window.removeEventListener('focusin', onFocusIn)
    window.removeEventListener('focusout', onFocusOut)
    window.removeEventListener(chatReferenceTitleResolvedEvent, onTitleResolved)
    for (const element of ownConversation(options.sessionId)?.querySelectorAll(`[${MARKER}]`) ?? []) {
      const source = element.getAttribute(SOURCE)
      const label = element.getAttribute(LABEL)
      if (source !== null && label === (element.textContent ?? '')) element.textContent = source
      else if (element.hasAttribute(PREFIXED) && !(element.textContent ?? '').trim().startsWith(CHAT_REFERENCE_PREFIX)) {
        element.textContent = `${CHAT_REFERENCE_PREFIX}${element.textContent ?? ''}`
      }
      unmark(element)
    }
  }
}
