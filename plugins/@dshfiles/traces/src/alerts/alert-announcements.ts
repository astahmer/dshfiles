import type { AlertEvent } from './alert-types.js'

const shown = new Set<HTMLElement>()

/**
 * Which alert events a client announces (toast and browser notification). A firing alert is news; a resolved one is a
 * healthy event, announced only when the user asked for it. Nothing is announced while the Alerts view is on screen:
 * the page already shows it.
 */
export const announceableEvents = (
  events: readonly AlertEvent[],
  options: { readonly announceResolved: boolean; readonly alertsOnScreen: boolean },
): readonly AlertEvent[] =>
  options.alertsOnScreen ? [] : events.filter(event => event.kind === 'firing' || options.announceResolved)

/** Mounted Alerts views register their root, so the shell-wide announcer can tell whether one is on screen. */
export const AlertsOnScreen = {
  register: (element: HTMLElement): (() => void) => {
    shown.add(element)
    return () => {
      shown.delete(element)
    }
  },
  now: (): boolean =>
    typeof document !== 'undefined' &&
    document.visibilityState === 'visible' &&
    [...shown].some(element => element.isConnected && element.getClientRects().length > 0),
} as const
