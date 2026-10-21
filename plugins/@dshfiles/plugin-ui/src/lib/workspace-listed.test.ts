import { describe, expect, it } from 'vitest'
import { workspaceListed, type WorkspaceListStore } from './workspace-listed.js'

interface Row {
  readonly workspaceId: string
  readonly title: string
}

const store = (initial: readonly Row[]) => {
  let items = initial
  const listeners = new Set<() => void>()
  const workspaces: WorkspaceListStore<Row> = {
    list: {
      getSnapshot: () => ({ items }),
      subscribe: listener => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
  }
  return {
    workspaces,
    push: (row: Row): void => {
      items = [...items, row]
      for (const listener of listeners) listener()
    },
    listeners,
  }
}

describe('workspaceListed', () => {
  it('answers a workspace the list already carries without waiting for a push', async () => {
    const source = store([{ workspaceId: 'ws-project', title: 'dshfiles' }])
    await expect(workspaceListed({ workspaces: source.workspaces, workspaceId: 'ws-project' })).resolves.toEqual({
      workspaceId: 'ws-project',
      title: 'dshfiles',
    })
    expect(source.listeners.size).toBe(0)
  })

  it('answers the listed row once the Host push carrying it arrives', async () => {
    const source = store([])
    const pending = workspaceListed({ workspaces: source.workspaces, workspaceId: 'ws-thread' })
    expect(source.listeners.size).toBe(1)
    source.push({ workspaceId: 'ws-thread', title: 'dshfiles · thread-abc123' })
    await expect(pending).resolves.toEqual({ workspaceId: 'ws-thread', title: 'dshfiles · thread-abc123' })
    expect(source.listeners.size).toBe(0)
  })

  it('fails instead of opening a workspace the Host never listed', async () => {
    const source = store([])
    const pending = workspaceListed({ workspaces: source.workspaces, workspaceId: 'ws-missing', timeoutMs: 5 })
    source.push({ workspaceId: 'ws-other', title: 'other' })
    await expect(pending).rejects.toThrow('ws-missing never reached the workspace list')
    expect(source.listeners.size).toBe(0)
  })
})
