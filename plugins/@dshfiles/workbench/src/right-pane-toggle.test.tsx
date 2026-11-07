import { act, cleanup, render } from '@testing-library/react'
import type { DockviewApi } from 'dockview-react'
import * as Schema from 'effect/Schema'
import { useSyncExternalStore } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { createLayoutStore, WORKBENCH_COMPONENT } from './layout-store.js'
import type { WorkbenchTranslate } from './locales.js'
import { closeWorkbenchPanel } from './panel-close.js'
import { createWorkbenchPanelRegistry, type WorkbenchPanelDefinition } from './registry.js'
import { createDockPaneActions } from './right-panel-mode.js'
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

const Body = (): JSX.Element => <div>panel body</div>

/** A real right pane whose open state and panels are the ones the toggle sees. */
const setup = (definitions: readonly WorkbenchPanelDefinition[]) => {
  const registry = createWorkbenchPanelRegistry()
  for (const definition of definitions) registry.register(definition)
  const visibility = createStoredValue({ key: 'visibility', schema: Schema.NullOr(Schema.Boolean), fallback: null, storage: memoryStorage() })
  let api: DockviewApi | undefined
  const actions = createDockPaneActions(visibility, {
    panels: () => api?.panels ?? [],
    close: panel => {
      if (api !== undefined) closeWorkbenchPanel({ api, registry, panel })
    },
  })
  const store = createLayoutStore({ surface: 'dock', storage: memoryStorage() })
  const ids = definitions.map(definition => definition.id)
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
          for (const id of ids) ready.addPanel({ id, title: id, component: WORKBENCH_COMPONENT })
        }}
      />
    )
  }
  actions.open()
  render(<Pane />)
  if (api === undefined) throw new Error('Right Dockview did not become ready')
  return { actions, api }
}

describe('the right pane toggle', () => {
  it('closes the only open panel through its owning close path', () => {
    const close = vi.fn()
    const { actions, api } = setup([{ id: 'only', title: 'only', component: Body, beforeClose: close }])
    expect(api.panels).toHaveLength(1)
    expect(actions.isOpen()).toBe(true)

    act(() => actions.toggle())

    expect(close).toHaveBeenCalledOnce()
    expect(api.panels).toHaveLength(0)
    expect(actions.isOpen()).toBe(false)
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
})
