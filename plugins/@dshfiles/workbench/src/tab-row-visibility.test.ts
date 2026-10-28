import { createDockview, LocalSelectionTransfer, PanelTransfer, type DockviewApi } from 'dockview-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TabRows } from './tab-row-visibility.js'

const disposers: Array<() => void> = []
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  })
})
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose()
  LocalSelectionTransfer.getInstance<PanelTransfer>().clearData(PanelTransfer.prototype)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const surface = () => {
  const element = document.createElement('div')
  document.body.append(element)
  const mounts = vi.fn(() => ({ element: document.createElement('div'), init: () => undefined }))
  const api = createDockview(element, { defaultRenderer: 'always', createComponent: mounts })
  api.layout(1000, 600)
  disposers.push(() => {
    api.dispose()
    element.remove()
  })
  const persist = vi.fn(() => api.toJSON())
  const controller = TabRows.retain(api, persist)
  disposers.push(controller.dispose)
  const add = (id: string) => api.addPanel({ id, component: 'body' })
  return { api, add, persist, controller, mounts }
}

const nativeBody = (api: DockviewApi, panelId: string): HTMLElement => {
  const panel = api.getPanel(panelId)
  if (panel === undefined) throw new Error('Missing test panel')
  const content = panel.group.element.querySelector<HTMLElement>('.dv-content-container')
  if (content === null) throw new Error('Missing native content target')
  return content
}

const leafState = (api: DockviewApi) => {
  let data = api.toJSON().grid.root.data
  while (Array.isArray(data)) {
    const child = data[0]
    if (child === undefined) throw new Error('Expected a nonempty native group')
    data = child.data
  }
  return data
}

describe('native single-tab row visibility', () => {
  it('hides only on explicit intent, relayouts and saves native JSON without replacing content', () => {
    const view = surface()
    const panel = view.add('one')
    const body = nativeBody(view.api, panel.id)
    const relayout = vi.spyOn(panel.group, 'relayout')
    expect(panel.group.header.hidden).toBe(false)
    expect(TabRows.canHide(panel.group)).toBe(true)
    expect(TabRows.hide(view.api, panel.group)).toBe(true)
    expect(panel.group.header.hidden).toBe(true)
    expect(panel.group.element.querySelector<HTMLElement>('.dv-tabs-and-actions-container')?.style.display).toBe('none')
    expect(leafState(view.api).hideHeader).toBe(true)
    expect(relayout).toHaveBeenCalledOnce()
    expect(view.persist).toHaveBeenCalledOnce()
    expect(view.api.getPanel(panel.id)).toBe(panel)
    expect(nativeBody(view.api, panel.id)).toBe(body)
    expect(view.mounts).toHaveBeenCalledOnce()
    expect(TabRows.hide(view.api, panel.group)).toBe(false)
    expect(view.persist).toHaveBeenCalledOnce()
    expect(TabRows.show(view.api, panel.group)).toBe(true)
    expect(leafState(view.api).hideHeader).toBeUndefined()
    expect(view.persist).toHaveBeenCalledTimes(2)
  })

  it('restores native hideHeader and forgets it when a second panel arrives, even after returning to one', () => {
    const source = surface()
    const original = source.add('one')
    TabRows.hide(source.api, original.group)
    const restored = surface()
    restored.api.fromJSON(source.api.toJSON())
    const first = restored.api.getPanel('one')
    if (first === undefined) throw new Error('Restore lost the panel')
    expect(first.group.header.hidden).toBe(true)
    const second = restored.api.addPanel({ id: 'two', component: 'body', position: { referenceGroup: first.group } })
    expect(first.group.panels.length).toBe(2)
    expect(first.group.header.hidden).toBe(false)
    expect(TabRows.canHide(first.group)).toBe(false)
    expect(TabRows.hide(restored.api, first.group)).toBe(false)
    restored.api.removePanel(second)
    expect(first.group.panels.length).toBe(1)
    expect(first.group.header.hidden).toBe(false)
    expect(restored.persist).not.toHaveBeenCalled()
  })

  it('observes native model events during movingLock when component add events are suppressed', () => {
    const view = surface()
    const first = view.add('one')
    const second = view.api.addPanel({ id: 'two', component: 'body', position: { referencePanel: first, direction: 'right' } })
    TabRows.hide(view.api, first.group)
    const componentAdd = vi.fn()
    const subscription = view.api.onDidAddPanel(componentAdd)
    disposers.push(() => subscription.dispose())
    view.persist.mockClear()
    second.api.moveTo({ group: first.group, position: 'center' })
    expect(componentAdd).not.toHaveBeenCalled()
    expect(second.group).toBe(first.group)
    expect(first.group.panels.map(panel => panel.id)).toEqual(['one', 'two'])
    expect(first.group.header.hidden).toBe(false)
    expect(view.persist).not.toHaveBeenCalled()
    second.api.close()
    expect(first.group.header.hidden).toBe(false)
  })

  it('takes a real native center drop into hidden content and reveals the merged group', () => {
    const view = surface()
    const first = view.add('one')
    const second = view.api.addPanel({ id: 'two', component: 'body', position: { referencePanel: first, direction: 'right' } })
    TabRows.hide(view.api, first.group)
    const content = nativeBody(view.api, first.id)
    Object.defineProperties(content, { offsetWidth: { value: 500 }, offsetHeight: { value: 600 } })
    vi.spyOn(content, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 500, 600))
    LocalSelectionTransfer.getInstance<PanelTransfer>().setData([new PanelTransfer(view.api.id, second.group.id, second.id)], PanelTransfer.prototype)
    const foreignDrop = vi.fn()
    const subscription = view.api.onDidDrop(foreignDrop)
    disposers.push(() => subscription.dispose())
    content.dispatchEvent(new MouseEvent('dragenter', { bubbles: true, clientX: 250, clientY: 300 }))
    content.dispatchEvent(new MouseEvent('dragover', { bubbles: true, cancelable: true, clientX: 250, clientY: 300 }))
    content.dispatchEvent(new MouseEvent('drop', { bubbles: true, cancelable: true, clientX: 250, clientY: 300 }))
    expect(second.group).toBe(first.group)
    expect(first.group.panels.length).toBe(2)
    expect(first.group.header.hidden).toBe(false)
    expect(foreignDrop).not.toHaveBeenCalled()
    expect(view.api.getPanel('one')).toBe(first)
    expect(view.api.getPanel('two')).toBe(second)
  })

  it('normalizes multi-tab hidden groups on retain and fromJSON without re-hiding a new singleton', () => {
    const source = surface()
    const first = source.add('one')
    source.api.addPanel({ id: 'two', component: 'body', position: { referenceGroup: first.group } })
    source.controller.dispose()
    first.group.header.hidden = true
    const invalid = source.api.toJSON()
    const controller = TabRows.retain(source.api, source.persist)
    disposers.push(controller.dispose)
    expect(first.group.header.hidden).toBe(false)
    const restored = surface()
    restored.api.fromJSON(invalid)
    expect(restored.api.groups.every(group => !group.header.hidden)).toBe(true)
    restored.api.clear()
    const fresh = restored.add('fresh')
    expect(fresh.group.header.hidden).toBe(false)
  })

  it('preserves group intent across floating and splitting, but a new floating group starts shown', () => {
    const view = surface()
    const first = view.add('one')
    const other = view.api.addPanel({ id: 'other', component: 'body', position: { referencePanel: first, direction: 'right' } })
    const group = first.group
    TabRows.hide(view.api, group)
    view.api.addFloatingGroup(group)
    expect(first.group).toBe(group)
    expect(group.header.hidden).toBe(true)
    expect(group.api.location.type).toBe('floating')
    const restored = surface()
    restored.api.fromJSON(view.api.toJSON())
    expect(restored.api.getPanel('one')?.group.header.hidden).toBe(true)
    first.api.moveTo({ group: other.group, position: 'left' })
    expect(first.group.header.hidden).toBe(true)
    view.api.addFloatingGroup(first)
    expect(first.group).not.toBe(group)
    expect(first.group.header.hidden).toBe(false)
    expect(view.api.getPanel('one')).toBe(first)
  })

  it('notifies native-derived observers and shows all hidden rows in one explicit save', () => {
    const view = surface()
    const first = view.add('one')
    const second = view.api.addPanel({ id: 'two', component: 'body', position: { referencePanel: first, direction: 'right' } })
    const listener = vi.fn()
    const stop = view.controller.subscribe(listener)
    disposers.push(stop)
    const version = view.controller.getSnapshotVersion()
    TabRows.hide(view.api, first.group)
    TabRows.hide(view.api, second.group)
    expect(view.controller.getSnapshotVersion()).toBeGreaterThan(version)
    expect(listener).toHaveBeenCalled()
    view.persist.mockClear()
    TabRows.showAll(view.api)
    expect(view.api.groups.every(group => !group.header.hidden)).toBe(true)
    expect(view.persist).toHaveBeenCalledOnce()
    TabRows.showAll(view.api)
    expect(view.persist).toHaveBeenCalledOnce()
    stop()
    listener.mockClear()
    TabRows.hide(view.api, first.group)
    expect(listener).not.toHaveBeenCalled()
  })

  it('releases removed group observers, pending native listeners and the save callback on disposal', () => {
    const view = surface()
    const first = view.add('one')
    const listener = vi.fn()
    view.controller.subscribe(listener)
    const group = first.group
    view.api.removeGroup(group)
    listener.mockClear()
    const fresh = view.add('fresh')
    TabRows.hide(view.api, fresh.group)
    view.controller.dispose()
    listener.mockClear()
    view.persist.mockClear()
    view.api.addPanel({ id: 'after-dispose', component: 'body', position: { referenceGroup: fresh.group } })
    expect(fresh.group.header.hidden).toBe(true)
    expect(listener).not.toHaveBeenCalled()
    TabRows.show(view.api, fresh.group)
    expect(view.persist).not.toHaveBeenCalled()
  })

  it('rejects foreign groups and never automatically hides a split or a newly added tab', () => {
    const view = surface()
    const first = view.add('one')
    const foreign = surface()
    const outsider = foreign.add('outside')
    expect(TabRows.hide(view.api, outsider.group)).toBe(false)
    expect(outsider.group.header.hidden).toBe(false)
    const split = view.api.addPanel({ id: 'split', component: 'body', position: { referencePanel: first, direction: 'below' } })
    expect(split.group.header.hidden).toBe(false)
    expect(first.group.header.hidden).toBe(false)
  })
})
