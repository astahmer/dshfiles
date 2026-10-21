import { describe, expect, it } from 'vitest'

import { BacklogProjectTarget } from './project-target.js'

const targets = (input: {
  readonly workspaces?: readonly { readonly id: string; readonly path: string }[]
  readonly projects?: Readonly<Record<string, string | null>>
}): {
  readonly workspaceAt: (path: string) => Promise<{ readonly id: string; readonly path: string } | undefined>
  readonly projectOf: (workspaceId: string) => Promise<{ readonly path: string } | null>
} => ({
  workspaceAt: async path => input.workspaces?.find(workspace => workspace.path === path),
  projectOf: async workspaceId => {
    const path = input.projects?.[workspaceId]
    return path === undefined || path === null ? null : { path }
  },
})

describe('capture project target', () => {
  it('files a workspace cut from a project under the project, whatever the folder is called', async () => {
    const ports = targets({
      workspaces: [
        { id: 'w-thread', path: '/custom/threads/dshfiles/thread-1b7a8c' },
        { id: 'w-project', path: '/work/dshfiles' },
      ],
      projects: { 'w-thread': '/work/dshfiles' },
    })
    expect(await BacklogProjectTarget.of('/custom/threads/dshfiles/thread-1b7a8c', ports)).toBe('/work/dshfiles')
  })

  it('keeps a registered project and a folder no workspace claims as they are', async () => {
    const ports = targets({ workspaces: [{ id: 'w-project', path: '/work/dshfiles' }], projects: { 'w-project': null } })
    expect(await BacklogProjectTarget.of('/work/dshfiles', ports)).toBe('/work/dshfiles')
    expect(await BacklogProjectTarget.of('/work/unregistered', ports)).toBe('/work/unregistered')
  })

  it('keeps the workspace when jj cannot say which project it came from', async () => {
    const ports = targets({ workspaces: [{ id: 'w-thread', path: '/work/dshfiles-threads/thread-1b7a8c' }] })
    expect(await BacklogProjectTarget.of('/work/dshfiles-threads/thread-1b7a8c', ports)).toBe('/work/dshfiles-threads/thread-1b7a8c')
  })
})
