import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { DockviewApi } from 'dockview-react'
import * as Schema from 'effect/Schema'
import { useSyncExternalStore } from 'react'
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { createLayoutStore, WORKBENCH_COMPONENT } from './layout-store.js'
import { NewViewTabs } from './new-view.js'
import { phoneAwareDockActions, PhoneSheetState } from './phone-sheet.js'
import { createWorkbenchPanelRegistry, type WorkbenchPanelDefinition } from './registry.js'
import { createRightPaneContents } from './right-pane-contents.js'
import { createDockPaneActions } from './right-panel-mode.js'
import { memoryStorage, t } from './test-support.js'
import { connectWorkbenchTabs, type WorkbenchTabsSnapshot } from './tabs.js'
import { WorkbenchView } from './workbench-view.js'

afterEach(cleanup)

const Body = (): JSX.Element => <textarea aria-label="panel draft" defaultValue="Keep this draft" />

const setup = (definitions: readonly WorkbenchPanelDefinition[], phone = false) => {
  const registry = createWorkbenchPanelRegistry()
  for (const definition of definitions) registry.register(definition)
  const visibility = createStoredValue({ key: 'visibility', schema: Schema.NullOr(Schema.Boolean), fallback: null, storage: memoryStorage() })
  let api: DockviewApi | undefined
  const actions = phoneAwareDockActions(createDockPaneActions(visibility, createRightPaneContents(registry)), () => phone)
  const store = createLayoutStore({ surface: 'dock', storage: memoryStorage() })
  const Pane = (): JSX.Element => {
    const open = useSyncExternalStore(actions.subscribe, actions.isOpen, actions.isOpen)
    return (
      <WorkbenchView
        registry={registry}
        store={store}
        t={t}
        region="right"
        surface="dock"
        visible={open}
        onClose={actions.close}
        onApi={ready => {
          api = ready
          for (const definition of definitions) ready.addPanel({ id: definition.id, title: definition.title, component: WORKBENCH_COMPONENT })
          if (definitions.length === 0) NewViewTabs.open(ready)
        }}
      />
    )
  }
  PhoneSheetState.set(false)
  actions.open()
  render(<Pane />)
  if (api === undefined) throw new Error('Right Dockview did not become ready')
  return { actions, api }
}

describe('the right pane toggle', () => {
  it('retires a lone chooser and reopens with a fresh chooser', () => {
    const { actions, api } = setup([])
    const originalId = api.panels[0]?.id
    expect(api.panels).toHaveLength(1)
    expect(actions.isOpen()).toBe(true)

    act(() => actions.toggle())

    expect(api.panels).toHaveLength(0)
    expect(actions.isOpen()).toBe(false)

    act(() => actions.toggle())

    expect(actions.isOpen()).toBe(true)
    expect(api.panels).toHaveLength(1)
    expect(api.panels[0]?.id).not.toBe(originalId)
    expect(NewViewTabs.isChooser(api.panels[0]?.id ?? '')).toBe(true)
  })

  it.each(['terminal', 'preview', 'plugin-view'])('hides and restores a lone %s without closing its owner or draft', kind => {
    const close = vi.fn()
    const { actions, api } = setup([{ id: kind, title: kind, component: Body, beforeClose: close }])
    const original = api.getPanel(kind)
    const draft = screen.getByLabelText('panel draft')

    act(() => actions.toggle())

    expect(actions.isOpen()).toBe(false)
    expect(close).not.toHaveBeenCalled()
    expect(api.getPanel(kind)).toBe(original)

    act(() => actions.toggle())

    expect(actions.isOpen()).toBe(true)
    expect(api.getPanel(kind)).toBe(original)
    expect(screen.getByLabelText('panel draft')).toBe(draft)
    expect(draft).toHaveProperty('value', 'Keep this draft')
    expect(close).not.toHaveBeenCalled()
  })

  it('keeps a genuinely pinned semantic tab and its draft through toggling', () => {
    const close = vi.fn()
    const snapshot: WorkbenchTabsSnapshot = {
      enabled: true,
      scopeKey: 'global',
      activeTabId: 'pinned',
      tabs: [
        {
          id: 'pinned',
          title: 'Pinned',
          kind: 'panel',
          panelId: 'pinned-view',
          target: { kind: 'panel', panelId: 'pinned-view' },
          active: true,
          pinned: true,
          preview: false,
          available: true,
          status: null,
        },
      ],
    }
    onTestFinished(
      connectWorkbenchTabs({
        getSnapshot: () => snapshot,
        subscribe: () => () => {},
        renderStart: () => null,
        actions: {
          activate: () => {},
          close,
          keep: () => {},
          togglePin: () => {},
          move: () => {},
          closeOthers: () => {},
          closeToRight: () => {},
          moveAside: () => false,
          open: () => {},
          newTab: () => {},
          renameThread: async () => {},
        },
      }),
    )
    const { actions, api } = setup([{ id: 'pinned-view', title: 'Pinned', component: Body, tabId: 'pinned', beforeClose: () => close('pinned') }])
    const original = api.getPanel('pinned-view')
    const draft = screen.getByLabelText('panel draft')
    expect(screen.queryByRole('button', { name: 'Close Pinned' })).toBeNull()
    act(() => actions.toggle())
    expect(actions.isOpen()).toBe(false)
    act(() => actions.toggle())
    expect(actions.isOpen()).toBe(true)
    expect(api.getPanel('pinned-view')).toBe(original)
    expect(screen.getByLabelText('panel draft')).toBe(draft)
    expect(close).not.toHaveBeenCalled()
  })

  it('uses the same chooser-close rule from the pane icon', () => {
    const { actions, api } = setup([])
    fireEvent.click(screen.getByRole('button', { name: 'Close pane' }))
    expect(actions.isOpen()).toBe(false)
    expect(api.panels).toHaveLength(0)
  })

  it('hides the pane and keeps every panel when several are open', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { actions, api } = setup([
      { id: 'a', title: 'a', component: Body, beforeClose: first },
      { id: 'b', title: 'b', component: Body, beforeClose: second },
    ])
    expect(api.panels).toHaveLength(2)

    act(() => actions.toggle())

    expect(actions.isOpen()).toBe(false)
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    expect(api.panels).toHaveLength(2)

    act(() => actions.toggle())

    expect(actions.isOpen()).toBe(true)
    expect(api.panels).toHaveLength(2)
  })

  it('hides and restores the phone sheet without retiring its lone chooser', () => {
    const { actions, api } = setup([], true)
    const chooser = api.panels[0]
    act(() => actions.toggle())
    expect(actions.isOpen()).toBe(false)
    expect(api.panels[0]).toBe(chooser)
    act(() => actions.toggle())
    expect(actions.isOpen()).toBe(true)
    expect(api.panels[0]).toBe(chooser)
    act(() => actions.close())
  })
})
