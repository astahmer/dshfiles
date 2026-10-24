import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceSessionPath } from './workspace-session-path.js'

let root: string | undefined

afterEach(() => {
  if (root === undefined) return
  rmSync(root, { recursive: true, force: true })
  root = undefined
})

describe('WorkspaceSessionPath.includes', () => {
  it('matches only absolute cwd paths at or below the workspace root', () => {
    expect(WorkspaceSessionPath.includes({ workspacePath: '/work/checkout', sessionCwd: '/work/checkout' })).toBe(true)
    expect(WorkspaceSessionPath.includes({ workspacePath: '/work/checkout', sessionCwd: '/work/checkout/src' })).toBe(true)
    expect(WorkspaceSessionPath.includes({ workspacePath: '/work/checkout', sessionCwd: '/work/checkout-copy' })).toBe(false)
    expect(WorkspaceSessionPath.includes({ workspacePath: '/work/checkout', sessionCwd: 'src' })).toBe(false)
    expect(WorkspaceSessionPath.includes({ workspacePath: '/work/checkout', sessionCwd: undefined })).toBe(false)
  })

  it('resolves symlinked session cwd paths into the actual workspace', () => {
    root = mkdtempSync(join(tmpdir(), 'jj-workspace-session-path-'))
    const workspacePath = join(root, 'workspace')
    const aliasPath = join(root, 'alias')
    mkdirSync(workspacePath)
    symlinkSync(workspacePath, aliasPath, 'dir')

    expect(WorkspaceSessionPath.includes({ workspacePath, sessionCwd: aliasPath })).toBe(true)
  })
})
