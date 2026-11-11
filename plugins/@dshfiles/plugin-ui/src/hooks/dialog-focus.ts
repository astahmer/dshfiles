import { useEffect, type RefObject } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

const focusables = (container: HTMLElement): readonly HTMLElement[] => [...container.querySelectorAll<HTMLElement>(FOCUSABLE)]

/**
 * Focus handling for a hand-rolled dialog surface that cannot use the kit Dialog, Sheet or Popover: focus moves into it
 * on open, Tab stays inside it when `trap` is set, and focus returns to the element that held it before opening.
 */
export const useDialogFocus = (options: {
  readonly open: boolean
  readonly container: RefObject<HTMLElement | null>
  readonly initialFocus?: RefObject<HTMLElement | null>
  readonly trap?: boolean
}): void => {
  const { open, container, initialFocus, trap = false } = options
  useEffect(() => {
    const surface = container.current
    if (!open || surface === null) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    if (!surface.contains(document.activeElement)) (initialFocus?.current ?? focusables(surface)[0] ?? surface).focus()
    const keepTabInside = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const items = focusables(surface)
      const first = items[0]
      const last = items.at(-1)
      if (first === undefined || last === undefined) return
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    if (trap) surface.addEventListener('keydown', keepTabInside)
    return () => {
      surface.removeEventListener('keydown', keepTabInside)
      const active = document.activeElement
      const focusLeftWithSurface = active === null || active === document.body || surface.contains(active)
      if (previous?.isConnected === true && focusLeftWithSurface) previous.focus()
    }
  }, [open, container, initialFocus, trap])
}
