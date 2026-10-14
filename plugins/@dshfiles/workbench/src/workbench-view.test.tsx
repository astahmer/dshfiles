import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Orientation, type DockviewApi } from 'dockview-react'
import { useEffect, useState } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { createLayoutStore } from './layout-store.js'
import type { WorkbenchTranslate } from './locales.js'
import { createWorkbenchPanelRegistry, type WorkbenchPanelProps, type WorkbenchPanelRegistry } from './registry.js'
import { WorkbenchView } from './workbench-view.js'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
})

afterEach(cleanup)

const t: WorkbenchTranslate = (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`)

const memoryStorage = () => {
  const values = new Map<string, string>()
  return () => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
  })
}

const mounts = new Map<string, number>()

const DraftPanel = (props: WorkbenchPanelProps): JSX.Element => {
  const [draft, setDraft] = useState('')
  useEffect(() => {
    mounts.set(props.panelId, (mounts.get(props.panelId) ?? 0) + 1)
  }, [props.panelId])
  return <textarea aria-label={`draft ${props.panelId}`} value={draft} onChange={event => setDraft(event.target.value)} />
}

const registryWith = (...ids: string[]): WorkbenchPanelRegistry => {
  const registry = createWorkbenchPanelRegistry()
  for (const id of ids) registry.register({ id, title: id, component: DraftPanel })
  return registry
}

const renderWorkbench = (registry: WorkbenchPanelRegistry, storage = memoryStorage()) => {
  let api: DockviewApi | undefined
  const store = createLayoutStore({ storage })
  const view = render(<WorkbenchView registry={registry} store={store} t={t} onApi={ready => (api = ready)} />)
  if (api === undefined) throw new Error('Dockview did not become ready')
  return { api, store, storage, view }
}

/** Dockview buffers layout-change events to the next task, and the store saves on that event. */
const flushLayoutChange = () => act(() => new Promise(resolve => setTimeout(resolve, 0)))

const draftOf = (id: string): HTMLTextAreaElement => {
  const element = screen.getByLabelText(`draft ${id}`)
  if (!(element instanceof HTMLTextAreaElement)) throw new Error(`${id} is not a textarea`)
  return element
}

describe('WorkbenchView', () => {
  it('opens the first two registered panels side by side by default', () => {
    const { api } = renderWorkbench(registryWith('a', 'b', 'c'))
    expect(api.groups).toHaveLength(2)
    expect(api.panels.map(panel => panel.id).sort()).toEqual(['a', 'b', 'c'])
    expect(api.getPanel('c')?.group).toBe(api.getPanel('a')?.group)
  })

  it('opens the Editor alone by default and leaves the other panels to Add panel', () => {
    const { api } = renderWorkbench(registryWith('other-plugin.panel', 'dshfiles-editor.main', 'other'))
    expect(api.panels.map(panel => panel.id)).toEqual(['dshfiles-editor.main'])
    expect(api.getPanel('dshfiles-editor.main')?.api.isActive).toBe(true)
  })

  it('keeps a panel mounted with its draft while it is tabbed, split, floated and moved back', () => {
    mounts.clear()
    const { api } = renderWorkbench(registryWith('a', 'b'))
    fireEvent.change(draftOf('a'), { target: { value: 'unsaved draft' } })
    const panel = api.getPanel('a')
    const target = api.getPanel('b')?.group
    if (panel === undefined || target === undefined) throw new Error('default layout is missing a panel')

    act(() => panel.api.moveTo({ group: target, position: 'center' }))
    expect(api.groups).toHaveLength(1)
    act(() => panel.api.moveTo({ group: target, position: 'left' }))
    expect(api.groups).toHaveLength(2)
    act(() => api.addFloatingGroup(panel))
    expect(panel.group.api.location.type).toBe('floating')
    act(() => panel.api.moveTo({ group: target, position: 'center' }))
    expect(panel.group).toBe(target)

    expect(mounts.get('a')).toBe(1)
    expect(draftOf('a').value).toBe('unsaved draft')
  })

  it('restores the saved layout after a reload', async () => {
    const storage = memoryStorage()
    const first = renderWorkbench(registryWith('a', 'b'), storage)
    const b = first.api.getPanel('b')
    const target = first.api.getPanel('a')?.group
    if (b === undefined || target === undefined) throw new Error('default layout is missing a panel')
    act(() => b.api.moveTo({ group: target, position: 'center' }))
    expect(first.api.groups).toHaveLength(1)
    await flushLayoutChange()
    first.view.unmount()

    const second = renderWorkbench(registryWith('a', 'b'), storage)
    expect(second.api.groups).toHaveLength(1)
    expect(second.api.panels.map(panel => panel.id).sort()).toEqual(['a', 'b'])
  })

  it('resets to the default layout and saves it', async () => {
    const { api, store } = renderWorkbench(registryWith('a', 'b'))
    const b = api.getPanel('b')
    if (b === undefined) throw new Error('default layout is missing b')
    act(() => b.api.close())
    expect(api.panels).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'resetLayout' }))
    expect(api.panels.map(panel => panel.id).sort()).toEqual(['a', 'b'])
    await flushLayoutChange()
    expect(Object.keys(store.get()?.panels ?? {}).sort()).toEqual(['a', 'b'])
  })

  it('keeps a saved panel whose plugin is gone as a closable placeholder that recovers on registration', async () => {
    const storage = memoryStorage()
    const first = renderWorkbench(registryWith('a', 'gone'), storage)
    act(() => first.api.getPanel('gone')?.api.setActive())
    await flushLayoutChange()
    first.view.unmount()

    const registry = registryWith('a')
    const { api } = renderWorkbench(registry, storage)
    expect(screen.getByText('missingPanel:{"id":"gone"}')).toBeTruthy()

    act(() => void registry.register({ id: 'gone', title: 'gone', component: DraftPanel }))
    expect(screen.queryByText('missingPanel:{"id":"gone"}')).toBeNull()
    expect(draftOf('gone')).toBeTruthy()

    act(() => void registry.register({ id: 'gone', title: 'gone', component: () => null })())
    // Dockview's render overlay has no size under jsdom, so it stays `visibility: hidden` and role queries skip it.
    fireEvent.click(screen.getByText('closePanel'))
    expect(api.panels.map(panel => panel.id)).toEqual(['a'])
  })

  it('falls back to the default layout when Dockview rejects the saved one', () => {
    const storage = memoryStorage()
    createLayoutStore({ storage }).set({
      grid: { root: { type: 'leaf', data: [] }, width: 1, height: 1, orientation: Orientation.HORIZONTAL },
      panels: {},
    })
    const { api } = renderWorkbench(registryWith('a'), storage)
    expect(api.panels.map(panel => panel.id)).toEqual(['a'])
  })

  it('opens a panel another plugin asks for, even when asked before the view mounted', () => {
    const registry = registryWith('a', 'b', 'late')
    registry.open('late')
    const storage = memoryStorage()
    const { api } = renderWorkbench(registry, storage)
    expect(api.getPanel('late')?.api.isActive).toBe(true)
    act(() => api.getPanel('late')?.api.close())

    act(() => registry.open('late'))
    expect(api.getPanel('late')).toBeDefined()
    expect(registry.hasOpenRequests()).toBe(false)
  })
})
