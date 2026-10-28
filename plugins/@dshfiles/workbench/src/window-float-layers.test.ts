import { fireEvent } from '@testing-library/react'
import { createDockview, type DockviewApi, type IDockviewPanel } from 'dockview-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWindowFloatLayers } from './window-float-layers.js'

const disposers: Array<() => void> = []
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
})
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const source = (parent: HTMLElement = document.body, rootRegion = true) => {
  const root = document.createElement('div')
  if (rootRegion) root.setAttribute('data-workbench-window-floats', '')
  const mount = document.createElement('div')
  root.append(mount)
  parent.append(root)
  const bodies = new Map<string, HTMLTextAreaElement>()
  const api = createDockview(mount, {
    defaultRenderer: 'always',
    createComponent: options => {
      const element = document.createElement('textarea')
      element.dataset.workbenchPanelId = options.id
      bodies.set(options.id, element)
      return { element, init: () => undefined }
    },
  })
  api.layout(400, 400)
  disposers.push(() => {
    api.dispose()
    root.remove()
  })
  const add = (id: string, floating = true): IDockviewPanel => {
    const panel = api.addPanel({ id, component: 'body' })
    if (floating) api.addFloatingGroup(panel)
    return panel
  }
  const body = (id: string): HTMLElement => {
    const element = bodies.get(id)?.closest<HTMLElement>('.dv-render-overlay')
    if (element === undefined || element === null) throw new Error(`Missing native body ${id}`)
    return element
  }
  return { root, api, add, body, bodies }
}

const chrome = (panel: IDockviewPanel): HTMLElement => {
  const element = panel.group.element.closest<HTMLElement>('.dv-resize-container')
  if (element === null) throw new Error(`Missing native chrome ${panel.id}`)
  return element
}
const title = (panel: IDockviewPanel): HTMLElement => {
  const element = chrome(panel).querySelector<HTMLElement>('.dv-floating-titlebar')
  if (element === null) throw new Error('Missing native titlebar')
  return element
}
const rank = (element: HTMLElement): string => element.style.getPropertyValue('--dshfiles-workbench-window-rank')
const flush = (): void => {
  vi.advanceTimersByTime(40)
}

const retain = (owner: ReturnType<typeof createWindowFloatLayers>, root: HTMLElement, api: DockviewApi): (() => void) => {
  const dispose = owner.retain(root, api)
  disposers.push(dispose)
  return dispose
}

describe('native root floating presentation layers', () => {
  it('raises an already-locally-active older window across APIs on its real titlebar or focused body without mutating native order', () => {
    const owner = createWindowFloatLayers(document)
    const left = source()
    const main = source()
    retain(owner, left.root, left.api)
    retain(owner, main.root, main.api)
    const older = left.add('older')
    const newer = main.add('newer')
    flush()
    const oldChrome = chrome(older)
    const newChrome = chrome(newer)
    const native = [oldChrome, newChrome].map(element => ({ aria: element.getAttribute('aria-level'), z: element.style.zIndex }))
    expect(rank(oldChrome)).toBe('0')
    expect(rank(newChrome)).toBe('1')
    expect(left.api.activePanel).toBe(older)
    expect(main.api.activePanel).toBe(newer)
    fireEvent.pointerDown(title(older))
    fireEvent.pointerUp(title(older))
    expect(rank(oldChrome)).toBe('1')
    expect(rank(left.body('older'))).toBe('1')
    expect(rank(newChrome)).toBe('0')
    main.bodies.get('newer')?.focus()
    expect(rank(newChrome)).toBe('1')
    expect(rank(main.body('newer'))).toBe('1')
    expect(rank(oldChrome)).toBe('0')
    expect([oldChrome, newChrome].map(element => ({ aria: element.getAttribute('aria-level'), z: element.style.zIndex }))).toEqual(native)
    expect(left.api.activePanel).toBe(older)
    expect(main.api.activePanel).toBe(newer)
    expect(left.api.getPanel('older')).toBe(older)
  })

  it('promotes only the clicked window, not unrelated floats from its API, with compact bounded ranks', () => {
    const owner = createWindowFloatLayers(document)
    const left = source()
    const main = source()
    retain(owner, left.root, left.api)
    retain(owner, main.root, main.api)
    const first = left.add('first')
    const second = left.add('second')
    const third = main.add('third')
    flush()
    const firstBody = left.bodies.get('first')
    if (firstBody === undefined) throw new Error('Missing first body')
    firstBody.value = 'retained draft'
    fireEvent.pointerDown(left.body('first'))
    fireEvent.pointerUp(left.body('first'))
    expect([rank(chrome(first)), rank(chrome(second)), rank(chrome(third))]).toEqual(['2', '0', '1'])
    for (let i = 0; i < 20; i += 1) {
      fireEvent.focusIn(left.body('second'))
      fireEvent.focusIn(left.body('first'))
    }
    expect([rank(chrome(first)), rank(chrome(second)), rank(chrome(third))]).toEqual(['2', '1', '0'])
    expect(left.bodies.get('first')).toBe(firstBody)
    expect(firstBody.value).toBe('retained draft')
    expect(left.api.getPanel('first')).toBe(first)
    const newest = main.add('newest')
    expect(rank(chrome(newest))).toBe('3')
  })

  it('associates every body in a split floating window with the same chrome and promotion', () => {
    const owner = createWindowFloatLayers(document)
    const left = source()
    const main = source()
    retain(owner, left.root, left.api)
    retain(owner, main.root, main.api)
    const first = left.add('first')
    const second = left.add('second', false)
    second.api.moveTo({ group: first.group, position: 'right' })
    const other = main.add('other')
    flush()
    expect(second.group).not.toBe(first.group)
    expect(second.api.location.type).toBe('floating')
    expect(chrome(second)).toBe(chrome(first))
    expect(rank(left.body('first'))).toBe('0')
    expect(rank(left.body('second'))).toBe('0')
    fireEvent.focusIn(left.body('second'))
    expect(rank(chrome(first))).toBe('1')
    expect(rank(left.body('first'))).toBe('1')
    expect(rank(left.body('second'))).toBe('1')
    expect(rank(chrome(other))).toBe('0')
    const removedBody = left.body('second')
    left.api.removePanel(second)
    expect(removedBody.hasAttribute('data-workbench-window-layer')).toBe(false)
    expect(rank(removedBody)).toBe('')
    expect(rank(chrome(first))).toBe('1')
    expect(rank(left.body('first'))).toBe('1')
  })

  it('unmarks a body that docks or closes and compacts remaining windows while leaving native styles intact', () => {
    const owner = createWindowFloatLayers(document)
    const left = source()
    const main = source()
    retain(owner, left.root, left.api)
    retain(owner, main.root, main.api)
    const grid = left.add('grid', false)
    const moving = left.add('moving')
    const oldChrome = chrome(moving)
    const oldBody = left.body('moving')
    const other = main.add('other')
    flush()
    moving.api.moveTo({ group: grid.group, position: 'center' })
    expect(oldChrome.hasAttribute('data-workbench-window-layer')).toBe(false)
    expect(oldBody.hasAttribute('data-workbench-window-layer')).toBe(false)
    expect(rank(oldBody)).toBe('')
    expect(rank(chrome(other))).toBe('0')
    expect(oldChrome.style.zIndex).not.toBe('')
    expect(left.api.getPanel('moving')).toBe(moving)
    const next = left.add('next')
    const nextChrome = chrome(next)
    const nextBody = left.body('next')
    left.api.removePanel(next)
    expect(nextChrome.hasAttribute('data-workbench-window-layer')).toBe(false)
    expect(nextBody.hasAttribute('data-workbench-window-layer')).toBe(false)
    expect(rank(chrome(other))).toBe('0')
  })

  it('disposes only its root windows, pending frame and listeners; disposed native APIs can keep working unmarked', () => {
    const owner = createWindowFloatLayers(document)
    const left = source()
    const main = source()
    const release = retain(owner, left.root, left.api)
    retain(owner, main.root, main.api)
    const first = left.add('first')
    const second = main.add('second')
    const oldChrome = chrome(first)
    const oldBody = left.body('first')
    const cancel = vi.spyOn(window, 'cancelAnimationFrame')
    release()
    expect(cancel).toHaveBeenCalled()
    expect(oldChrome.hasAttribute('data-workbench-window-layer')).toBe(false)
    expect(oldBody.hasAttribute('data-workbench-window-layer')).toBe(false)
    expect(rank(chrome(second))).toBe('0')
    left.add('after-disposal')
    fireEvent.focusIn(oldBody)
    flush()
    expect(left.root.querySelectorAll('[data-workbench-window-layer]')).toHaveLength(0)
    expect(rank(chrome(second))).toBe('0')
    expect(left.api.getPanel('first')).toBe(first)
  })

  it('does not register nested native windows even inside a marked root floating body', () => {
    const owner = createWindowFloatLayers(document)
    const outer = source()
    retain(owner, outer.root, outer.api)
    const parent = outer.add('parent')
    const child = source(outer.body('parent'), false)
    retain(owner, child.root, child.api)
    const nested = child.add('nested')
    flush()
    expect(chrome(parent).getAttribute('data-workbench-window-layer')).toBe('chrome')
    expect(chrome(nested).hasAttribute('data-workbench-window-layer')).toBe(false)
    expect(child.body('nested').hasAttribute('data-workbench-window-layer')).toBe(false)
  })

  it('rejects registration into another document without touching native layers', () => {
    const owner = createWindowFloatLayers(document.implementation.createHTMLDocument())
    const left = source()
    const panel = left.add('first')
    expect(() => owner.retain(left.root, left.api)).toThrow('own document')
    expect(chrome(panel).hasAttribute('data-workbench-window-layer')).toBe(false)
  })
})
