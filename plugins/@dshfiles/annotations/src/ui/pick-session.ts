import { ElementDescriptor } from '../descriptor.js'
import { describeRegion, type DragRect } from '../region.js'
import type { AnnotationTarget } from '../schema.js'
import type { PickMode } from './state.js'

export interface PickPoint {
  readonly x: number
  readonly y: number
}

export interface DragBox {
  readonly start: PickPoint
  readonly current: PickPoint
}

export interface PickResult {
  readonly target: AnnotationTarget
  readonly point: PickPoint
  readonly mode: PickMode
}

export interface PickSessionHandlers {
  readonly onPicked: (result: PickResult) => void
  readonly onHover: (element: Element | null) => void
  readonly onDrag: (drag: DragBox | null) => void
  readonly onCancel: () => void
}

/**
 * Cancels the click a pick starts. Canceling `pointerdown` does not cancel the separate
 * `click` event, so without this a pick on a button also presses it. The guard lives until
 * the next `pointerdown`: the trailing click is the only one without a new one, and any
 * later gesture has already disarmed it.
 */
export class PickClickGuard {
  private static guardedElement: Element | null = null

  private static readonly disarm = (): void => {
    PickClickGuard.guardedElement = null
  }

  private static readonly swallow = (event: MouseEvent): void => {
    const guardedElement = PickClickGuard.guardedElement
    if (guardedElement === null) return
    const target = event.target instanceof Element ? event.target : null
    const guarded = target !== null && guardedElement.contains(target)
    const insideAnnotations = target?.closest('[data-annotations-ui]') !== null
    PickClickGuard.guardedElement = null
    if (!guarded || insideAnnotations) return
    event.preventDefault()
    event.stopImmediatePropagation()
  }

  /** The guard outlives the pick session: the trailing click lands after the session is torn down. */
  static readonly install = (): (() => void) => {
    const options: AddEventListenerOptions = { capture: true }
    document.addEventListener('pointerdown', PickClickGuard.disarm, options)
    document.addEventListener('click', PickClickGuard.swallow, options)
    document.addEventListener('auxclick', PickClickGuard.swallow, options)
    return () => {
      document.removeEventListener('pointerdown', PickClickGuard.disarm, options)
      document.removeEventListener('click', PickClickGuard.swallow, options)
      document.removeEventListener('auxclick', PickClickGuard.swallow, options)
    }
  }

  static readonly suppressFollowingClicks = ({ element }: { readonly element: Element }): void => {
    PickClickGuard.guardedElement = element
  }
}

const pointOf = (event: PointerEvent): PickPoint => ({ x: event.clientX, y: event.clientY })

const targetAt = ({ point, eventTarget }: { readonly point: PickPoint; readonly eventTarget?: EventTarget | null | undefined }): Element | null => {
  const fromEvent = eventTarget instanceof Element ? eventTarget : null
  const hit = fromEvent ?? document.elementFromPoint(point.x, point.y)
  if (hit === null) return null
  if (hit.closest('[data-annotations-ui]') !== null) return null
  return ElementDescriptor.pickableElement(hit)
}

const dragRect = (drag: DragBox): DragRect => ({
  x: drag.start.x,
  y: drag.start.y,
  width: drag.current.x - drag.start.x,
  height: drag.current.y - drag.start.y,
})

export class PickSession {
  static readonly install = ({
    mode,
    url,
    handlers,
  }: {
    readonly mode: PickMode
    readonly url: () => string
    readonly handlers: PickSessionHandlers
  }): (() => void) => {
    let drag: DragBox | null = null

    const reportDrag = (next: DragBox | null): void => {
      drag = next
      handlers.onDrag(next)
    }

    const pickRegion = (event: PointerEvent): void => {
      if (drag === null) return
      const element = targetAt({ point: pointOf(event), eventTarget: event.target }) ?? targetAt({ point: drag.start })
      if (element === null) return
      event.preventDefault()
      event.stopImmediatePropagation()
      const rect = dragRect(drag)
      if (Math.abs(rect.width) < 4 || Math.abs(rect.height) < 4) {
        reportDrag(null)
        return
      }
      const target = describeRegion({ element, surface: 'dsh', url: url(), rect })
      if (target === null) return
      PickClickGuard.suppressFollowingClicks({ element })
      handlers.onPicked({ target, point: pointOf(event), mode: 'region' })
    }

    const onMove = (event: PointerEvent): void => {
      if (mode === 'region') {
        if (drag !== null) reportDrag({ start: drag.start, current: pointOf(event) })
        return
      }
      handlers.onHover(targetAt({ point: pointOf(event), eventTarget: event.target }))
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (event.isPrimary === false || event.button !== 0) return
      const element = targetAt({ point: pointOf(event), eventTarget: event.target })
      if (element === null) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (mode === 'region') {
        reportDrag({ start: pointOf(event), current: pointOf(event) })
        return
      }
      const target = ElementDescriptor.describeTarget({ element, surface: 'dsh', url: url() })
      if (target === null) return
      PickClickGuard.suppressFollowingClicks({ element })
      handlers.onPicked({ target, point: pointOf(event), mode: 'element' })
    }

    const onPointerUp = (event: PointerEvent): void => {
      if (event.isPrimary === false || event.button !== 0) return
      event.preventDefault()
      event.stopImmediatePropagation()
      if (mode === 'region') pickRegion(event)
    }

    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopImmediatePropagation()
      handlers.onCancel()
    }

    document.addEventListener('pointermove', onMove, true)
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('pointerup', onPointerUp, true)
    document.addEventListener('keydown', onKey, true)
    document.body.style.cursor = mode === 'region' ? 'cell' : 'crosshair'
    return () => {
      document.removeEventListener('pointermove', onMove, true)
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('pointerup', onPointerUp, true)
      document.removeEventListener('keydown', onKey, true)
      document.body.style.cursor = ''
    }
  }
}
