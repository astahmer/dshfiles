import { useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

interface KeptView {
  readonly sessionId: string
  readonly container: HTMLDivElement
  render: () => ReactNode
  outlet: HTMLElement | null
  readonly scroll: Map<Element, { readonly top: number; readonly left: number }>
  readonly stopScrollMemo: () => void
}

/**
 * Thread views that outlive their Dockview panel. A preview tab replaced by the next opened thread removes its panel;
 * without this the next visit to that thread remounts its whole conversation (history, composer, header). Each view
 * renders through a portal into a container this owner keeps: a panel adopts the container while it shows the thread,
 * and a released container waits outside the document, so no hidden view is laid out, focusable, or found by a DOM
 * query for the thread on screen. The `limit` most recently released views stay mounted; older ones unmount.
 */
export class KeptThreadViews {
  static readonly defaultLimit = 3
  /**
   * Dispatched (bubbling) on a kept view's container when it is shown again. Its components did not remount, so
   * mount-time work such as the composer taking focus listens for this instead.
   */
  static readonly shownEvent = 'dshfiles:thread-view-shown'

  private readonly views = new Map<string, KeptView>()
  /** Released views, least recently released first. */
  private readonly released: string[] = []
  private readonly listeners = new Set<() => void>()
  private snapshot: readonly KeptView[] = []

  constructor(private readonly limit: number = KeptThreadViews.defaultLimit) {}

  /** Mount point for every kept view; render it once beside the surfaces that show the threads. */
  readonly Host = (): ReactNode => {
    const views = useSyncExternalStore(this.subscribe, this.getSnapshot)
    return views.map(view => createPortal(view.render(), view.container, view.sessionId))
  }

  /** Shows the session's kept view inside this panel, mounting it only when no kept view exists. */
  readonly Outlet = (props: { readonly sessionId: string; readonly render: () => ReactNode }): ReactNode => {
    const element = useRef<HTMLDivElement>(null)
    const render = useRef(props.render)
    render.current = props.render
    const [inline, setInline] = useState(false)
    useLayoutEffect(() => {
      const outlet = element.current
      if (outlet === null) return
      if (!this.adopt(props.sessionId, outlet, () => render.current())) {
        setInline(true)
        return
      }
      return () => this.release(props.sessionId, outlet)
    }, [props.sessionId])
    // A second panel for a session already shown elsewhere renders its own copy, as before this owner existed.
    return (
      <div ref={element} style={{ display: 'contents' }}>
        {inline ? props.render() : null}
      </div>
    )
  }

  /** Number of views currently mounted, shown or released. */
  get size(): number {
    return this.views.size
  }

  /** Unmount every released view, for example when the render capability they were built from changed. */
  dropReleased(): void {
    for (const sessionId of this.released.splice(0)) this.unmount(sessionId)
    this.publish()
  }

  private adopt(sessionId: string, outlet: HTMLElement, render: () => ReactNode): boolean {
    const kept = this.views.get(sessionId)
    if (kept !== undefined && kept.outlet !== null) return false
    const releasedAt = this.released.indexOf(sessionId)
    if (releasedAt !== -1) this.released.splice(releasedAt, 1)
    const view = kept ?? this.mount(sessionId, outlet.ownerDocument)
    view.render = render
    view.outlet = outlet
    outlet.append(view.container)
    if (kept === undefined) {
      this.publish()
      return true
    }
    // Wait for the frame: the panel becomes visible later in this commit (nothing hidden takes focus), and writing
    // scroll offsets forces a layout that would otherwise run again once the rest of the switch changed the DOM.
    outlet.ownerDocument.defaultView?.requestAnimationFrame(() => this.reveal(view))
    return true
  }

  private reveal(view: KeptView): void {
    if (view.outlet === null) return
    // Moving a node resets its scroll offsets; put back what the reader left.
    for (const [scroller, position] of view.scroll) {
      if (!view.container.contains(scroller)) {
        view.scroll.delete(scroller)
        continue
      }
      scroller.scrollTop = position.top
      scroller.scrollLeft = position.left
    }
    view.container.dispatchEvent(new CustomEvent(KeptThreadViews.shownEvent, { bubbles: true }))
  }

  private release(sessionId: string, outlet: HTMLElement): void {
    const view = this.views.get(sessionId)
    if (view === undefined || view.outlet !== outlet) return
    view.outlet = null
    view.container.remove()
    this.released.push(sessionId)
    const evicted = this.released.splice(0, Math.max(0, this.released.length - this.limit))
    for (const id of evicted) this.unmount(id)
    if (evicted.length > 0) this.publish()
  }

  private mount(sessionId: string, document: Document): KeptView {
    const container = document.createElement('div')
    container.dataset.keptThreadView = sessionId
    container.style.display = 'contents'
    const scroll = new Map<Element, { readonly top: number; readonly left: number }>()
    const remember = (event: Event): void => {
      const target = event.target
      if (target instanceof Element) scroll.set(target, { top: target.scrollTop, left: target.scrollLeft })
    }
    container.addEventListener('scroll', remember, { capture: true, passive: true })
    const view: KeptView = {
      sessionId,
      container,
      render: () => null,
      outlet: null,
      scroll,
      stopScrollMemo: () => container.removeEventListener('scroll', remember, { capture: true }),
    }
    this.views.set(sessionId, view)
    return view
  }

  private unmount(sessionId: string): void {
    const view = this.views.get(sessionId)
    if (view === undefined) return
    view.stopScrollMemo()
    view.container.remove()
    this.views.delete(sessionId)
  }

  private publish(): void {
    this.snapshot = [...this.views.values()]
    for (const listener of this.listeners) listener()
  }

  private readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private readonly getSnapshot = (): readonly KeptView[] => this.snapshot
}
