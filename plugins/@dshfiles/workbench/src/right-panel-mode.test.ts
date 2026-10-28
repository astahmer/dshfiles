import { describe, expect, it, vi } from 'vitest'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'
import { createDockPaneActions, migrateDockVisibility } from './right-panel-mode.js'

const fixture = () => {
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
  const visibility = createStoredValue({ key: 'visibility', schema: z.boolean().nullable(), fallback: null, storage })
  return { visibility, actions: createDockPaneActions(visibility), storage }
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
    expect(createStoredValue({ key: 'visibility', schema: z.boolean().nullable(), fallback: null, storage }).get()).toBe(false)
  })

  it('migrates legacy native to a closed tabbed pane, not an alternate native renderer', () => {
    const { visibility, actions } = fixture()
    migrateDockVisibility('native', visibility)
    expect(visibility.get()).toBe(false)
    actions.open()
    expect(actions.isOpen()).toBe(true)
  })
})
