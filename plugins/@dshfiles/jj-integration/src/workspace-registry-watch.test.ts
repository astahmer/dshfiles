import { describe, expect, it } from 'vitest'
import { watchWorkspaceRegistry } from './workspace-registry-watch.js'

const workspaceStore = (initial: readonly string[]) => {
  let items = initial.map(workspaceId => ({ workspaceId }))
  const listeners = new Set<() => void>()
  return {
    list: {
      getSnapshot: () => ({ items }),
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    publish: (ids: readonly string[]) => {
      items = ids.map(workspaceId => ({ workspaceId }))
      for (const listener of listeners) listener()
    },
  }
}

describe('watchWorkspaceRegistry', () => {
  it('reports a folder another plugin registered, and ignores pushes that keep the same Workspaces', () => {
    const workspaces = workspaceStore(['default'])
    let changes = 0
    const stop = watchWorkspaceRegistry({ workspaces, onChange: () => changes++ })

    workspaces.publish(['default'])
    expect(changes).toBe(0)

    workspaces.publish(['default', 'undo-project'])
    expect(changes).toBe(1)

    workspaces.publish(['undo-project', 'default'])
    expect(changes).toBe(1)

    workspaces.publish(['undo-project'])
    expect(changes).toBe(2)

    stop()
    workspaces.publish(['default'])
    expect(changes).toBe(2)
  })
})
