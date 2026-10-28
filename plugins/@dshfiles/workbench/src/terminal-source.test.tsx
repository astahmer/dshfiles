import { cleanup, render } from '@testing-library/react'
import { createDockview, type DockviewApi } from 'dockview-react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import type { SidebarResourcePanels } from '@dshfiles/sidebar-right/resource-panels'
import { WORKBENCH_COMPONENT } from './layout-store.js'
import { NewViewTabs } from './new-view.js'
import { createWorkbenchPanelRegistry } from './registry.js'
import { createWorkbenchTerminalSource } from './terminal-source.js'

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

it('keeps registration, passive fallback mount and layout restore free of terminal allocation', () => {
  const openPage = vi.fn(() => false)
  const registry = createWorkbenchPanelRegistry()
  const source = createWorkbenchTerminalSource({ openPage, close: vi.fn() }, registry)
  registry.register(source.definition)
  const Panel = source.definition.component
  const mounted = render(<Panel panelId={source.definition.id} />)
  mounted.unmount()
  render(<Panel panelId={source.definition.id} visible={false} />)
  const api = surface()
  api.addPanel({ id: source.definition.id, component: WORKBENCH_COMPONENT })
  const saved = api.toJSON()
  api.fromJSON(saved)
  expect(openPage).not.toHaveBeenCalled()
  expect(source.definition.title).toBe('Terminal: Terminal')
  expect(source.definition.allowMultiple).toBeUndefined()
})

it('admits two exact native identities synchronously into the requested groups and closes only their chooser', () => {
  // The native controller's actual record/PTY contract is covered in sidebar-right;
  // this injected seam exercises synchronous publication into the real Dockview.
  const openPage = vi.fn<NonNullable<SidebarResourcePanels['openPage']>>()
  const closePending = vi.fn()
  const registry = createWorkbenchPanelRegistry()
  const source = createWorkbenchTerminalSource({ openPage, close: closePending }, registry)
  const api = surface()
  const firstChooser = NewViewTabs.open(api)
  const secondChooser = NewViewTabs.open(api, firstChooser.group, 'right')
  const created: string[] = []
  const closeNative = vi.fn()
  const registerProjection = (id: string): void => {
    registry.register({ id, title: 'Native Terminal', component: () => null, beforeClose: () => closeNative(id) })
    expect(source.admit('unrelated-native-resource')).toBe(false)
    expect(source.admit(id)).toBe(true)
  }
  openPage.mockImplementation((kind, beforePublish) => {
    expect(kind).toBe('terminal')
    const id = `native-terminal-${created.length}`
    beforePublish(id)
    created.push(id)
    registerProjection(id)
    return true
  })
  const firstGroup = firstChooser.group
  const secondGroup = secondChooser.group
  expect(source.open(source.definition, api, { group: firstGroup, replacePanelId: firstChooser.id })).toBe(true)
  expect(source.open(source.definition, api, { group: secondGroup, replacePanelId: secondChooser.id })).toBe(true)
  expect(new Set(created).size).toBe(2)
  expect(api.getPanel(created[0] ?? '')?.group).toBe(firstGroup)
  expect(api.getPanel(created[1] ?? '')?.group).toBe(secondGroup)
  expect(api.getPanel(firstChooser.id)).toBeUndefined()
  expect(api.getPanel(secondChooser.id)).toBeUndefined()
  expect(closeNative).not.toHaveBeenCalled()
  source.clear()
  expect(closePending).not.toHaveBeenCalled()
  registry.get(created[0] ?? '')?.beforeClose?.()
  expect(closeNative).toHaveBeenCalledWith(created[0])
})

it('admits the semantic Start chooser close through its owner exactly once', () => {
  const registry = createWorkbenchPanelRegistry()
  const api = surface()
  const chooserId = 'tab/start-terminal-chooser'
  const chooser = api.addPanel({ id: chooserId, title: 'New tab', component: WORKBENCH_COMPONENT })
  const group = chooser.group
  const closeStart = vi.fn(() => {
    expect(api.getPanel('native-semantic-terminal')).toBeDefined()
    chooser.api.close()
  })
  registry.register({ id: chooserId, title: 'New tab', component: () => null, newView: true, beforeClose: closeStart })
  const closeTerminal = vi.fn()
  const source = createWorkbenchTerminalSource(
    {
      close: closeTerminal,
      openPage: (_kind, beforePublish) => {
        beforePublish('native-semantic-terminal')
        registry.register({ id: 'native-semantic-terminal', title: 'Terminal', component: () => null, beforeClose: closeTerminal })
        expect(source.admit('native-semantic-terminal')).toBe(true)
        return true
      },
    },
    registry,
  )
  expect(source.open(source.definition, api, { group, replacePanelId: chooserId })).toBe(true)
  expect(closeStart).toHaveBeenCalledTimes(1)
  expect(closeTerminal).not.toHaveBeenCalled()
  expect(api.getPanel(chooserId)).toBeUndefined()
  expect(api.getPanel('native-semantic-terminal')?.group).toBe(group)
  expect(source.admit('native-semantic-terminal')).toBe(false)
  expect(closeStart).toHaveBeenCalledTimes(1)
})

it('tolerates an older bridge and absent adopted Session without creating a replacement owner', () => {
  const registry = createWorkbenchPanelRegistry()
  const oldSource = createWorkbenchTerminalSource({ close: vi.fn() }, registry)
  expect(oldSource.open(oldSource.definition, surface())).toBe(false)
  const source = createWorkbenchTerminalSource({ openPage: () => false, close: vi.fn() }, registry)
  expect(source.open(source.definition, surface())).toBe(false)
  expect(source.admit('invented')).toBe(false)
})

it('cleans failed native admission and ignores unrelated picker definitions', () => {
  const registry = createWorkbenchPanelRegistry()
  const openPage = vi.fn<NonNullable<SidebarResourcePanels['openPage']>>((_kind, beforePublish) => {
    beforePublish('failed-native-id')
    throw new Error('native commit refused')
  })
  const source = createWorkbenchTerminalSource({ openPage, close: vi.fn() }, registry)
  const api = surface()
  expect(source.open({ id: 'other-source', title: 'Other', component: () => null }, api)).toBe(false)
  expect(openPage).not.toHaveBeenCalled()
  expect(() => source.open(source.definition, api)).toThrow('native commit refused')
  registry.register({ id: 'failed-native-id', title: 'Native', component: () => null })
  expect(source.admit('failed-native-id')).toBe(false)
  expect(api.panels).toHaveLength(0)
})

it('drops cancelled chooser placements without stealing another pane', () => {
  let publish: ((id: string) => void) | undefined
  const closeNative = vi.fn()
  const resources: Pick<SidebarResourcePanels, 'openPage' | 'close'> = {
    close: closeNative,
    openPage: (_kind, beforePublish) => {
      publish = beforePublish
      return true
    },
  }
  const registry = createWorkbenchPanelRegistry()
  const source = createWorkbenchTerminalSource(resources, registry)
  const api = surface()
  const chooser = NewViewTabs.open(api)
  source.open(source.definition, api, { group: chooser.group, replacePanelId: chooser.id })
  publish?.('native-exact')
  registry.register({ id: 'native-exact', title: 'Native', component: () => null })
  chooser.api.close()
  expect(source.admit('native-exact')).toBe(true)
  expect(closeNative).toHaveBeenCalledWith('native-exact')
  expect(api.getPanel('native-exact')).toBeUndefined()
  source.open(source.definition, api)
  publish?.('after-reset')
  registry.register({ id: 'after-reset', title: 'Native', component: () => null })
  source.clear()
  expect(source.admit('after-reset')).toBe(true)
  expect(closeNative).toHaveBeenCalledWith('after-reset')
  expect(api.getPanel('after-reset')).toBeUndefined()
  expect(source.admit('after-reset')).toBe(false)
  expect(closeNative).toHaveBeenCalledTimes(2)
})
