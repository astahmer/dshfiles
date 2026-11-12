/**
 * dshfiles (productivity pass Q4): which mounted Chat view a thread shortcut (⌘F, `[` / `]`) acts on. Several Chat
 * views can be mounted at once (Free docking, a side-by-side split), and the shortcuts are registered once per page,
 * so each view registers here and the commands ask for the one the user is in: the view holding focus, else the one
 * the user last pointed at or focused, else the only one on screen.
 */

export interface ChatViewHandle {
  readonly sessionId: string
  /** The view's root element. */
  readonly root: () => HTMLElement | null
  /** Open the find bar (or focus it when open). */
  readonly openFind: () => void
  /** Whether the find bar's own field has focus: a second ⌘F then belongs to the browser. */
  readonly findFocused: () => boolean
  /** Jump to the previous or next Turn of the current turn-map filter; false when there is none. */
  readonly stepTurn: (direction: 'previous' | 'next') => boolean
  /** Open the Turns sheet. */
  readonly openTurns: () => void
}

interface Entry {
  readonly handle: ChatViewHandle
  lastUsed: number
}

declare global {
  // One registry per page: the commands (client-entry) and the views (slot code) may load separate copies of this module.
  var __dshfilesChatViews: { readonly entries: Set<Entry>; clock: number } | undefined
}

const registry = (): { readonly entries: Set<Entry>; clock: number } => {
  globalThis.__dshfilesChatViews ??= { entries: new Set(), clock: 0 }
  return globalThis.__dshfilesChatViews
}

const shown = (element: HTMLElement | null): element is HTMLElement => element !== null && element.isConnected && element.getClientRects().length > 0

export class ChatViewRegistry {
  /**
   * Register a mounted view; pointer and focus inside its root mark it as the one in use.
   * @returns unregister.
   */
  static readonly register = (handle: ChatViewHandle): (() => void) => {
    const state = registry()
    const entry: Entry = { handle, lastUsed: ++state.clock }
    state.entries.add(entry)
    const root = handle.root()
    const used = (): void => {
      entry.lastUsed = ++state.clock
    }
    root?.addEventListener('pointerdown', used, { capture: true })
    root?.addEventListener('focusin', used)
    return () => {
      state.entries.delete(entry)
      root?.removeEventListener('pointerdown', used, { capture: true })
      root?.removeEventListener('focusin', used)
    }
  }

  /** The view a thread shortcut acts on, or null when no Chat view is on screen. */
  static readonly active = (doc: Document | undefined = typeof document === 'undefined' ? undefined : document): ChatViewHandle | null => {
    const visible = [...registry().entries].filter(entry => shown(entry.handle.root()))
    const focused = doc?.activeElement
    const holder = focused === null || focused === undefined ? undefined : visible.find(entry => entry.handle.root()?.contains(focused) === true)
    if (holder !== undefined) return holder.handle
    const recent = visible.sort((left, right) => right.lastUsed - left.lastUsed)[0]
    return recent?.handle ?? null
  }

  /** Views for one thread (a request from the thread `⋯` menu goes to the first on screen). */
  static readonly forSession = (sessionId: string): ChatViewHandle | null =>
    [...registry().entries].map(entry => entry.handle).find(handle => handle.sessionId === sessionId && shown(handle.root())) ?? null
}
