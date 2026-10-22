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
  /** The Session repository is checked first; registered project repositories are searched on a miss. */
  readonly cwd: string
  readonly onOpen: (reference: ChatReference, targetPath?: string) => void
}

/** A pointer sweeping across a line of text should not flash a card, so hovering waits. */
const PREVIEW_OPEN_DELAY_MS = 160

const OWNER = 'data-dshfiles-jj-reference-owner'
const CHIP = 'data-dshfiles-jj-reference'
const CHIP_LABEL = 'data-dshfiles-jj-reference-label'
const CHIP_SELECTOR = `[${CHIP}]`
const CHIP_LABEL_SELECTOR = `[${CHIP_LABEL}]`
const REFERENCE_CHIP_TEMPLATE = '[data-dshfiles-jj-reference-template] [data-ref-chip="session"]'
const REFERENCE_CHIP_TEMPLATE_WRAPPER = '[data-dshfiles-jj-reference-template]'
const PREFIXED = 'data-dshfiles-jj-prefixed'
const SOURCE = 'data-dshfiles-jj-source'
const LABEL = 'data-dshfiles-jj-label'
const TITLE = 'data-dshfiles-jj-title'
const CONVERSATION = '[data-conversation-session]'

const ownConversation = (sessionId: string): Element | null => {
  for (const element of document.querySelectorAll(CONVERSATION)) {
    if (element.getAttribute('data-conversation-session') === sessionId) return element
  }
  return null
}

/** Decorate native inline code with the same reference chip used for session links. */
export const installChatReferenceLinks = (options: ChatReferenceLinkOptions): (() => void) => {
  const displayLabelIn = (element: Element): string =>
    element.querySelector<HTMLElement>(`${CHIP_SELECTOR} ${CHIP_LABEL_SELECTOR}`)?.textContent ?? element.textContent ?? ''
  const referenceIn = (element: Element): ChatReference | undefined => {
    const text = displayLabelIn(element)
    const source = element.getAttribute(SOURCE)
    const label = element.getAttribute(LABEL)
    const written = source !== null && label === text ? source : text
    return ChatReferenceModel.fromCode({
      value: written,
      bookmarks: options.bookmarks,
      prefixed: written.trim().startsWith(CHAT_REFERENCE_PREFIX) || element.hasAttribute(PREFIXED),
    })
  }
  const createChip = (): HTMLElement => {
    const template = document.querySelector<HTMLElement>(REFERENCE_CHIP_TEMPLATE)
    const chip = document.createElement('span')
    if (template !== null) chip.className = template.className
    const icon = template?.querySelector('svg')
    if (icon !== null && icon !== undefined) chip.append(icon.cloneNode(true))
    const label = document.createElement('span')
    label.setAttribute(CHIP_LABEL, '')
    chip.setAttribute(CHIP, '')
    chip.setAttribute('role', 'link')
    chip.setAttribute('tabindex', '0')
    chip.append(label)
    return chip
  }
  const displayChipIn = (element: Element): HTMLElement => {
    const chip = element.querySelector<HTMLElement>(CHIP_SELECTOR)
    const label = chip?.querySelector<HTMLElement>(CHIP_LABEL_SELECTOR)
    const template = document.querySelector<HTMLElement>(REFERENCE_CHIP_TEMPLATE)
    const templateIcon = template?.querySelector('svg')
    const missingNativePresentation =
      template !== null && (chip?.className !== template.className || (templateIcon !== null && chip?.querySelector('svg') === null))
    if (chip !== null && label !== null && !missingNativePresentation) return chip
    const next = createChip()
    element.replaceChildren(next)
    return next
  }
  const unmark = (element: Element): void => {
    const source = element.getAttribute(SOURCE)
    const label = element.getAttribute(LABEL)
    if (source !== null && label === displayLabelIn(element)) element.textContent = source
    else element.querySelector(CHIP_SELECTOR)?.remove()
    element.removeAttribute(OWNER)
    element.removeAttribute(PREFIXED)
    element.removeAttribute(SOURCE)
    element.removeAttribute(LABEL)
    element.removeAttribute(TITLE)
  }
  const linkOf = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element) || target.closest('[data-composer-card]') !== null) return null
    const chip = target.closest(CHIP_SELECTOR)
    const code = chip?.closest('code')
    const conversation = code?.closest(CONVERSATION)
    return chip instanceof HTMLElement && conversation?.getAttribute('data-conversation-session') === options.sessionId ? chip : null
  }
  const navigate = (element: HTMLElement): boolean => {
    const code = element.closest('code')
    const reference = code === null ? undefined : referenceIn(code)
    if (reference === undefined) return false
    const key = referenceKey(reference)
    if (!elementPaths.has(key)) {
      pendingOpens.add(key)
      requestTitle(element)
      return true
    }
    const targetPath = elementPaths.get(key)
    if (targetPath !== null && targetPath !== undefined) options.onOpen(reference, targetPath)
    return true
  }
  const previewAt = (element: HTMLElement): boolean => {
    const code = element.closest('code')
    const reference = code === null ? undefined : referenceIn(code)
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
  const elementPaths = new Map<string, string | null>()
  const pendingOpens = new Set<string>()
  const requestedTitles = new Set<string>()
  const setDisplay = (element: Element, source: string, reference: ChatReference, title?: string): void => {
    const fallback = ChatReferenceModel.display(source)
    const label = title === undefined ? fallback : ChatReferenceModel.titleLabel({ title, fallback })
    const chip = displayChipIn(element)
    const chipLabel = chip.querySelector<HTMLElement>(CHIP_LABEL_SELECTOR)
    const kind = reference.kind === 'revision' ? 'revision' : 'bookmark'
    element.setAttribute(SOURCE, source)
    element.setAttribute(LABEL, label)
    if (chipLabel !== null && chipLabel.textContent !== label) chipLabel.textContent = label
    if (title === undefined) {
      element.removeAttribute(TITLE)
      chip.setAttribute('title', reference.value)
      chip.setAttribute('aria-label', `Jujutsu ${kind}: ${reference.value}`)
    } else {
      element.setAttribute(TITLE, title)
      chip.setAttribute('title', title)
      chip.setAttribute('aria-label', `Jujutsu ${kind}: ${title} (${reference.value})`)
    }
  }
  const requestTitle = (element: HTMLElement): void => {
    if (element.getAttribute(OWNER) !== options.sessionId) return
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
    const targetPath = parsed.data.targetPath === undefined ? options.cwd : parsed.data.targetPath
    elementPaths.set(key, targetPath)
    if (pendingOpens.delete(key) && targetPath !== null) options.onOpen(parsed.data.reference, targetPath)
    for (const element of ownConversation(options.sessionId)?.querySelectorAll(`[${OWNER}]`) ?? []) {
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
      const marked = element.getAttribute(OWNER) === options.sessionId
      const text = displayLabelIn(element)
      const source = element.getAttribute(SOURCE)
      const label = element.getAttribute(LABEL)
      const written = source !== null && label === text ? source : text
      const reference = referenceIn(element)
      if (reference === undefined) {
        if (marked) unmark(element)
        continue
      }
      if (!marked) {
        if (element.hasAttribute('role') || element.hasAttribute('tabindex')) continue
        element.setAttribute(OWNER, options.sessionId)
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
    const templateAdded = records.some(record =>
      [...record.addedNodes].some(
        node => node instanceof Element && (node.matches(REFERENCE_CHIP_TEMPLATE_WRAPPER) || node.querySelector(REFERENCE_CHIP_TEMPLATE) !== null),
      ),
    )
    if (templateAdded) {
      for (const code of ownConversation(options.sessionId)?.querySelectorAll('code') ?? []) pending.add(code)
    }
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
    for (const element of ownConversation(options.sessionId)?.querySelectorAll(`[${OWNER}]`) ?? []) unmark(element)
  }
}
