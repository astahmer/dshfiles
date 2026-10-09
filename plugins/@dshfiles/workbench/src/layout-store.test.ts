import { Orientation, type SerializedDockview } from 'dockview-react'
import { describe, expect, it } from 'vitest'
import { createLayoutStore, WORKBENCH_COMPONENT } from './layout-store.js'

const memoryStorage = () => {
  const values = new Map<string, string>()
  return {
    values,
    storage: () => ({
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
    }),
  }
}

const layout: SerializedDockview = {
  grid: { root: { type: 'branch', data: [] }, width: 800, height: 600, orientation: Orientation.HORIZONTAL },
  panels: { a: { id: 'a', contentComponent: WORKBENCH_COMPONENT, title: 'A' } },
  activeGroup: '1',
}

describe('layout store', () => {
  it('round-trips a Dockview layout through storage, keeping fields it does not model', () => {
    const memory = memoryStorage()
    expect(createLayoutStore({ storage: memory.storage }).set(layout)).toBe(true)
    expect(createLayoutStore({ storage: memory.storage }).get()).toEqual(layout)
  })

  it('reads a layout from another component, malformed JSON or a missing grid as no layout', () => {
    const memory = memoryStorage()
    const store = createLayoutStore({ storage: memory.storage })
    const key = 'dshfiles.workbench.layout.v1'
    for (const raw of [JSON.stringify({ ...layout, panels: { a: { id: 'a', contentComponent: 'other' } } }), '{not json', JSON.stringify({ panels: {} })]) {
      memory.values.set(key, raw)
      store.reload()
      expect(store.get()).toBeNull()
    }
  })
})
