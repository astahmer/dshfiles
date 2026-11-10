import type { DockPaneActions } from '@dshfiles/frame-layout/regions'
import { XIcon } from '@dshfiles/plugin-ui/icons'
import { useEffect, useSyncExternalStore, type ReactNode } from 'react'

/** The frame's phone rule (`@dshfiles/frame-layout` AppFrame.module.css): below it the right column has no width. */
const PHONE_QUERY = '(max-width: 639.98px)'

const subscribe = (listener: () => void): (() => void) => {
  if (typeof window.matchMedia !== 'function') return () => undefined
  const query = window.matchMedia(PHONE_QUERY)
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}
const read = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches

/** Whether the frame is phone-width, where supporting panes become sheets (docs/ade-ux §8 phase 6). */
export const usePhoneWidth = (): boolean => useSyncExternalStore(subscribe, read, () => false)

/**
 * Whether the phone sheet is open: this page's own presentation state, never stored. The desktop right pane's open
 * state is remembered beyond this browser, so sharing it would open the sheet over a phone's stage whenever a desktop
 * left its right pane open, and close a desktop's pane from the phone. Every load on a phone starts closed.
 */
export const PhoneSheetState = (() => {
  let open = false
  const listeners = new Set<() => void>()
  const set = (next: boolean): void => {
    if (open === next) return
    open = next
    for (const listener of listeners) listener()
  }
  return {
    get: (): boolean => open,
    set,
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  } as const
})()

export const usePhoneSheetOpen = (): boolean => useSyncExternalStore(PhoneSheetState.subscribe, PhoneSheetState.get, () => false)

/** The dock controls every entry point uses (header toggles, the command, a facet that reveals the pane): on a phone they drive the sheet. */
export const phoneAwareDockActions = (desktop: DockPaneActions, phone: () => boolean = read): DockPaneActions => ({
  isOpen: () => (phone() ? PhoneSheetState.get() : desktop.isOpen()),
  open: () => (phone() ? PhoneSheetState.set(true) : desktop.open()),
  close: () => (phone() ? PhoneSheetState.set(false) : desktop.close()),
  toggle: () => (phone() ? PhoneSheetState.set(!PhoneSheetState.get()) : desktop.toggle()),
  subscribe: listener => {
    const offDesktop = desktop.subscribe(listener)
    const offPhone = PhoneSheetState.subscribe(listener)
    return () => {
      offDesktop()
      offPhone()
    }
  },
})

/**
 * The thread panel on a phone (prior-art §3.2 rule 5: supporting panes become sheets, never a split under ~840px). The
 * same dock surface, with its facet tabs and Choose a view, rises from above the tab bar; the scrim and Close put it
 * away, and so does Escape. Geometry comes from the phone shell's published bar heights, with no-shell fallbacks.
 */
export const PhoneSheet = (props: {
  readonly shown: boolean
  readonly heading: string
  readonly onClose: () => void
  readonly children: ReactNode
}): JSX.Element => {
  const { shown, onClose } = props
  useEffect(() => {
    if (!shown) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [shown, onClose])
  return (
    <>
      {shown ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Close ${props.heading}`}
          data-phone-sheet-scrim=""
          className="dshx-root dshx:fixed dshx:inset-0 dshx:z-[42] dshx:cursor-default dshx:bg-black/30"
          onClick={onClose}
        />
      ) : null}
      <section
        role="dialog"
        aria-label={props.heading}
        data-phone-sheet=""
        hidden={!shown}
        className="dshx-root dshx:fixed dshx:inset-x-0 dshx:z-[43] dshx:flex dshx:flex-col dshx:overflow-hidden dshx:rounded-t-xl dshx:border-t dshx:border-border dshx:bg-background dshx:pr-[env(safe-area-inset-right,0px)] dshx:pl-[env(safe-area-inset-left,0px)] dshx:text-foreground dshx:shadow-[0_-8px_24px_rgb(0_0_0/0.18)]"
        style={{
          // React writes no display for undefined, so a shown sheet keeps its stylesheet display.
          display: shown ? undefined : 'none',
          bottom: 'var(--dsh-phone-nav-height, env(safe-area-inset-bottom, 0px))',
          height: 'min(80dvh, calc(100dvh - var(--dsh-phone-top-height, 44px) - var(--dsh-phone-nav-height, 0px) - 16px))',
        }}
      >
        <header className="dshx:relative dshx:flex dshx:h-11 dshx:shrink-0 dshx:items-center dshx:gap-2 dshx:pl-4">
          <span
            aria-hidden="true"
            className="dshx:absolute dshx:top-1.5 dshx:left-1/2 dshx:h-1 dshx:w-9 dshx:-translate-x-1/2 dshx:rounded-full dshx:bg-muted-foreground/30"
          />
          <h2 className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-sm dshx:font-semibold">{props.heading}</h2>
          <button
            type="button"
            aria-label={`Close ${props.heading}`}
            data-phone-sheet-close=""
            onClick={onClose}
            className="dshx:flex dshx:size-11 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:text-muted-foreground dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:active:bg-accent"
          >
            <XIcon className="dshx:size-5" aria-hidden="true" />
          </button>
        </header>
        <div className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col">{props.children}</div>
      </section>
    </>
  )
}
