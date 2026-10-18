interface VisibleThreadRow {
  readonly id: string
  readonly button: HTMLButtonElement
}

type ThreadNavigationDirection = -1 | 1

interface ThreadListNavigationInput {
  readonly event: KeyboardEvent
  readonly list: HTMLElement
  readonly open: (sessionId: string) => void
  readonly onLookahead: (sessionIds: readonly string[]) => void
}

interface SessionHistoryReference {
  readonly ready: Promise<unknown>
  release(): void
}

interface RetainThreadHistoryLookaheadInput<SessionId extends string> {
  readonly sessionIds: readonly SessionId[]
  readonly retain: (sessionId: SessionId, signal: AbortSignal) => SessionHistoryReference
}

const THREAD_MAIN_BUTTON_SELECTOR = 'button[data-thread-main-action][data-thread-id]'
const EDITABLE_TARGET_SELECTOR = 'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"]'
const MENU_TARGET_SELECTOR = '[role="menu"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="listbox"],[role="option"]'
const MAX_LOOKAHEAD_SESSIONS = 3

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

  static navigate(input: ThreadListNavigationInput): void {
    const direction = input.event.key === 'ArrowDown' ? 1 : input.event.key === 'ArrowUp' ? -1 : null
    if (
      direction === null ||
      input.event.defaultPrevented ||
      input.event.altKey ||
      input.event.ctrlKey ||
      input.event.metaKey ||
      input.event.shiftKey ||
      input.event.isComposing
    )
      return

    const target = input.event.target
    if (!(target instanceof Element)) return
    if (target.closest(EDITABLE_TARGET_SELECTOR) !== null || target.closest(MENU_TARGET_SELECTOR) !== null) return
    const activeButton = target.closest<HTMLButtonElement>(THREAD_MAIN_BUTTON_SELECTOR)
    const focusedElement = input.list.ownerDocument.activeElement
    if (activeButton === null || focusedElement === null || !activeButton.contains(focusedElement) || !input.list.contains(activeButton)) return

    const rows = ThreadListNavigationModel.visibleRows(input.list)
    const activeIndex = rows.findIndex(row => row.button === activeButton)
    if (activeIndex < 0) return
    input.event.preventDefault()

    const nextIndex = Math.max(0, Math.min(rows.length - 1, activeIndex + direction))
    if (nextIndex === activeIndex) return
    const nextRow = rows[nextIndex]
    if (nextRow === undefined) return

    nextRow.button.focus()
    input.open(nextRow.id)
    input.onLookahead(ThreadListNavigationModel.lookahead({ rows, index: nextIndex, direction }))
    const view = input.list.ownerDocument.defaultView
    view?.requestAnimationFrame?.(() => {
      const row = ThreadListNavigationModel.visibleRows(input.list).find(candidate => candidate.id === nextRow.id)
      row?.button.focus()
    })
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
