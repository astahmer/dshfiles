import { describe, expect, it } from 'vitest'
import { NoFolderWorkspace } from './no-folder.js'

const { isPath, isScratchWorkspace, reusablePath } = NoFolderWorkspace

describe('no-folder paths', () => {
  it('matches the shared root and a per-thread folder under it', () => {
    expect(isPath('/Users/astahmer/.dsh/no-folder')).toBe(true)
    expect(isPath('/Users/astahmer/.dsh/no-folder/2026-11-07-1a2b3c')).toBe(true)
    expect(isPath('/Users/astahmer/.dsh/no-folder/2026-11-07-1a2b3c/')).toBe(true)
  })

  it('reads a Windows path as the same layout', () => {
    expect(isPath('C:\\Users\\astahmer\\.dsh\\no-folder\\2026-11-07-1a2b3c')).toBe(true)
  })

  it('ignores other folders that merely share a name', () => {
    expect(isPath(undefined)).toBe(false)
    expect(isPath('')).toBe(false)
    expect(isPath('/Users/astahmer/dev/no-folder')).toBe(false)
    expect(isPath('/Users/astahmer/.dsh/no-folder-copy')).toBe(false)
    expect(isPath('/Users/astahmer/.dsh/scratch')).toBe(false)
  })
})

describe('scratch workspaces', () => {
  it('counts a scratch folder that still carries the scratch title', () => {
    expect(isScratchWorkspace({ path: '/Users/astahmer/.dsh/no-folder/2026-11-07-1a2b3c', title: NoFolderWorkspace.workspaceTitle })).toBe(true)
  })

  it('stops counting a scratch folder once it was turned into a project', () => {
    expect(isScratchWorkspace({ path: '/Users/astahmer/.dsh/no-folder/2026-11-07-1a2b3c', title: 'Fix the flaky test' })).toBe(false)
    expect(isScratchWorkspace({ path: '/Users/astahmer/dev/dshfiles', title: NoFolderWorkspace.workspaceTitle })).toBe(false)
  })
})

describe('scratch folder reuse', () => {
  const root = '/Users/astahmer/.dsh/no-folder'
  const folder = `${root}/2026-11-07-1a2b3c`

  it('takes over an empty scratch folder that is still on disk', () => {
    expect(reusablePath({ root, workspaces: [{ path: folder, sessionIds: [] }], presentPaths: new Set([folder]) })).toBe(folder)
  })

  it('never reuses the shared root or a folder a thread already uses', () => {
    expect(reusablePath({ root, workspaces: [{ path: root, sessionIds: [] }], presentPaths: new Set([root]) })).toBeUndefined()
    expect(reusablePath({ root, workspaces: [{ path: folder, sessionIds: ['session-a'] }], presentPaths: new Set([folder]) })).toBeUndefined()
  })

  it('ignores a scratch folder whose directory is gone and folders outside the no-folder root', () => {
    expect(reusablePath({ root, workspaces: [{ path: folder, sessionIds: [] }], presentPaths: new Set() })).toBeUndefined()
    expect(
      reusablePath({
        root,
        workspaces: [{ path: '/Users/astahmer/dev/dshfiles', sessionIds: [] }],
        presentPaths: new Set(['/Users/astahmer/dev/dshfiles']),
      }),
    ).toBeUndefined()
  })
})
