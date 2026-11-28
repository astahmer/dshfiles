import { useLayoutEffect, type RefObject } from 'react'

/** Three 44px rows: below this the list opens under the caret instead of above the composer (DESIGN.md R12). */
export const MIN_ROOM_ABOVE = 3 * 44
/** Air kept between the list and the top bar, or the keyboard. */
const GAP = 8
/** The space the input-trigger menu keeps between itself and the composer (`bottom: calc(100% + 4px)`). */
const MENU_OFFSET = 4

export type TriggerMenuPlacement =
  | { readonly mode: 'above'; readonly maxHeight: number }
  | { readonly mode: 'below'; readonly top: number; readonly maxHeight: number }

/**
 * Where the `@` and `/` list fits with the keyboard up: above the composer, clamped under the top bar, while three rows
 * fit there; otherwise under the caret, clamped above the keyboard. All values are viewport pixels.
 * @param input.anchorTop - the top of the list's containing block (the list sits 4px above it).
 * @param input.topBarBottom - the bottom of the phone top bar, or 0 without one.
 * @param input.caretBottom - the bottom of the caret's line.
 * @param input.keyboardTop - the bottom of the visual viewport (the top of the keyboard while it is up).
 */
export const triggerMenuPlacement = (input: {
  readonly anchorTop: number
  readonly topBarBottom: number
  readonly caretBottom: number
  readonly keyboardTop: number
}): TriggerMenuPlacement => {
  const above = Math.floor(input.anchorTop - MENU_OFFSET - input.topBarBottom - GAP)
  if (above >= MIN_ROOM_ABOVE) return { mode: 'above', maxHeight: above }
  const below = Math.floor(input.keyboardTop - input.caretBottom - GAP)
  if (below <= above) return { mode: 'above', maxHeight: Math.max(0, above) }
  return { mode: 'below', top: Math.round(input.caretBottom - input.anchorTop + MENU_OFFSET), maxHeight: below }
}

const MENU = '[data-trigger-menu]'
const TOP_BAR = '[data-phone-top-bar]'

/** The caret line's bottom in the composer's text field: the field's top plus one line (the list opens under it). */
const caretBottomOf = (field: HTMLElement): number => {
  const style = getComputedStyle(field)
  const line = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.4 || 20
  return field.getBoundingClientRect().top + Number.parseFloat(style.paddingTop || '0') + line
}

/**
 * Keep the composer's `@`/`/` list inside the visible area of a phone: publish `--dsh-trigger-menu-max` (and, when it
 * opens under the caret, `--dsh-trigger-menu-top` with `data-trigger-menu-below`) on the composer card. The phone-shell
 * CSS reads them; the desktop layout ignores them.
 */
export const useTriggerMenuRoom = (cardRef: RefObject<HTMLElement | null>): void => {
  useLayoutEffect(() => {
    const card = cardRef.current
    if (card === null) return undefined
    let frame: number | null = null
    const clear = (): void => {
      card.removeAttribute('data-trigger-menu-below')
      card.style.removeProperty('--dsh-trigger-menu-max')
      card.style.removeProperty('--dsh-trigger-menu-top')
    }
    const measure = (): void => {
      frame = null
      const menu = card.querySelector<HTMLElement>(MENU)
      const anchor = menu?.offsetParent
      const field = card.querySelector<HTMLElement>('[contenteditable="true"], textarea')
      if (menu === null || menu === undefined || !(anchor instanceof HTMLElement) || field === null) return clear()
      const viewport = window.visualViewport
      const placement = triggerMenuPlacement({
        anchorTop: anchor.getBoundingClientRect().top,
        topBarBottom: Math.max(document.querySelector(TOP_BAR)?.getBoundingClientRect().bottom ?? 0, viewport?.offsetTop ?? 0),
        caretBottom: caretBottomOf(field),
        keyboardTop: viewport === null || viewport === undefined ? window.innerHeight : viewport.offsetTop + viewport.height,
      })
      card.style.setProperty('--dsh-trigger-menu-max', `${String(placement.maxHeight)}px`)
      if (placement.mode === 'below') {
        card.setAttribute('data-trigger-menu-below', '')
        card.style.setProperty('--dsh-trigger-menu-top', `${String(placement.top)}px`)
      } else {
        card.removeAttribute('data-trigger-menu-below')
        card.style.removeProperty('--dsh-trigger-menu-top')
      }
    }
    const schedule = (): void => {
      frame ??= requestAnimationFrame(measure)
    }
    // The list mounts and unmounts inside the card; the keyboard and a scrolled layout viewport move the room.
    const observer = new MutationObserver(schedule)
    observer.observe(card, { childList: true, subtree: true })
    window.visualViewport?.addEventListener('resize', schedule)
    window.visualViewport?.addEventListener('scroll', schedule)
    window.addEventListener('resize', schedule)
    schedule()
    return () => {
      observer.disconnect()
      window.visualViewport?.removeEventListener('resize', schedule)
      window.visualViewport?.removeEventListener('scroll', schedule)
      window.removeEventListener('resize', schedule)
      if (frame !== null) cancelAnimationFrame(frame)
      clear()
    }
  }, [cardRef])
}
