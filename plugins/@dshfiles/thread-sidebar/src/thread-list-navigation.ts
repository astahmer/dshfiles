import { THREAD_MAIN_BUTTON_SELECTOR, THREAD_SECTION_HEADER_SELECTOR, ThreadSelectionModel, type ThreadSelectionState } from './thread-selection.js'

interface VisibleThreadRow {
  readonly id: string
  readonly button: HTMLButtonElement
}

type ThreadNavigationDirection = -1 | 1

interface ThreadListNavigationInput {
  readonly event: KeyboardEvent
  readonly list: HTMLElement
  readonly selection: ThreadSelectionState
  readonly onSelectionChange: (selection: ThreadSelectionState) => void
  readonly onLookahead: (sessionIds: readonly string[]) => void
  /** Up/Down opens the focused thread immediately; absent keeps focus-only navigation. */
  readonly arrowKeysSwitchThread?: boolean
  readonly open?: (sessionId: string) => void
}

interface SessionHistoryReference {
  readonly ready: Promise<unknown>
  release(): void
}

interface RetainThreadHistoryLookaheadInput<SessionId extends string> {
  readonly sessionIds: readonly SessionId[]
  readonly retain: (sessionId: SessionId, signal: AbortSignal) => SessionHistoryReference
}

const EDITABLE_TARGET_SELECTOR = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]'
const MENU_TARGET_SELECTOR = '[role="menu"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="listbox"],[role="option"]'
const MAX_LOOKAHEAD_SESSIONS = 3
const THREAD_LIST_VIEW_BUTTON_SELECTOR = 'button[data-thread-list-view-button]'
const navigationDirection = (key: string): ThreadNavigationDirection | undefined => {
  switch (key) {
    case 'ArrowDown':
    case 'End':
      return 1
    case 'ArrowUp':
    case 'Home':
      return -1
    default:
      return undefined
  }
}

const isExpanded = (element: Element): boolean => element.getAttribute('aria-expanded') === 'true'

const isRendered = (button: HTMLElement): boolean => {
  let ancestor: HTMLElement | null = button
  while (ancestor !== null) {
    if (ancestor.hidden || ancestor.hasAttribute('inert') || ancestor.getAttribute('aria-hidden') === 'true') return false
    const style = ancestor.ownerDocument.defaultView?.getComputedStyle(ancestor)
    if (style?.display === 'none' || style?.visibility === 'hidden' || style?.visibility === 'collapse') return false
    ancestor = ancestor.parentElement
  }
  return true
}

const ownArticle = (button: HTMLButtonElement): HTMLElement | null => button.closest<HTMLElement>('article[data-thread-id]')

/** The row a focused child button sits under, or null for a top-level row. */
const parentRowButton = (button: HTMLButtonElement): HTMLButtonElement | null => {
  const article = ownArticle(button)
  const articleButton = article?.querySelector<HTMLButtonElement>(THREAD_MAIN_BUTTON_SELECTOR)
  return articleButton === undefined || articleButton === null || articleButton === button ? null : articleButton
}

const sectionHeaderOf = (button: HTMLButtonElement): HTMLButtonElement | null => {
  const section = button.closest('section')
  return section?.querySelector<HTMLButtonElement>(THREAD_SECTION_HEADER_SELECTOR) ?? null
}

export class ThreadListNavigationModel {
  static visibleRows(list: HTMLElement): VisibleThreadRow[] {
    return Array.from(list.querySelectorAll<HTMLButtonElement>(THREAD_MAIN_BUTTON_SELECTOR)).flatMap(button => {
      const id = button.dataset.threadId
      if (id === undefined || id.length === 0 || button.disabled || !isRendered(button)) return []
      return [{ id, button }]
    })
  }

  static lookahead(input: { readonly rows: readonly VisibleThreadRow[]; readonly index: number; readonly direction: ThreadNavigationDirection }): string[] {
    if (input.rows[input.index] === undefined) return []
    const sessionIds: string[] = []
    const seen = new Set<string>()
    for (let offset = 0; offset < MAX_LOOKAHEAD_SESSIONS; offset += 1) {
      const row = input.rows[input.index + offset * input.direction]
      if (row === undefined) break
      if (seen.has(row.id)) continue
      seen.add(row.id)
      sessionIds.push(row.id)
    }
    return sessionIds
  }

  private static focusRow(input: {
    readonly rows: readonly VisibleThreadRow[]
    readonly index: number
    readonly direction: ThreadNavigationDirection
    readonly selection: ThreadSelectionState
    readonly extend: boolean
    readonly fallbackAnchorId: string
    readonly onSelectionChange: (selection: ThreadSelectionState) => void
    readonly onLookahead: (sessionIds: readonly string[]) => void
    readonly switchThread: boolean
    readonly open: ((sessionId: string) => void) | undefined
    readonly list: HTMLElement
  }): boolean {
    const row = input.rows[input.index]
    if (row === undefined) return false
    if (input.extend) {
      input.onSelectionChange(
        ThreadSelectionModel.extend({
          state: input.selection,
          orderedIds: input.rows.map(candidate => candidate.id),
          sessionId: row.id,
          fallbackAnchorId: input.fallbackAnchorId,
        }),
      )
    } else if (input.selection.sessionIds.length > 0) {
      input.onSelectionChange(ThreadSelectionModel.empty())
    }
    row.button.focus()
    input.onLookahead(ThreadListNavigationModel.lookahead({ rows: input.rows, index: input.index, direction: input.direction }))
    if (input.switchThread) {
      input.open?.(row.id)
      const view = input.list.ownerDocument.defaultView
      view?.requestAnimationFrame?.(() => {
        const restored = ThreadListNavigationModel.visibleRows(input.list).find(candidate => candidate.id === row.id)
        restored?.button.focus()
      })
    }
    return true
  }

  static navigate(input: ThreadListNavigationInput): void {
    const { event } = input
    if (event.defaultPrevented || event.isComposing || event.altKey) return
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest(EDITABLE_TARGET_SELECTOR) !== null || target.closest(MENU_TARGET_SELECTOR) !== null) return

    const primaryModifier = event.metaKey || event.ctrlKey
    if (primaryModifier && event.key.toLowerCase() === 'a') {
      const rows = ThreadListNavigationModel.visibleRows(input.list)
      if (rows.length === 0) return
      event.preventDefault()
      input.onSelectionChange(ThreadSelectionModel.selectAll(rows.map(row => row.id)))
      return
    }
    if (primaryModifier) return

    const viewButton = target.closest<HTMLButtonElement>(THREAD_LIST_VIEW_BUTTON_SELECTOR)
    if (viewButton !== null) {
      const focusedElement = input.list.ownerDocument.activeElement
      if (focusedElement === null || !viewButton.contains(focusedElement)) return
      const direction = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : undefined
      if (direction === undefined) return
      const rows = ThreadListNavigationModel.visibleRows(input.list)
      const index = direction === 1 ? 0 : rows.length - 1
      const row = rows[index]
      if (row === undefined) return
      event.preventDefault()
      ThreadListNavigationModel.focusRow({
        rows,
        index,
        direction,
        selection: input.selection,
        extend: event.shiftKey,
        fallbackAnchorId: row.id,
        onSelectionChange: input.onSelectionChange,
        onLookahead: input.onLookahead,
        switchThread: input.arrowKeysSwitchThread === true && !event.shiftKey,
        open: input.open,
        list: input.list,
      })
      return
    }

    const header = target.closest<HTMLButtonElement>(THREAD_SECTION_HEADER_SELECTOR)
    if (header !== null && input.list.contains(header)) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      const expanded = isExpanded(header)
      if ((event.key === 'ArrowLeft' && !expanded) || (event.key === 'ArrowRight' && expanded)) return
      event.preventDefault()
      header.click()
      return
    }

    const activeButton = target.closest<HTMLButtonElement>(THREAD_MAIN_BUTTON_SELECTOR)
    const focusedElement = input.list.ownerDocument.activeElement
    if (activeButton === null || focusedElement === null || !activeButton.contains(focusedElement) || !input.list.contains(activeButton)) return

    if (event.key === 'Escape') {
      if (input.selection.sessionIds.length === 0) return
      event.preventDefault()
      input.onSelectionChange(ThreadSelectionModel.empty())
      return
    }

    const rows = ThreadListNavigationModel.visibleRows(input.list)
    const activeIndex = rows.findIndex(row => row.button === activeButton)
    if (activeIndex < 0) return

    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (event.shiftKey) return
      if (event.key === 'ArrowRight') {
        const article = ownArticle(activeButton)
        const toggle = article?.querySelector<HTMLButtonElement>('[data-thread-children-toggle]') ?? null
        if (toggle === null || toggle.disabled) return
        event.preventDefault()
        if (!isExpanded(toggle)) {
          toggle.click()
          return
        }
        const nextRow = rows[activeIndex + 1]
        if (nextRow !== undefined && article?.contains(nextRow.button) === true) {
          nextRow.button.focus()
          input.onLookahead(ThreadListNavigationModel.lookahead({ rows, index: activeIndex + 1, direction: 1 }))
        }
        return
      }

      event.preventDefault()
      const parentButton = parentRowButton(activeButton)
      if (parentButton !== null) {
        parentButton.focus()
        return
      }
      const toggle = ownArticle(activeButton)?.querySelector<HTMLButtonElement>('[data-thread-children-toggle]') ?? null
      if (toggle !== null && isExpanded(toggle)) {
        toggle.click()
        return
      }
      const header = sectionHeaderOf(activeButton)
      if (header !== null) header.focus()
      return
    }

    const direction = navigationDirection(event.key)
    if (direction === undefined) return

    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, activeIndex + direction))
    if (nextIndex === activeIndex && !event.shiftKey) {
      event.preventDefault()
      return
    }
    event.preventDefault()
    const moved = ThreadListNavigationModel.focusRow({
      rows,
      index: nextIndex,
      direction,
      selection: input.selection,
      extend: event.shiftKey,
      fallbackAnchorId: activeButton.dataset.threadId ?? rows[activeIndex]?.id ?? '',
      onSelectionChange: input.onSelectionChange,
      onLookahead: input.onLookahead,
      switchThread: input.arrowKeysSwitchThread === true && !event.shiftKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp'),
      open: input.open,
      list: input.list,
    })
    if (moved) return
  }

  static retainLookahead<SessionId extends string>(input: RetainThreadHistoryLookaheadInput<SessionId>): () => void {
    const controller = new AbortController()
    const references: SessionHistoryReference[] = []
    const seen = new Set<SessionId>()
    let candidateCount = 0
    for (const sessionId of input.sessionIds) {
      if (seen.has(sessionId)) continue
      seen.add(sessionId)
      candidateCount += 1
      if (candidateCount > MAX_LOOKAHEAD_SESSIONS) break
      let reference: SessionHistoryReference
      try {
        reference = input.retain(sessionId, controller.signal)
      } catch {
        continue
      }
      references.push(reference)
      void reference.ready.catch(() => undefined)
    }

    let released = false
    return () => {
      if (released) return
      released = true
      controller.abort()
      for (const reference of references) reference.release()
    }
  }
}
