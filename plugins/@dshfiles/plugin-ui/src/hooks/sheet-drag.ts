import { PHONE_SHELL_QUERY } from '../lib/phone-shell.js'
import { SheetSnap, type SheetDragSample, type SheetSnapLayout, type SheetSnapPoint } from '../lib/sheet-snap.js'

/** The phone rule under which menus, pickers and popovers present as bottom sheets (styles.css). */
const PHONE_QUERY = PHONE_SHELL_QUERY
/**
 * Elements that may be a bottom sheet: an explicit `data-dshx-sheet`, or a kit/Host layer the phone sheet rules
 * restyle (styles.css, rich-composer). Only a candidate that draws the grabber (`::before`) is one right now.
 */
const SHEET_SELECTOR = [
  '[data-dshx-sheet]',
  "[data-slot='dropdown-menu-content']",
  "[data-slot='dropdown-menu-sub-content']",
  "[data-slot='context-menu-content']",
  "[data-slot='context-menu-sub-content']",
  "[data-slot='select-content']",
  "[data-slot='popover-content']",
  "[role='dialog'][data-slot='dialog-content']",
  "[data-menu-material][role='menu']",
].join(', ')
/** The strip under the sheet's top edge that grabs it: the grabber and the padding around it. */
const GRAB_ZONE_PX = 32
/** Movement before a touch counts as a drag; a shorter one stays a tap. */
const SLOP_PX = 6
/** The expanded sheet leaves this share of the viewport above it. */
const EXPANDED_SHARE = 0.9
const SETTLE_MS = 280
const SETTLE_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)'
/** Inline properties the drag writes; their previous inline values come back once the sheet settles at rest. */
const DRIVEN = ['transform', 'transition', 'height', 'max-height'] as const

interface Saved {
  readonly values: ReadonlyMap<string, readonly [string, string]>
  readonly layout: SheetSnapLayout
  point: Exclude<SheetSnapPoint, 'dismissed'>
}

interface Gesture {
  readonly sheet: HTMLElement
  readonly scrollers: readonly HTMLElement[]
  readonly fromGrabZone: boolean
  readonly startX: number
  readonly startY: number
  readonly startHeight: number
  readonly bottom: number
  /** Measured once the touch becomes a drag, so a tap never walks the sheet's subtree. */
  layout: SheetSnapLayout | undefined
  samples: readonly SheetDragSample[]
  height: number
  claimed: boolean
}

const isSheet = (element: Element): element is HTMLElement => {
  if (!(element instanceof HTMLElement)) return false
  if (element.hasAttribute('data-dshx-sheet')) return true
  const grabber = element.ownerDocument.defaultView?.getComputedStyle(element, '::before').content
  return grabber !== undefined && grabber !== 'none' && grabber !== 'normal' && grabber !== ''
}

/** Scrollable boxes from the touched element up to the sheet: a downward drag only moves the sheet once all are at the top. */
const scrollersBetween = (target: Element, sheet: HTMLElement): HTMLElement[] => {
  const view = sheet.ownerDocument.defaultView
  const found: HTMLElement[] = []
  for (let node: Element | null = target; node !== null; node = node.parentElement) {
    if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight + 1) {
      const overflow = view?.getComputedStyle(node).overflowY ?? ''
      if (overflow === 'auto' || overflow === 'scroll' || node === sheet) found.push(node)
    }
    if (node === sheet) break
  }
  return found
}

/**
 * How tall the sheet would be with every scrollable box inside it shown whole, capped so its top stays below the
 * expanded share of the viewport (the sheet may sit above a tab bar). A `data-dshx-sheet-expand="full"` sheet (a panel
 * whose own body scrolls) always grows to just under the phone top bar, or the viewport top without one.
 */
const layoutOf = (sheet: HTMLElement, rest: number, bottom: number): SheetSnapLayout => {
  const viewport = sheet.ownerDocument.defaultView?.innerHeight ?? rest
  if (sheet.getAttribute('data-dshx-sheet-expand') === 'full') {
    const topBar = sheet.ownerDocument.querySelector('[data-phone-top-bar]')?.getBoundingClientRect().bottom ?? 0
    return { rest, expanded: Math.max(rest, bottom - Math.max(0, topBar)) }
  }
  let hidden = Math.max(0, sheet.scrollHeight - sheet.clientHeight)
  for (const inner of sheet.querySelectorAll<HTMLElement>('*')) {
    if (inner.scrollHeight > inner.clientHeight + 1) hidden = Math.max(hidden, inner.scrollHeight - inner.clientHeight)
  }
  return { rest, expanded: Math.max(rest, Math.min(bottom - viewport * (1 - EXPANDED_SHARE), rest + hidden)) }
}

const reducedMotion = (view: Window): boolean => typeof view.matchMedia === 'function' && view.matchMedia('(prefers-reduced-motion: reduce)').matches

const isPhone = (view: Window): boolean => typeof view.matchMedia === 'function' && view.matchMedia(PHONE_QUERY).matches

/**
 * Makes every phone bottom sheet draggable from one document-level listener: the grab strip (or a
 * `data-dshx-sheet-handle`) drags it either way, and its content drags it down once scrolled to the top. The sheet
 * follows the finger, snaps to rest, expanded (towards 90% of the viewport when its content overflows) or dismissed,
 * honours a flick, and settles without motion under `prefers-reduced-motion`. Dismissing sends Escape to the sheet,
 * the close every owner already handles (Radix layers, the Host menu, the workbench and composer sheets).
 * Touch only: desktop pointers and wide viewports keep the anchored layers unchanged.
 */
const listen = (doc: Document): (() => void) => {
  const view = doc.defaultView
  if (view === null) return () => {}
  const saved = new WeakMap<HTMLElement, Saved>()
  let gesture: Gesture | undefined

  const write = (sheet: HTMLElement, property: (typeof DRIVEN)[number], value: string): void => {
    sheet.style.setProperty(property, value, 'important')
  }
  const remember = (sheet: HTMLElement, layout: SheetSnapLayout): Saved => {
    const known = saved.get(sheet)
    if (known !== undefined) return known
    const values = new Map(DRIVEN.map(property => [property, [sheet.style.getPropertyValue(property), sheet.style.getPropertyPriority(property)]] as const))
    const fresh: Saved = { values, layout, point: 'rest' }
    saved.set(sheet, fresh)
    return fresh
  }
  const restore = (sheet: HTMLElement): void => {
    const known = saved.get(sheet)
    if (known === undefined) return
    for (const [property, [value, priority]] of known.values) {
      if (value === '') sheet.style.removeProperty(property)
      else sheet.style.setProperty(property, value, priority)
    }
    saved.delete(sheet)
  }
  const place = (sheet: HTMLElement, layout: SheetSnapLayout, height: number, animate: boolean): void => {
    write(sheet, 'transition', animate && !reducedMotion(view) ? `transform ${SETTLE_MS}ms ${SETTLE_EASE}, height ${SETTLE_MS}ms ${SETTLE_EASE}` : 'none')
    if (height > layout.rest) {
      write(sheet, 'transform', 'none')
      write(sheet, 'max-height', 'none')
      write(sheet, 'height', `${height}px`)
      return
    }
    write(sheet, 'height', `${layout.rest}px`)
    write(sheet, 'max-height', 'none')
    write(sheet, 'transform', `translateY(${layout.rest - height}px)`)
  }
  const settle = (current: { readonly sheet: HTMLElement; readonly layout: SheetSnapLayout }, point: SheetSnapPoint): void => {
    const sheet = current.sheet
    const entry = remember(sheet, current.layout)
    place(sheet, current.layout, SheetSnap.heightOf(current.layout, point), true)
    if (point !== 'dismissed') {
      entry.point = point
      if (point === 'rest')
        view.setTimeout(() => saved.get(sheet)?.point === 'rest' && gesture?.sheet !== sheet && restore(sheet), reducedMotion(view) ? 0 : SETTLE_MS)
      return
    }
    view.setTimeout(
      () => {
        sheet.dispatchEvent(new view.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))
        // An owner that ignored Escape keeps its sheet: bring it back instead of leaving it off-screen.
        view.setTimeout(() => {
          if (sheet.isConnected && sheet.getClientRects().length > 0 && sheet.getAttribute('data-state') !== 'closed') {
            place(sheet, current.layout, current.layout.rest, true)
            view.setTimeout(() => restore(sheet), SETTLE_MS)
            return
          }
          restore(sheet)
        }, SETTLE_MS + 120)
      },
      reducedMotion(view) ? 0 : SETTLE_MS,
    )
  }

  const onStart = (event: TouchEvent): void => {
    gesture = undefined
    if (event.touches.length !== 1 || !isPhone(view)) return
    const touch = event.touches[0]
    const target = event.target
    if (touch === undefined || !(target instanceof Element)) return
    if (target.closest('input, textarea, [contenteditable="true"]') !== null) return
    const sheet = target.closest(SHEET_SELECTOR)
    if (sheet === null || !isSheet(sheet)) return
    const rect = sheet.getBoundingClientRect()
    const known = saved.get(sheet)
    const layout = known?.layout
    const startHeight = layout === undefined || known === undefined ? rect.height : SheetSnap.heightOf(layout, known.point)
    const handle = target.closest('[data-dshx-sheet-handle]')
    gesture = {
      sheet,
      scrollers: scrollersBetween(target, sheet),
      fromGrabZone: (handle !== null && sheet.contains(handle)) || touch.clientY - rect.top <= GRAB_ZONE_PX,
      startX: touch.clientX,
      startY: touch.clientY,
      startHeight,
      bottom: rect.bottom,
      layout,
      samples: [{ y: touch.clientY, time: event.timeStamp }],
      height: startHeight,
      claimed: false,
    }
  }

  const onMove = (event: TouchEvent): void => {
    const touch = event.touches[0]
    if (gesture === undefined || touch === undefined) return
    const dx = touch.clientX - gesture.startX
    const dy = touch.clientY - gesture.startY
    if (!gesture.claimed) {
      if (Math.abs(dy) < SLOP_PX && Math.abs(dx) < SLOP_PX) return
      const vertical = Math.abs(dy) > Math.abs(dx)
      const atTop = gesture.scrollers.every(scroller => scroller.scrollTop <= 0)
      if (!vertical || !event.cancelable || (!gesture.fromGrabZone && (dy < 0 || !atTop))) {
        gesture = undefined
        return
      }
      gesture.claimed = true
      gesture.layout = remember(gesture.sheet, gesture.layout ?? layoutOf(gesture.sheet, gesture.startHeight, gesture.bottom)).layout
    }
    const layout = gesture.layout
    if (layout === undefined) return
    event.preventDefault()
    gesture.samples = SheetSnap.remember(gesture.samples, { y: touch.clientY, time: event.timeStamp })
    gesture.height = SheetSnap.follow({ layout, startHeight: gesture.startHeight, dy })
    place(gesture.sheet, layout, gesture.height, false)
  }

  const onEnd = (event: TouchEvent): void => {
    // oxlint-disable-next-line antislop/no-passthrough-variable -- a snapshot: the gesture ends here, before it is read.
    const current = gesture
    gesture = undefined
    const layout = current?.layout
    if (current === undefined || layout === undefined || !current.claimed) return
    // The release is no tap: keep the row or button under the finger from firing.
    const swallow = (click: Event): void => {
      click.preventDefault()
      click.stopPropagation()
    }
    view.addEventListener('click', swallow, { capture: true, once: true })
    view.setTimeout(() => view.removeEventListener('click', swallow, { capture: true }), 400)
    const cancelled = event.type === 'touchcancel'
    const velocity = cancelled ? 0 : SheetSnap.velocity(current.samples)
    const point = cancelled ? (saved.get(current.sheet)?.point ?? 'rest') : SheetSnap.settle({ layout, height: current.height, velocity })
    settle({ sheet: current.sheet, layout }, point)
  }

  const passive = { passive: true, capture: true } as const
  const active = { passive: false, capture: true } as const
  doc.addEventListener('touchstart', onStart, passive)
  doc.addEventListener('touchmove', onMove, active)
  doc.addEventListener('touchend', onEnd, passive)
  doc.addEventListener('touchcancel', onEnd, passive)
  return () => {
    doc.removeEventListener('touchstart', onStart, passive)
    doc.removeEventListener('touchmove', onMove, active)
    doc.removeEventListener('touchend', onEnd, passive)
    doc.removeEventListener('touchcancel', onEnd, passive)
  }
}

const installs = new WeakMap<Document, { count: number; readonly stop: () => void }>()

/**
 * Starts the shared sheet drag on `doc` and returns its release. Installs share one listener per document, so a
 * surface that needs the drag (the workbench sheet) installs it too and still works where `@dshfiles/ui-styles` is
 * absent; the last release removes it.
 */
export const installSheetDrag = (doc: Document): (() => void) => {
  const known = installs.get(doc)
  const entry = known ?? { count: 0, stop: listen(doc) }
  entry.count += 1
  installs.set(doc, entry)
  let released = false
  return () => {
    if (released) return
    released = true
    entry.count -= 1
    if (entry.count > 0) return
    entry.stop()
    installs.delete(doc)
  }
}
