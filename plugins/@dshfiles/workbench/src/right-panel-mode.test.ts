import * as Schema from 'effect/Schema'
import { describe, expect, it, vi } from 'vitest'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { createDockPaneActions, migrateDockVisibility, type RightPaneContents } from './right-panel-mode.js'
import type { WorkbenchPanelIdentity } from './panel-close.js'

const fixture = (contents: RightPaneContents = { panels: () => [], close: () => {} }) => {
  const values = new Map<string, string>()
  const storage = () => ({
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
  })
  const visibility = createStoredValue({ key: 'visibility', schema: Schema.NullOr(Schema.Boolean), fallback: null, storage })
  return { visibility, actions: createDockPaneActions(visibility, contents), storage }
}

describe('one tabbed right pane', () => {
  it('opens, closes and toggles synchronously without a Session or native tab state', () => {
    const { actions } = fixture()
    const changed = vi.fn()
    const off = actions.subscribe(changed)
    expect(actions.isOpen()).toBe(false)
    actions.toggle()
    expect(actions.isOpen()).toBe(true)
    actions.toggle()
    expect(actions.isOpen()).toBe(false)
    actions.open()
    expect(actions.isOpen()).toBe(true)
    actions.close()
    expect(actions.isOpen()).toBe(false)
    expect(changed).toHaveBeenCalledTimes(4)
    off()
  })

  it('migrates a legacy dock once and preserves explicit closes across reload', () => {
    const { visibility, actions, storage } = fixture()
    migrateDockVisibility('dock', visibility)
    expect(actions.isOpen()).toBe(true)
    actions.close()
    migrateDockVisibility('dock', visibility)
    expect(actions.isOpen()).toBe(false)
    expect(createStoredValue({ key: 'visibility', schema: Schema.NullOr(Schema.Boolean), fallback: null, storage }).get()).toBe(false)
  })

  it('migrates legacy native to a closed tabbed pane, not an alternate native renderer', () => {
    const { visibility, actions } = fixture()
    migrateDockVisibility('native', visibility)
    expect(visibility.get()).toBe(false)
    actions.open()
    expect(actions.isOpen()).toBe(true)
  })

  it('closes the only open panel instead of only hiding the pane', () => {
    const panel = { id: 'only', params: { sourceId: 'only' } }
    const panels: WorkbenchPanelIdentity[] = [panel]
    const close = vi.fn((closed: WorkbenchPanelIdentity) => {
      const index = panels.findIndex(candidate => candidate.id === closed.id)
      if (index !== -1) panels.splice(index, 1)
    })
    const { actions } = fixture({ panels: () => panels, close })
    actions.open()

    actions.toggle()

    expect(close).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledWith(panel)
    expect(panels).toHaveLength(0)
    expect(actions.isOpen()).toBe(false)
    actions.toggle()
    expect(actions.isOpen()).toBe(true)
    expect(panels).toHaveLength(0)
    expect(close).toHaveBeenCalledOnce()
  })

  it('hides a pane holding several panels without closing any of them', () => {
    const panels = [
      { id: 'a', params: { sourceId: 'a' } },
      { id: 'b', params: { sourceId: 'b' } },
    ]
    const close = vi.fn()
    const { actions } = fixture({ panels: () => panels, close })
    actions.open()

    actions.toggle()

    expect(actions.isOpen()).toBe(false)
    expect(close).not.toHaveBeenCalled()
    expect(panels).toHaveLength(2)
  })

  it('opens a closed pane holding one panel without closing it', () => {
    const panel = { id: 'only', params: { sourceId: 'only' } }
    const close = vi.fn()
    const { actions } = fixture({ panels: () => [panel], close })

    actions.toggle()

    expect(actions.isOpen()).toBe(true)
    expect(close).not.toHaveBeenCalled()
  })
})
