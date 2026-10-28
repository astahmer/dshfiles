import { readFileSync } from 'node:fs'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createDockview, type DockviewApi } from 'dockview-react'
import { useEffect, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createLayoutStore, WORKBENCH_COMPONENT } from './layout-store.js'
import { createWorkbenchPanelRegistry } from './registry.js'
import { WorkbenchView } from './workbench-view.js'
import { WindowFloatingGeometry } from './window-floating.js'

class ObservedSize {
  static instances: ObservedSize[] = []
  readonly elements = new Set<Element>()
  readonly disconnect = vi.fn(() => this.elements.clear())
  constructor(readonly callback: ResizeObserverCallback) {
    ObservedSize.instances.push(this)
  }
  observe(element: Element): void {
    this.elements.add(element)
  }
  unobserve(element: Element): void {
    this.elements.delete(element)
  }
}

const disposers: Array<() => void> = []
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', ObservedSize)
  ObservedSize.instances = []
})
afterEach(() => {
  cleanup()
  for (const dispose of disposers.splice(0).reverse()) dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const nativeSurface = () => {
  const root = document.createElement('div')
  const mount = document.createElement('div')
  root.append(mount)
  document.body.append(root)
  let rect = new DOMRect(40, 60, 260, 400)
  const bounds = vi.spyOn(root, 'getBoundingClientRect').mockImplementation(() => rect)
  Object.defineProperty(root, 'clientWidth', { get: () => rect.width })
  Object.defineProperty(root, 'clientHeight', { get: () => rect.height })
  const api = createDockview(mount, {
    defaultRenderer: 'always',
    floatingGroupBounds: 'boundedWithinViewport',
    createComponent: () => ({ element: document.createElement('div'), init: () => undefined }),
  })
  api.layout(260, 400)
  const panel = api.addPanel({ id: 'one', component: 'body' })
  disposers.push(() => {
    api.dispose()
    root.remove()
  })
  return {
    root,
    api,
    panel,
    bounds,
    move: (next: DOMRect) => {
      rect = next
    },
  }
}

const flush = (): void => {
  vi.advanceTimersByTime(40)
}

const memoryStore = () => {
  const values = new Map<string, string>()
  return createLayoutStore({
    storage: () => ({
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => {
        values.set(key, value)
      },
      removeItem: key => {
        values.delete(key)
      },
    }),
  })
}

describe('window floating geometry', () => {
  it('admits exactly the four explicit root regions, not standalone or nested Dockviews', () => {
    for (const region of ['main', 'left', 'right', 'bottom'] as const) expect(WindowFloatingGeometry.supports(region)).toBe(true)
    expect(WindowFloatingGeometry.supports(undefined)).toBe(false)
    expect(WindowFloatingGeometry.supports('nested/main/one')).toBe(false)
    expect(WindowFloatingGeometry.supports('nested/left/one/two')).toBe(false)
  })

  it('primes the origin synchronously before native restoration and suppresses unchanged style writes', () => {
    const surface = nativeSurface()
    const write = vi.spyOn(surface.root.style, 'setProperty')
    WindowFloatingGeometry.prepare(surface.root)
    expect(surface.root.style.getPropertyValue('--dshfiles-workbench-root-x')).toBe('40px')
    expect(surface.root.style.getPropertyValue('--dshfiles-workbench-root-y')).toBe('60px')
    expect(write).toHaveBeenCalledTimes(2)
    write.mockClear()
    WindowFloatingGeometry.prepare(surface.root)
    disposers.push(WindowFloatingGeometry.retain(surface.root, surface.api))
    expect(write).not.toHaveBeenCalled()
  })

  it('remeasures owned offsets after frame movement without replacing a real native panel or sizing its grid to the window', () => {
    const surface = nativeSurface()
    const dispose = WindowFloatingGeometry.retain(surface.root, surface.api)
    disposers.push(dispose)
    expect(surface.root.style.getPropertyValue('--dshfiles-workbench-root-x')).toBe('40px')
    expect(surface.root.style.getPropertyValue('--dshfiles-workbench-root-y')).toBe('60px')
    surface.api.addFloatingGroup(surface.panel)
    flush()
    const layout = vi.spyOn(surface.api, 'layout')
    const write = vi.spyOn(surface.root.style, 'setProperty')
    surface.move(new DOMRect(70, 90, 260, 400))
    document.dispatchEvent(new Event('transitionend', { bubbles: true }))
    flush()
    expect(surface.root.style.getPropertyValue('--dshfiles-workbench-root-x')).toBe('70px')
    expect(surface.root.style.getPropertyValue('--dshfiles-workbench-root-y')).toBe('90px')
    expect(layout).toHaveBeenCalledWith(260, 400)
    expect(surface.api.getPanel('one')).toBe(surface.panel)
    expect(surface.panel.api.location.type).toBe('floating')
    write.mockClear()
    layout.mockClear()
    window.dispatchEvent(new Event('resize'))
    document.dispatchEvent(new Event('scroll', { bubbles: true }))
    flush()
    expect(write).not.toHaveBeenCalled()
    expect(layout).not.toHaveBeenCalled()
  })

  it('ignores descendant chat scrolling but remeasures ancestor and document scrolling', () => {
    const surface = nativeSurface()
    const child = document.createElement('div')
    surface.root.append(child)
    disposers.push(WindowFloatingGeometry.retain(surface.root, surface.api))
    flush()
    surface.bounds.mockClear()
    child.dispatchEvent(new Event('scroll'))
    flush()
    expect(surface.bounds).not.toHaveBeenCalled()
    document.body.dispatchEvent(new Event('scroll'))
    flush()
    expect(surface.bounds).toHaveBeenCalledOnce()
    document.dispatchEvent(new Event('scroll'))
    flush()
    expect(surface.bounds).toHaveBeenCalledTimes(2)
  })

  it('clamps existing floats on viewport resize through the unchanged source API', () => {
    const surface = nativeSurface()
    surface.api.addFloatingGroup(surface.panel)
    disposers.push(WindowFloatingGeometry.retain(surface.root, surface.api))
    const layout = vi.spyOn(surface.api, 'layout')
    vi.stubGlobal('innerWidth', window.innerWidth + 100)
    window.dispatchEvent(new Event('resize'))
    flush()
    expect(layout).toHaveBeenCalledWith(260, 400)
    expect(surface.api.getPanel('one')).toBe(surface.panel)
  })

  it('keeps useful offsets while hidden and releases observers, native subscriptions and pending frames on disposal', () => {
    const surface = nativeSurface()
    surface.root.style.setProperty('--dshfiles-workbench-root-x', '12px')
    const dispose = WindowFloatingGeometry.retain(surface.root, surface.api)
    const observer = ObservedSize.instances.find(candidate => candidate.elements.has(surface.root))
    expect(observer).toBeDefined()
    surface.move(new DOMRect())
    document.dispatchEvent(new Event('scroll', { bubbles: true }))
    flush()
    expect(surface.root.style.getPropertyValue('--dshfiles-workbench-root-x')).toBe('40px')
    surface.move(new DOMRect(80, 100, 260, 400))
    document.dispatchEvent(new Event('scroll', { bubbles: true }))
    dispose()
    const calls = surface.bounds.mock.calls.length
    expect(observer?.disconnect).toHaveBeenCalledOnce()
    expect(surface.root.style.getPropertyValue('--dshfiles-workbench-root-x')).toBe('12px')
    expect(surface.root.style.getPropertyValue('--dshfiles-workbench-root-y')).toBe('')
    surface.api.addFloatingGroup(surface.panel)
    window.dispatchEvent(new Event('resize'))
    document.dispatchEvent(new Event('transitionend', { bubbles: true }))
    flush()
    expect(surface.bounds).toHaveBeenCalledTimes(calls)
  })

  it('scopes native fixed chrome and content to the exact root Dockview, not a nested surface', async () => {
    // jsdom has no layout. Give native always-rendering a nonzero reference box
    // so it can finish its real location transition instead of retaining a 0x0
    // staging box. Actual pixels and hit testing belong to the browser journey.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 260, 400))
    const sheet = document.createElement('style')
    sheet.textContent = readFileSync(`${import.meta.dirname}/dockview-theme.css`, 'utf8')
    document.head.append(sheet)
    disposers.push(() => sheet.remove())
    let nestedApi: DockviewApi | undefined
    const nestedRegistry = createWorkbenchPanelRegistry()
    nestedRegistry.register({ id: 'child', title: 'Child', component: () => <span>Nested body</span> })
    const registry = createWorkbenchPanelRegistry()
    registry.register({
      id: 'container',
      title: 'Container',
      component: () => (
        <WorkbenchView
          registry={nestedRegistry}
          store={memoryStore()}
          t={key => key}
          region="nested/left/one"
          defaultLayout="empty"
          onApi={ready => {
            nestedApi = ready
          }}
        />
      ),
    })
    let rootApi: DockviewApi | undefined
    const view = render(
      <WorkbenchView
        registry={registry}
        store={memoryStore()}
        t={key => key}
        region="left"
        defaultLayout="empty"
        onApi={ready => {
          rootApi = ready
        }}
      />,
    )
    if (rootApi === undefined) throw new Error('Root API missing')
    // oxlint-disable-next-line antislop/no-passthrough-variable -- Snapshot the guarded mutable onApi binding so act callbacks retain its non-undefined type.
    const root = rootApi
    act(() => {
      root.addPanel({ id: 'container', component: WORKBENCH_COMPONENT })
    })
    if (nestedApi === undefined) throw new Error('Nested API missing')
    // oxlint-disable-next-line antislop/no-passthrough-variable -- Snapshot the guarded mutable nested onApi binding before capturing it in act.
    const child = nestedApi
    act(() => {
      const panel = child.addPanel({ id: 'child', component: WORKBENCH_COMPONENT })
      child.addFloatingGroup(panel)
    })
    act(flush)
    expect(view.container.querySelectorAll('[data-workbench-window-floats]')).toHaveLength(1)
    const nested = view.container.querySelector('[data-workbench-region="nested/left/one"] .dv-resize-container')
    if (!(nested instanceof HTMLElement)) throw new Error('Nested native float missing')
    expect(getComputedStyle(nested).position).not.toBe('fixed')
    const containerPanel = rootApi.getPanel('container')
    if (containerPanel === undefined) throw new Error('Container panel missing')
    act(() => root.addFloatingGroup(containerPanel))
    await act(async () => {
      await Promise.resolve()
      flush()
      await Promise.resolve()
      flush()
    })
    const chrome = view.container.querySelector('[data-workbench-window-floats] > div > .dv-shell > .dv-floating-overlay-host > .dv-resize-container')
    const content = view.container.querySelector('[data-workbench-window-floats] > div > .dv-shell > .dv-render-overlay-float')
    if (!(chrome instanceof HTMLElement) || !(content instanceof HTMLElement)) throw new Error('Root native floating layers missing')
    expect(getComputedStyle(chrome).position).toBe('fixed')
    expect(getComputedStyle(content).position).toBe('fixed')
    expect(getComputedStyle(nested).position).not.toBe('fixed')
    expect(view.container.querySelector<HTMLElement>('[data-workbench-panel-id="container"]')?.style.contain).toBe('layout paint')
  })

  it('preserves the genuine React draft element, component instance and native panel through root floating', () => {
    let mounts = 0
    const Draft = (): JSX.Element => {
      const [value, setValue] = useState('')
      useEffect(() => {
        mounts += 1
      }, [])
      return <textarea aria-label="Floating draft" value={value} onChange={event => setValue(event.target.value)} />
    }
    const registry = createWorkbenchPanelRegistry()
    registry.register({ id: 'draft', title: 'Draft', component: Draft })
    let api: DockviewApi | undefined
    const view = render(
      <WorkbenchView
        registry={registry}
        store={memoryStore()}
        t={key => key}
        region="left"
        defaultLayout="empty"
        onApi={ready => {
          api = ready
        }}
      />,
    )
    if (api === undefined) throw new Error('Root API missing')
    // oxlint-disable-next-line antislop/no-passthrough-variable -- Snapshot the guarded mutable onApi binding so act callbacks retain its non-undefined type.
    const root = api
    act(() => {
      root.addPanel({ id: 'draft', component: WORKBENCH_COMPONENT })
    })
    const panel = root.getPanel('draft')
    const draft = view.getByLabelText('Floating draft')
    if (panel === undefined || !(draft instanceof HTMLTextAreaElement)) throw new Error('Draft missing')
    fireEvent.change(draft, { target: { value: 'keep this draft' } })
    act(() => root.addFloatingGroup(panel))
    act(flush)
    expect(root.getPanel('draft')).toBe(panel)
    expect(view.getByLabelText('Floating draft')).toBe(draft)
    expect(draft.value).toBe('keep this draft')
    expect(mounts).toBe(1)
  })
})
