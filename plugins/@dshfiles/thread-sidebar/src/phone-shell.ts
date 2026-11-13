import { useEffect } from 'react'
import { Destinations, type DestinationId, type ResolvedDestination } from './destinations.js'

/** Where the phone top bar's Back goes: a destination's list, the More list, or the page a thread was opened from. */
export type PhoneBackTarget =
  | { readonly to: DestinationId | 'more'; readonly label: string }
  | { readonly to: 'page'; readonly panelId: string; readonly label: string }

/** The page on the stage just before a thread replaced it (an Inbox item's Open): the thread's Back returns there. */
export interface PhoneStageOrigin {
  readonly panelId: string
}

export interface PhoneTopBar {
  readonly title: string
  readonly back: PhoneBackTarget | null
  /** The stage shows a thread (or a new-thread draft): the bar offers its panels. */
  readonly thread: boolean
}

/** What the phone stack shows: the list (and which), or the stage (and what it came from). */
export interface PhoneStackInput {
  readonly listOpen: boolean
  readonly moreOpen: boolean
  readonly destination: ResolvedDestination
  readonly destinations: readonly ResolvedDestination[]
  readonly activePanelId: string | null
  readonly selectedThreadId: string | null
  readonly stageTitle?: string | undefined
  /** The title of a thread picked in the list that the stage has not opened yet ({@link PendingPick}). */
  readonly pendingTitle?: string | undefined
  readonly origin?: PhoneStageOrigin | undefined
}

/**
 * A tap in the list names its thread before the stage Session follows it (over a slow link that takes seconds): the
 * pick stays pending while the stage still shows what it showed at the pick, and any stage move settles it.
 */
export const PendingPick = {
  threadId: (input: {
    readonly pickedId: string | undefined
    readonly stageAtPick: string | undefined
    readonly stageSession: string | undefined
  }): string | undefined =>
    input.pickedId !== undefined && input.pickedId !== input.stageSession && input.stageAtPick === input.stageSession ? input.pickedId : undefined,
} as const

/** A visual viewport this much shorter than the layout viewport means the software keyboard is open. */
const KEYBOARD_THRESHOLD = 120

/** `@dshfiles/settings-shell`'s one Settings page (destination-shell opens it the same way). */
export const SETTINGS_PANEL_ID = 'dshfiles-settings'

/** The tab bar's roots: their list has no Back, it is the bottom of the stack. */
const ROOTS: ReadonlySet<DestinationId> = new Set(['threads', 'inbox'])

/**
 * The phone stack (docs/ade-ux §8 phase 6, prior-art §3.2 rule 1): tab root → list → stage. The top bar names the
 * level on screen and Back pops one level: a thread returns to Threads, a page to its destination's list, a
 * destination opened from More to More. The Inbox page is the Inbox tab's root, so it has no Back.
 */
export const PhoneTopBarModel = {
  resolve(input: PhoneStackInput): PhoneTopBar {
    if (input.listOpen) {
      if (input.moreOpen) return { title: 'More', back: null, thread: false }
      const back = ROOTS.has(input.destination.id) ? null : { to: 'more' as const, label: 'More' }
      return { title: input.destination.label, back, thread: false }
    }
    // Settings is one page in the stage (plan §4.6), not one of its destination's sections.
    const owner =
      Destinations.owning(input.destinations, input.activePanelId) ??
      (input.activePanelId === SETTINGS_PANEL_ID ? input.destinations.find(candidate => candidate.id === 'settings') : undefined)
    if (owner === undefined) {
      const pending = input.pendingTitle?.trim() || undefined
      const title = pending ?? (input.selectedThreadId === null ? 'New thread' : input.stageTitle?.trim() || 'Thread')
      const thread = pending !== undefined || input.selectedThreadId !== null
      const from = input.origin === undefined ? undefined : PhoneTopBarModel.pageLabel(input.destinations, input.origin.panelId)
      if (from !== undefined && input.origin !== undefined) return { title, back: { to: 'page', panelId: input.origin.panelId, label: from }, thread }
      const threads = input.destinations.find(candidate => candidate.id === 'threads')
      return { title, back: { to: 'threads', label: threads?.label ?? 'Threads' }, thread }
    }
    const section = owner.sections.find(candidate => candidate.panelId === input.activePanelId)
    // The Inbox page is the Inbox tab's root: it is named after the tab, not its first section ("Needs you").
    if (owner.id === 'inbox') return { title: owner.label, back: null, thread: false }
    const title = owner.id === 'settings' && section === undefined ? owner.label : (section?.label ?? owner.label)
    // A destination with one page (or Settings, one page in the stage) has no list of its own to return to.
    const single = owner.id === 'settings' || owner.sections.length <= 1
    return { title, back: single ? { to: 'more', label: 'More' } : { to: owner.id, label: owner.label }, thread: false }
  },

  /**
   * How many Backs the screen on show is above its tab root: one history entry per level (Android's back gesture pops
   * them one at a time). A thread opened from a page counts that page's own level.
   */
  depth(input: PhoneStackInput): number {
    const back = PhoneTopBarModel.resolve(input).back
    if (back === null) return 0
    if (back.to === 'more') return 1
    if (back.to === 'page')
      return 1 + PhoneTopBarModel.depth({ ...input, listOpen: false, moreOpen: false, activePanelId: back.panelId, selectedThreadId: null, origin: undefined })
    return ROOTS.has(back.to) ? 1 : 2
  },

  /** A page's name as Back shows it: the Inbox by its tab name, any other page by its section label. */
  pageLabel(destinations: readonly ResolvedDestination[], panelId: string): string | undefined {
    const owner = Destinations.owning(destinations, panelId)
    if (owner === undefined) return undefined
    if (owner.id === 'inbox') return owner.label
    return owner.sections.find(section => section.panelId === panelId)?.label ?? owner.label
  },
} as const

const editable = (element: Element | null): boolean =>
  element instanceof HTMLElement &&
  (element.isContentEditable || element.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, select'))

/**
 * The software keyboard on iOS WebKit shrinks the visual viewport, not the layout viewport, so `position: fixed` bars
 * and a `dvh` frame stay full height behind it. While an editable element has focus and the visual viewport is
 * clearly shorter, publish `data-phone-keyboard` and `--dsh-keyboard-inset` on the document (the frame shrinks to sit
 * on the keyboard, the tab bar hides) and `--dsh-visual-offset-top` (the top bar follows a scrolled layout viewport).
 */
export const useSoftwareKeyboard = (): void => {
  useEffect(() => {
    const viewport = window.visualViewport
    if (viewport === null || viewport === undefined) return
    const root = document.documentElement
    let frame: number | null = null
    const apply = (): void => {
      frame = null
      const inset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
      const open = inset > KEYBOARD_THRESHOLD && editable(document.activeElement)
      root.toggleAttribute('data-phone-keyboard', open)
      if (open) root.style.setProperty('--dsh-keyboard-inset', `${inset}px`)
      else root.style.removeProperty('--dsh-keyboard-inset')
      if (viewport.offsetTop > 0) root.style.setProperty('--dsh-visual-offset-top', `${Math.round(viewport.offsetTop)}px`)
      else root.style.removeProperty('--dsh-visual-offset-top')
    }
    const schedule = (): void => {
      frame ??= requestAnimationFrame(apply)
    }
    viewport.addEventListener('resize', schedule)
    viewport.addEventListener('scroll', schedule)
    document.addEventListener('focusin', schedule)
    document.addEventListener('focusout', schedule)
    apply()
    return () => {
      viewport.removeEventListener('resize', schedule)
      viewport.removeEventListener('scroll', schedule)
      document.removeEventListener('focusin', schedule)
      document.removeEventListener('focusout', schedule)
      if (frame !== null) cancelAnimationFrame(frame)
      root.removeAttribute('data-phone-keyboard')
      root.style.removeProperty('--dsh-keyboard-inset')
      root.style.removeProperty('--dsh-visual-offset-top')
    }
  }, [])
}

/** iOS reads the standalone status-bar style from this meta when a home-screen web app launches. */
const STATUS_BAR_META = 'apple-mobile-web-app-status-bar-style'

/**
 * The standalone (home-screen) status bar (visual refresh T5.3, phone rules "Safe areas"): in dark it is translucent
 * with light text, so the top bar's own bg token shows through under `viewport-fit=cover`; in light it keeps dark text
 * (`default`). `theme-color` already follows the computed body background (frame-layout's theme presenter), which is
 * the bg token in both schemes. A meta the page already had is left alone.
 */
export const StatusBarStyle = {
  forScheme: (dark: boolean): 'default' | 'black-translucent' => (dark ? 'black-translucent' : 'default'),
} as const

export const useStandaloneStatusBar = (): void => {
  useEffect(() => {
    if (document.querySelector(`meta[name="${STATUS_BAR_META}"]`) !== null) return
    const meta = document.createElement('meta')
    meta.name = STATUS_BAR_META
    const apply = (): void => {
      meta.content = StatusBarStyle.forScheme(document.body.hasAttribute('data-ds-dark-theme'))
    }
    apply()
    document.head.append(meta)
    const observer = new MutationObserver(apply)
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    return () => {
      observer.disconnect()
      meta.remove()
    }
  }, [])
}
