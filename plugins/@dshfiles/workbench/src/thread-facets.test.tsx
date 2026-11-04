import type { SidebarRightGuideBox } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SidebarResourcePanels } from '@dshfiles/sidebar-right/resource-panels'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createDockview, type DockviewApi } from 'dockview-react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createNativePageAdmission } from './native-page-admission.js'
import { NewViewChooser } from './new-view-chooser.js'
import { NewViewTabs } from './new-view.js'
import { createWorkbenchPanelRegistry } from './registry.js'
import { ThreadFacets } from './thread-facets.js'

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
})
const surfaces: DockviewApi[] = []
afterEach(() => {
  cleanup()
  for (const api of surfaces.splice(0)) api.dispose()
})
const surface = (): DockviewApi => {
  const api = createDockview(document.createElement('div'), {
    createComponent: () => ({ element: document.createElement('div'), init: () => undefined }),
  })
  api.layout(900, 600)
  surfaces.push(api)
  return api
}

const box = (kind: string, order: number, title: string, extra: Partial<SidebarRightGuideBox> = {}): SidebarRightGuideBox => ({
  id: `${kind}-entry`,
  providerId: kind,
  kind,
  order,
  title: () => title,
  ...extra,
})

const observable = <T,>(initial: T) => {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => value,
    set: (next: T) => {
      value = next
      for (const listener of listeners) listener()
    },
  }
}

describe('ThreadFacets', () => {
  it('offers one facet per guide kind in guide order, without the guide, Terminal or the Workbench side panel', () => {
    const facets = ThreadFacets.fromGuide([
      box('guide', 1, 'Guide'),
      box('changes', 20, 'Changes', { description: () => "Review this thread's changes" }),
      box('terminal', 30, 'Terminal'),
      box('dshfiles-workbench-side-panel', 46, 'Workbench'),
      box('jobs', 60, 'Jobs'),
      box('cost', 61, 'Cost'),
      box('jobs', 70, 'Jobs again'),
    ])
    expect(facets.map(facet => [facet.kind, facet.title()])).toEqual([
      ['changes', 'Changes'],
      ['jobs', 'Jobs'],
      ['cost', 'Cost'],
    ])
    expect(facets[0]?.description?.()).toBe("Review this thread's changes")
  })

  it('follows only the single page of a facet kind', () => {
    const kinds = new Set(['cost'])
    expect(ThreadFacets.follows({ kind: 'cost', address: 'sidebar://cost' }, kinds)).toBe(true)
    expect(ThreadFacets.follows({ kind: 'cost', address: 'sidebar://cost/2f0c' }, kinds)).toBe(false)
    expect(ThreadFacets.follows({ kind: 'file', address: 'sidebar://file' }, kinds)).toBe(false)
  })

  it('registers launchers that track the guide and open the page for the on-screen thread in the chosen pane', () => {
    const registry = createWorkbenchPanelRegistry()
    const guide = observable<readonly SidebarRightGuideBox[]>([box('cost', 61, 'Cost')])
    const onScreen = observable<string | undefined>(undefined)
    const openPage = vi.fn<NonNullable<SidebarResourcePanels['openPage']>>((kind, beforePublish) => {
      const id = `resource/thread-a/${kind}`
      beforePublish(id)
      registry.register({ id, title: 'Cost', component: () => null, hiddenFromAdd: true })
      return true
    })
    const admission = createNativePageAdmission({ openPage, close: vi.fn() }, registry)
    const source = ThreadFacets.create({ guide, onScreen, registry, admission })
    const stop = source.start()
    expect(registry.get(ThreadFacets.sourceId('cost'))?.threadFacet?.kind).toBe('cost')

    guide.set([box('cost', 61, 'Cost'), box('jobs', 60, 'Jobs')])
    expect(registry.get(ThreadFacets.sourceId('jobs'))?.title).toBe('Jobs')
    expect(source.follows({ kind: 'jobs', address: 'sidebar://jobs' })).toBe(true)

    const api = surface()
    const chooser = NewViewTabs.open(api)
    const cost = registry.get(ThreadFacets.sourceId('cost'))
    if (cost === undefined) throw new Error('missing Cost launcher')
    // No thread on screen: nothing is asked of the native owner.
    expect(source.open(cost, api, { group: chooser.group, replacePanelId: chooser.id })).toBe(false)
    expect(openPage).not.toHaveBeenCalled()

    onScreen.set('thread-a')
    expect(source.open(cost, api, { group: chooser.group, replacePanelId: chooser.id })).toBe(true)
    expect(openPage).toHaveBeenCalledWith('cost', expect.any(Function))
    expect(admission.admit('resource/thread-a/cost')).toBe(true)
    expect(api.getPanel('resource/thread-a/cost')?.group).toBe(chooser.group)
    expect(api.getPanel(chooser.id)).toBeUndefined()

    stop()
    expect(registry.get(ThreadFacets.sourceId('cost'))).toBeUndefined()
    expect(registry.get(ThreadFacets.sourceId('jobs'))).toBeUndefined()
  })

  it('lists facets under Thread panels with their description, disabled until a thread is on screen', () => {
    const registry = createWorkbenchPanelRegistry()
    const guide = observable<readonly SidebarRightGuideBox[]>([
      box('cost', 61, 'Cost', { description: () => "This thread's route and cost per turn." }),
      box('changes', 20, 'Changes'),
    ])
    const onScreen = observable<string | undefined>(undefined)
    const source = ThreadFacets.create({ guide, onScreen, registry, admission: createNativePageAdmission({ close: vi.fn() }, registry) })
    source.start()
    registry.register({ id: 'backlog', title: 'Backlog', component: () => null })
    const select = vi.fn()
    const view = render(<NewViewChooser definitions={registry.list()} onSelect={select} />)
    const group = screen.getByRole('group', { name: 'Thread panels' })
    const rows = [...group.querySelectorAll('button')]
    expect(rows.map(row => row.textContent)).toEqual(['Changes', "CostThis thread's route and cost per turn."])
    expect(rows.every(row => row.disabled)).toBe(true)
    expect(screen.getByText('Open a thread to show its panels here.')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Backlog' })).toBeDefined()

    onScreen.set('thread-a')
    view.rerender(<NewViewChooser definitions={registry.list()} onSelect={select} />)
    fireEvent.click(screen.getByRole('button', { name: /^Cost/u }))
    expect(select).toHaveBeenCalledWith(registry.get(ThreadFacets.sourceId('cost')))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search views' }), { target: { value: 'route' } })
    expect([...screen.getByRole('group', { name: 'Thread panels' }).querySelectorAll('button')].map(row => row.textContent)).toEqual([
      "CostThis thread's route and cost per turn.",
    ])
  })
})
