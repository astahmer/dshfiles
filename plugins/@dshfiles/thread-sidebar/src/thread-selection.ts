export const THREAD_MAIN_BUTTON_SELECTOR = 'button[data-thread-main-action][data-thread-id]'
export const THREAD_SECTION_HEADER_SELECTOR = 'button[data-thread-section-header]'

export const isThreadSelectionBackgroundClick = (input: { readonly target: Element; readonly surface: HTMLElement }): boolean => {
  if (input.target.closest('[role="menu"],[role="menuitem"],[role="menuitemcheckbox"],[role="menuitemradio"],[role="dialog"]') !== null) return false
  const rowButton = input.target.closest<HTMLButtonElement>(THREAD_MAIN_BUTTON_SELECTOR)
  return rowButton === null || !input.surface.contains(rowButton)
}

export interface ThreadSelectionState {
  /** Selected thread ids in the order they were selected; never duplicated. */
  readonly sessionIds: readonly string[]
  /** Row a Shift range starts from: the last row clicked, toggled, or selected. */
  readonly anchorId: string | undefined
}

export const EMPTY_THREAD_SELECTION: ThreadSelectionState = { sessionIds: [], anchorId: undefined }

const stateOf = (sessionIds: readonly string[], anchorId: string | undefined): ThreadSelectionState => ({ sessionIds, anchorId })

export class ThreadSelectionModel {
  static readonly empty = (): ThreadSelectionState => EMPTY_THREAD_SELECTION

  static has(state: ThreadSelectionState, sessionId: string): boolean {
    return state.sessionIds.includes(sessionId)
  }

  static selectOnly(sessionId: string): ThreadSelectionState {
    return stateOf([sessionId], sessionId)
  }

  static toggle(state: ThreadSelectionState, sessionId: string): ThreadSelectionState {
    const sessionIds = ThreadSelectionModel.has(state, sessionId) ? state.sessionIds.filter(id => id !== sessionId) : [...state.sessionIds, sessionId]
    return stateOf(sessionIds, sessionId)
  }

  static extend(input: {
    readonly state: ThreadSelectionState
    readonly orderedIds: readonly string[]
    readonly sessionId: string
    /** Row the range starts from when the selection has no anchor yet. */
    readonly fallbackAnchorId: string | undefined
  }): ThreadSelectionState {
    const anchorId = input.state.anchorId ?? input.fallbackAnchorId ?? input.sessionId
    const fromIndex = input.orderedIds.indexOf(anchorId)
    const toIndex = input.orderedIds.indexOf(input.sessionId)
    if (fromIndex < 0 || toIndex < 0) return ThreadSelectionModel.selectOnly(input.sessionId)
    const start = Math.min(fromIndex, toIndex)
    const end = Math.max(fromIndex, toIndex)
    return stateOf(input.orderedIds.slice(start, end + 1), anchorId)
  }

  static selectAll(orderedIds: readonly string[]): ThreadSelectionState {
    if (orderedIds.length === 0) return EMPTY_THREAD_SELECTION
    return stateOf([...new Set(orderedIds)], orderedIds[0])
  }

  /** Paint the selection onto rows the list already rendered, without re-rendering every row on each toggle. */
  static applyToDom(input: { readonly list: HTMLElement; readonly sessionIds: readonly string[] }): void {
    const selected = new Set(input.sessionIds)
    for (const button of input.list.querySelectorAll<HTMLButtonElement>(THREAD_MAIN_BUTTON_SELECTOR)) {
      const sessionId = button.dataset.threadId
      if (sessionId !== undefined && selected.has(sessionId)) button.dataset.multiSelected = 'true'
      else delete button.dataset.multiSelected
    }
  }
}
