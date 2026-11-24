/**
 * Where focus goes when a Land confirmation closes (round three item 27). Radix returns it to whatever held it before
 * the dialog opened, which after a confirmed Land is a Land button that is now disabled or gone, and in WebKit (a click
 * never focuses a button) is the page itself: both left `document.activeElement` on `body`.
 */

const COMPOSER_INPUT = '[data-composer-card] [data-composer-input], [data-composer-card] [role="textbox"], [data-composer-card] textarea'

/** The thread's composer input, else the first composer on the page. */
const composerOf = (sessionId: string | undefined): HTMLElement | null => {
  if (sessionId !== undefined)
    for (const root of document.querySelectorAll<HTMLElement>('[data-conversation-session]')) {
      if (root.getAttribute('data-conversation-session') !== sessionId) continue
      const input = root.querySelector<HTMLElement>(COMPOSER_INPUT)
      if (input !== null) return input
    }
  return document.querySelector<HTMLElement>(COMPOSER_INPUT)
}

const focusable = (element: HTMLElement | null | undefined): element is HTMLElement =>
  element !== null && element !== undefined && element.isConnected && !(element instanceof HTMLButtonElement && element.disabled)

/**
 * A cancelled dialog hands focus back to the Land that opened it; a confirmed one (that Land is now busy or gone) and a
 * dialog with no trigger left hand it to the thread's composer, where the next message is typed.
 */
export const focusAfterLandDialog = (input: {
  readonly confirmed: boolean
  readonly trigger: HTMLElement | null | undefined
  readonly sessionId: string | undefined
}): void => {
  const target = !input.confirmed && focusable(input.trigger) ? input.trigger : composerOf(input.sessionId)
  target?.focus({ preventScroll: true })
}
