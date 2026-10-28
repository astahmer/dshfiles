import type { DockviewApi } from 'dockview-react'

const LAYER = 'data-workbench-window-layer'
const RANK = '--dshfiles-workbench-window-rank'

type FloatWindow = { readonly chrome: HTMLElement; readonly bodies: Set<HTMLElement> }

/** A DOM presentation order, never panel identity, native focus or saved layout. */
export interface WindowFloatLayers {
  retain(root: HTMLElement, api: DockviewApi): () => void
}

/** Injectable per-document owner; ranks stay compact and only live windows exist. */
export const createWindowFloatLayers = (document: Document): WindowFloatLayers => {
  const windows: FloatWindow[] = []
  const chromeWindows = new Map<HTMLElement, FloatWindow>()
  const layerWindows = new Map<HTMLElement, FloatWindow>()

  const clear = (element: HTMLElement, window: FloatWindow): void => {
    if (layerWindows.get(element) !== window) return
    layerWindows.delete(element)
    element.removeAttribute(LAYER)
    element.style.removeProperty(RANK)
  }
  const order = (): void => {
    windows.forEach((window, rank) => {
      for (const element of [window.chrome, ...window.bodies]) {
        const role = element === window.chrome ? 'chrome' : 'body'
        if (element.getAttribute(LAYER) !== role) element.setAttribute(LAYER, role)
        if (element.style.getPropertyValue(RANK) !== `${rank}`) element.style.setProperty(RANK, `${rank}`)
        layerWindows.set(element, window)
      }
    })
  }
  const remove = (window: FloatWindow): void => {
    clear(window.chrome, window)
    for (const body of window.bodies) clear(body, window)
    window.bodies.clear()
    chromeWindows.delete(window.chrome)
    const index = windows.indexOf(window)
    if (index !== -1) windows.splice(index, 1)
  }
  const promote = (window: FloatWindow): void => {
    if (windows.at(-1) === window) return
    const index = windows.indexOf(window)
    if (index === -1) return
    windows.splice(index, 1)
    windows.push(window)
    order()
  }

  return {
    retain(root, api) {
      if (root.ownerDocument !== document) throw new Error('Floating layers belong to their own document')
      if (!root.hasAttribute('data-workbench-window-floats')) return () => undefined
      const view = document.defaultView
      if (view === null) return () => undefined
      const owned = new Set<FloatWindow>()
      let disposed = false
      let frame: number | undefined

      const sync = (): void => {
        if (disposed) return
        // Exact direct native shell only. A nested Dockview inside a registered
        // body must never join the root window stack or lose its local bounds.
        const shell = root.querySelector(':scope > div > .dv-shell')
        const host = shell?.querySelector(':scope > .dv-floating-overlay-host')
        const next = new Map<HTMLElement, Set<HTMLElement>>()
        const bodies = new Map<string, HTMLElement>()
        for (const panel of root.querySelectorAll<HTMLElement>('[data-workbench-panel-id]')) {
          const body = panel.closest<HTMLElement>('.dv-render-overlay')
          const id = panel.dataset.workbenchPanelId
          if (id !== undefined && body?.parentElement === shell) bodies.set(id, body)
        }
        for (const group of api.groups) {
          if (group.api.location.type !== 'floating') continue
          const chrome = group.element.closest<HTMLElement>('.dv-resize-container')
          if (chrome === null || chrome.parentElement !== host) continue
          const members = next.get(chrome) ?? new Set<HTMLElement>()
          next.set(chrome, members)
          for (const panel of group.panels) {
            const body = bodies.get(panel.id)
            if (body !== undefined) members.add(body)
          }
        }
        for (const window of owned) {
          if (!next.has(window.chrome)) {
            remove(window)
            owned.delete(window)
          }
        }
        for (const [chrome, bodies] of next) {
          let window = chromeWindows.get(chrome)
          if (window === undefined) {
            window = { chrome, bodies: new Set() }
            chromeWindows.set(chrome, window)
            windows.push(window)
            owned.add(window)
          }
          for (const body of window.bodies) {
            if (!bodies.has(body)) {
              clear(body, window)
              window.bodies.delete(body)
            }
          }
          for (const body of bodies) {
            const previous = layerWindows.get(body)
            if (previous !== undefined && previous !== window) previous.bodies.delete(body)
            window.bodies.add(body)
          }
        }
        order()
      }
      const refresh = (): void => {
        sync()
        // React may commit an owned panel marker after the native mutation. One
        // event-triggered frame fills in that body's association, without polling
        // or observing the document tree.
        if (disposed || frame !== undefined) return
        frame = view.requestAnimationFrame(() => {
          frame = undefined
          sync()
        })
      }
      const interact = (event: Event): void => {
        sync()
        const target = event.target
        if (!(target instanceof view.Element)) return
        const layer = target.closest<HTMLElement>(`[${LAYER}]`)
        const window = layer === null ? undefined : layerWindows.get(layer)
        if (window !== undefined && owned.has(window)) promote(window)
      }
      const mutation = api.onDidMutateLayout(refresh)
      const layout = api.onDidLayoutChange(refresh)
      root.addEventListener('pointerdown', interact, true)
      root.addEventListener('focusin', interact, true)
      refresh()
      return () => {
        if (disposed) return
        disposed = true
        if (frame !== undefined) view.cancelAnimationFrame(frame)
        mutation.dispose()
        layout.dispose()
        root.removeEventListener('pointerdown', interact, true)
        root.removeEventListener('focusin', interact, true)
        for (const window of owned) remove(window)
        owned.clear()
        order()
      }
    },
  }
}

const documents = new WeakMap<Document, WindowFloatLayers>()

export const retainWindowFloatLayers = (root: HTMLElement, api: DockviewApi): (() => void) => {
  const document = root.ownerDocument
  let layers = documents.get(document)
  if (layers === undefined) {
    layers = createWindowFloatLayers(document)
    documents.set(document, layers)
  }
  return layers.retain(root, api)
}
