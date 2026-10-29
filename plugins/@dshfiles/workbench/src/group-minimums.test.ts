import { createDockview } from 'dockview-react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GroupMinimums } from './group-minimums.js'

const disposers: Array<() => void> = []
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
})
afterEach(() => {
  for (const dispose of disposers.splice(0).reverse()) dispose()
  vi.unstubAllGlobals()
})

const surface = () => {
  const element = document.createElement('div')
  document.body.append(element)
  const api = createDockview(element, {
    defaultRenderer: 'always',
    createComponent: () => ({ element: document.createElement('div'), init: () => undefined }),
  })
  api.layout(1000, 600)
  disposers.push(() => {
    api.dispose()
    element.remove()
  })
  return api
}

describe('GroupMinimums', () => {
  it('lowers the floor of groups that existed before, are added later, or come back from a saved layout', () => {
    const api = surface()
    api.addPanel({ id: 'before', component: 'body' })
    const retained = GroupMinimums.retain(api)
    disposers.push(retained.dispose)
    api.addPanel({ id: 'below', component: 'body', position: { referencePanel: 'before', direction: 'below' } })

    expect(api.groups.map(group => [group.minimumHeight, group.minimumWidth])).toEqual([
      [GroupMinimums.size, GroupMinimums.size],
      [GroupMinimums.size, GroupMinimums.size],
    ])

    const saved = api.toJSON()
    api.clear()
    api.fromJSON(saved)

    expect(api.groups).toHaveLength(2)
    expect(api.groups.every(group => group.minimumHeight === GroupMinimums.size)).toBe(true)
  })

  it('leaves Dockview defaults alone once released', () => {
    const api = surface()
    GroupMinimums.retain(api).dispose()
    api.addPanel({ id: 'after-release', component: 'body' })

    expect(api.groups[0]?.minimumHeight).toBe(100)
  })
})
