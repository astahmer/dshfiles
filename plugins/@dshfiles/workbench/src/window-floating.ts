import type { DockviewApi } from 'dockview-react'
import type { WorkbenchRegionId } from './dock-regions.js'
import { retainWindowFloatLayers } from './window-float-layers.js'

const ROOT_X = '--dshfiles-workbench-root-x'
const ROOT_Y = '--dshfiles-workbench-root-y'

const writeOrigin = (root: HTMLElement, x: number, y: number): void => {
  if (root.style.getPropertyValue(ROOT_X) !== `${x}px`) root.style.setProperty(ROOT_X, `${x}px`)
  if (root.style.getPropertyValue(ROOT_Y) !== `${y}px`) root.style.setProperty(ROOT_Y, `${y}px`)
}

export class WindowFloatingGeometry {
  static supports(region: WorkbenchRegionId | undefined): boolean {
    return region === 'main' || region === 'left' || region === 'right' || region === 'bottom'
  }

  /** Prime before native layout restoration can clamp a saved window position. */
  static prepare(root: HTMLElement): void {
    const rect = root.getBoundingClientRect()
    if (rect.width !== 0 && rect.height !== 0) writeOrigin(root, rect.left, rect.top)
  }

  /**
   * Native floats keep their API, panel and React owner. Only their two presentation
   * layers use window coordinates: chrome is viewport-relative, whereas Dockview's
   * always-rendered content still reports offsets relative to its own shell.
   *
   * This owned, unpadded mount has the same origin as its direct native shell. Do
   * not inspect/reparent native DOM or let these offsets turn nested paint-contained
   * Dockviews into window owners. CSS selects only this mount's immediate Dockview.
   */
  static retain(root: HTMLElement, api: DockviewApi): () => void {
    const view = root.ownerDocument.defaultView
    if (view === null) return () => undefined
    const releaseLayers = retainWindowFloatLayers(root, api)
    const oldX = root.style.getPropertyValue(ROOT_X)
    const oldY = root.style.getPropertyValue(ROOT_Y)
    let previous: { x: number; y: number; width: number; height: number; viewportWidth: number; viewportHeight: number } | undefined
    let frame: number | undefined
    let disposed = false
    let measuring = false

    const measure = (): void => {
      if (disposed || measuring) return
      const rect = root.getBoundingClientRect()
      // A hidden source intentionally hides its native floats too. Do not replace
      // its last useful geometry with display:none's zero box.
      if (rect.width === 0 || rect.height === 0) return
      const next = { x: rect.left, y: rect.top, width: rect.width, height: rect.height, viewportWidth: view.innerWidth, viewportHeight: view.innerHeight }
      if (
        previous?.x === next.x &&
        previous.y === next.y &&
        previous.width === next.width &&
        previous.height === next.height &&
        previous.viewportWidth === next.viewportWidth &&
        previous.viewportHeight === next.viewportHeight
      )
        return
      writeOrigin(root, next.x, next.y)
      previous = next
      // The source can move without changing its own size (frame track changes,
      // scrolling). Refresh native content offsets and viewport clamps through the
      // existing public API, without resizing the docked grid to window dimensions.
      if (!api.groups.some(group => group.api.location.type === 'floating')) return
      measuring = true
      try {
        api.layout(root.clientWidth, root.clientHeight)
      } finally {
        measuring = false
      }
    }
    const schedule = (): void => {
      if (disposed || frame !== undefined) return
      frame = view.requestAnimationFrame(() => {
        frame = undefined
        measure()
      })
    }
    const onScroll = (event: Event): void => {
      const target = event.target
      // Chat/composer descendants scroll constantly without moving this mount.
      if (target === root.ownerDocument || (target instanceof view.Element && target.contains(root))) schedule()
    }
    const observer = new view.ResizeObserver(schedule)
    observer.observe(root)
    if (root.parentElement !== null) observer.observe(root.parentElement)
    const layout = api.onDidLayoutChange(schedule)
    const mutation = api.onDidMutateLayout(schedule)
    view.addEventListener('resize', schedule)
    root.ownerDocument.addEventListener('scroll', onScroll, true)
    // A completed frame collapse can move a same-sized surface. This is a bounded
    // event-triggered remeasure, not a polling loop or a document mutation observer.
    root.ownerDocument.addEventListener('transitionend', schedule, true)
    measure()
    return () => {
      disposed = true
      if (frame !== undefined) view.cancelAnimationFrame(frame)
      observer.disconnect()
      releaseLayers()
      layout.dispose()
      mutation.dispose()
      view.removeEventListener('resize', schedule)
      root.ownerDocument.removeEventListener('scroll', onScroll, true)
      root.ownerDocument.removeEventListener('transitionend', schedule, true)
      if (oldX === '') root.style.removeProperty(ROOT_X)
      else root.style.setProperty(ROOT_X, oldX)
      if (oldY === '') root.style.removeProperty(ROOT_Y)
      else root.style.setProperty(ROOT_Y, oldY)
    }
  }
}
