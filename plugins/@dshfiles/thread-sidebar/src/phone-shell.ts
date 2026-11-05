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

/** A visual viewport this much shorter than the layout viewport means the software keyboard is open. */
const KEYBOARD_THRESHOLD = 120

/** `@dshfiles/settings-shell`'s one Settings page (destination-shell opens it the same way). */
export const SETTINGS_PANEL_ID = 'dshfiles-settings'

/** The tab bar's roots: their list has no Back, it is the bottom of the stack. */
const ROOTS: ReadonlySet<DestinationId> = new Set(['threads', 'inbox'])

/**
 * The phone stack (plans/ade-ux §8 phase 6, prior-art §3.2 rule 1): tab root → list → stage. The top bar names the
 * level on screen and Back pops one level: a thread returns to Threads, a page to its destination's list, a
 * destination opened from More to More. The Inbox page is the Inbox tab's root, so it has no Back.
 */
export const PhoneTopBarModel = {
  resolve(input: {
    readonly listOpen: boolean
    readonly moreOpen: boolean
    readonly destination: ResolvedDestination
    readonly destinations: readonly ResolvedDestination[]
    readonly activePanelId: string | null
    readonly selectedThreadId: string | null
    readonly stageTitle?: string | undefined
    readonly origin?: PhoneStageOrigin | undefined
  }): PhoneTopBar {
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
      const title = input.selectedThreadId === null ? 'New thread' : input.stageTitle?.trim() || 'Thread'
      const from = input.origin === undefined ? undefined : PhoneTopBarModel.pageLabel(input.destinations, input.origin.panelId)
      if (from !== undefined && input.origin !== undefined) return { title, back: { to: 'page', panelId: input.origin.panelId, label: from }, thread: input.selectedThreadId !== null }
      const threads = input.destinations.find(candidate => candidate.id === 'threads')
      return { title, back: { to: 'threads', label: threads?.label ?? 'Threads' }, thread: input.selectedThreadId !== null }
    }
    const section = owner.sections.find(candidate => candidate.panelId === input.activePanelId)
    // The Inbox page is the Inbox tab's root: it is named after the tab, not its first section ("Needs you").
    if (owner.id === 'inbox') return { title: owner.label, back: null, thread: false }
    const title = owner.id === 'settings' && section === undefined ? owner.label : (section?.label ?? owner.label)
    // A destination with one page (or Settings, one page in the stage) has no list of its own to return to.
    const single = owner.id === 'settings' || owner.sections.length <= 1
    return { title, back: single ? { to: 'more', label: 'More' } : { to: owner.id, label: owner.label }, thread: false }
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
  element instanceof HTMLElement && (element.isContentEditable || element.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]), textarea, select'))

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

