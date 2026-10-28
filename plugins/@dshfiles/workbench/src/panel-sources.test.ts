import { cleanup, render, screen } from '@testing-library/react'
import { createElement, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(cleanup)
import { createWorkbenchPanelRegistry } from './registry.js'
import { createMainPanelSources, registerMainPanelSources } from './panel-sources.js'

describe('main panel sources', () => {
  it('qualifies stock native templates and preserves producer-declared names', () => {
    const registry = createWorkbenchPanelRegistry()
    const sources = createMainPanelSources(registry)
    sources.sync(
      [
        { key: 'plugins', title: 'Plugins' },
        { key: 'schedules', title: 'Automation tasks' },
        { key: 'owned', title: 'Accounts: Overview' },
        { key: 'runtime/session', title: 'My conversation', hiddenFromAdd: true },
      ],
      () => null,
    )
    expect(registry.list().map(source => [source.id, source.title])).toEqual([
      ['main/plugins', 'Plugin Manager: Plugins'],
      ['main/schedules', 'Schedule: Automation tasks'],
      ['main/owned', 'Accounts: Overview'],
      ['main/runtime/session', 'My conversation'],
    ])
    sources.dispose()
  })

  it('keeps runtime entries restorable without offering them as reusable views', () => {
    const registry = createWorkbenchPanelRegistry()
    const sources = createMainPanelSources(registry)
    sources.sync([{ key: 'trajectory/session-a', title: 'Trajectory — A', hiddenFromAdd: true }], () => null)
    expect(registry.get('main/trajectory/session-a')?.hiddenFromAdd).toBe(true)
    sources.sync([{ key: 'trajectory/session-a', title: 'Trajectory — A', hiddenFromAdd: false }], () => null)
    expect(registry.get('main/trajectory/session-a')?.hiddenFromAdd).toBe(false)
    sources.dispose()
  })

  it('keeps source component identity across unrelated ledger and locale changes', () => {
    const registry = createWorkbenchPanelRegistry()
    const sources = createMainPanelSources(registry)
    sources.sync([{ key: 'plugins', title: 'Plugins' }], () => 'first renderer')
    const component = registry.get('main/plugins')?.component
    sources.sync(
      [
        { key: 'plugins', title: 'Plugins translated' },
        { key: 'other', title: 'Other' },
      ],
      () => 'current renderer',
    )
    expect(registry.get('main/plugins')?.component).toBe(component)
    expect(registry.get('main/plugins')?.title).toBe('Plugin Manager: Plugins translated')
    sources.sync([{ key: 'plugins', title: 'Plugins translated' }], () => 'latest renderer')
    expect(registry.get('main/plugins')?.component).toBe(component)
    expect(registry.get('main/other')).toBeUndefined()
    sources.dispose()
    expect(registry.list()).toEqual([])
  })

  it('uses the latest renderer without remounting component-local state', () => {
    const registry = createWorkbenchPanelRegistry()
    const sources = createMainPanelSources(registry)
    const mounts = vi.fn()
    const Body = ({ label }: { label: string }) => {
      const [draft] = useState(() => {
        mounts()
        return 'kept draft'
      })
      return createElement('div', { 'data-testid': 'source-body' }, `${label}:${draft}`)
    }
    sources.sync([{ key: 'plugins', title: 'Plugins' }], () => createElement(Body, { label: 'first' }))
    const Panel = registry.get('main/plugins')?.component
    if (Panel === undefined) throw new Error('Source not registered')
    const view = render(createElement(Panel, { panelId: 'main/plugins' }))
    sources.sync([{ key: 'plugins', title: 'Translated' }], () => createElement(Body, { label: 'latest' }))
    const Updated = registry.get('main/plugins')?.component
    if (Updated === undefined) throw new Error('Source disappeared')
    view.rerender(createElement(Updated, { panelId: 'main/plugins' }))
    expect(screen.getByTestId('source-body').textContent).toBe('latest:kept draft')
    expect(mounts).toHaveBeenCalledOnce()
    sources.dispose()
  })

  it('lets a later explicit contribution replace a synthesized source without deleting it', () => {
    const registry = createWorkbenchPanelRegistry()
    const sources = createMainPanelSources(registry)
    sources.sync([{ key: 'editor', title: 'Editor' }], () => null)
    const explicit = { id: 'editor.main', mainPanelId: 'editor', title: 'Custom editor', component: () => null }
    const dispose = registry.register(explicit)
    sources.sync([{ key: 'editor', title: 'Editor' }], () => null)
    expect(registry.list()).toEqual([explicit])
    dispose()
    sources.sync([{ key: 'editor', title: 'Editor' }], () => null)
    expect(registry.list().map(panel => panel.id)).toEqual(['main/editor'])
    sources.dispose()
  })

  it('offers every main key once, preserves explicit identities and excludes recursion', () => {
    const registry = createWorkbenchPanelRegistry()
    registry.register({ id: 'editor.main', mainPanelId: 'editor', title: 'Editor', component: () => null })
    const release = registerMainPanelSources(
      registry,
      [
        { key: 'conversation', title: 'Chat' },
        { key: 'dshfiles-workbench', title: 'Workbench' },
        { key: 'editor', title: 'Editor' },
        { key: 'plugins', title: 'Plugins' },
        { key: 'plugins', title: 'Plugins duplicate' },
        { key: 'community', title: 'Community page' },
      ],
      () => null,
    )
    expect(registry.list().map(panel => panel.id)).toEqual(['editor.main', 'main/plugins', 'main/community'])
    release()
    expect(registry.list().map(panel => panel.id)).toEqual(['editor.main'])
  })
})
