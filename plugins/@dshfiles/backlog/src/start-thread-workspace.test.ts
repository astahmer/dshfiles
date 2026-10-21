import { describe, expect, it } from 'vitest'

import { isolateStartThread, type ProvisionedThreadWorkspace } from './start-thread-workspace.js'

const recording = (answer: ProvisionedThreadWorkspace) => {
  const asked: string[] = []
  return {
    asked,
    provision: async (workspaceId: string): Promise<ProvisionedThreadWorkspace> => {
      asked.push(workspaceId)
      return answer
    },
  }
}

describe('isolateStartThread', () => {
  it('gives a thread started in a project its own jj workspace', async () => {
    const provisioner = recording({ workspaceId: 'ws-thread-abc123' })
    const placement = await isolateStartThread({
      target: { kind: 'project', projectId: 'ws-dshfiles' as never },
      defaultWorkspaceId: 'ws-other' as never,
      provision: provisioner.provision,
    })
    expect(provisioner.asked).toEqual(['ws-dshfiles'])
    expect(placement.workspaceId).toBe('ws-thread-abc123')
    expect(placement.cwd).toBeUndefined()
  })

  it('isolates a thread that has no project from the workspace the composer would use', async () => {
    const provisioner = recording({ workspaceId: 'ws-thread-def456' })
    const placement = await isolateStartThread({ target: { kind: 'default' }, defaultWorkspaceId: 'ws-first', provision: provisioner.provision })
    expect(provisioner.asked).toEqual(['ws-first'])
    expect(placement.workspaceId).toBe('ws-thread-def456')
  })

  it('keeps the folder an item names instead of provisioning a workspace for it', async () => {
    const provisioner = recording({ workspaceId: 'ws-thread-unused' })
    const placement = await isolateStartThread({
      target: { kind: 'cwd', path: '/Users/astahmer/dev/unregistered' },
      defaultWorkspaceId: 'ws-first',
      provision: provisioner.provision,
    })
    expect(provisioner.asked).toEqual([])
    expect(placement).toEqual({ workspaceId: undefined, cwd: '/Users/astahmer/dev/unregistered' })
  })

  it('leaves the choice to the Host when no workspace exists at all', async () => {
    const provisioner = recording({ workspaceId: 'ws-thread-unused' })
    const placement = await isolateStartThread({ target: { kind: 'default' }, defaultWorkspaceId: undefined, provision: provisioner.provision })
    expect(provisioner.asked).toEqual([])
    expect(placement).toEqual({ workspaceId: undefined, cwd: undefined })
  })

  it('starts nothing in the shared checkout when the thread workspace cannot be created', async () => {
    const placement = isolateStartThread({
      target: { kind: 'project', projectId: 'ws-dshfiles' as never },
      defaultWorkspaceId: undefined,
      provision: async () => {
        throw new Error('jj workspace add failed')
      },
    })
    await expect(placement).rejects.toThrow('jj workspace add failed')
  })
})
