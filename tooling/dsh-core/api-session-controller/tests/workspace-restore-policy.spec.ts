import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertNoOverlappingWorkspaceRoots,
  assertNoSymlinkWorkspacePath,
  assertWorkspaceRestoreOwner,
  type WorkspaceRestoreOwner,
} from '../src/workspace-restore-policy.ts'

const temporaryRoots: string[] = []

const createRoot = async (): Promise<string> => {
  const parent = await realpath(tmpdir())
  const root = await mkdtemp(join(parent, 'dsh-workspace-restore-'))
  temporaryRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Host workspace restore policy', () => {
  it('allows only one idle, non-archived Session owner', () => {
    const owners: WorkspaceRestoreOwner[] = [
      { sessionId: 'selected', archived: false, running: false },
      { sessionId: 'archived-idle', archived: true, running: false },
    ]

    expect(() => assertWorkspaceRestoreOwner('selected', owners)).not.toThrow()
    expect(() => assertWorkspaceRestoreOwner('archived-idle', owners)).toThrow(/non-archived/)
    expect(() => assertWorkspaceRestoreOwner('selected', [
      ...owners,
      { sessionId: 'other', archived: false, running: false },
    ])).toThrow(/another Session owns/)
    expect(() => assertWorkspaceRestoreOwner('selected', [
      owners[0],
      { sessionId: 'archived-running', archived: true, running: true },
    ])).toThrow(/another Session owns/)
    expect(() => assertWorkspaceRestoreOwner('selected', [
      { sessionId: 'selected', archived: false, running: true },
    ])).toThrow(/Agent is running/)
  })

  it('rejects equal, nested, and containing workspaces while allowing siblings', async () => {
    const root = await createRoot()
    const nested = join(root, 'nested')
    await mkdir(nested)
    const sibling = join(await realpath(tmpdir()), 'other-workspace')

    expect(() => assertNoOverlappingWorkspaceRoots(root, [sibling])).not.toThrow()
    expect(() => assertNoOverlappingWorkspaceRoots(root, [root])).toThrow(/overlaps/)
    expect(() => assertNoOverlappingWorkspaceRoots(root, [nested])).toThrow(/overlaps/)
    expect(() => assertNoOverlappingWorkspaceRoots(nested, [root])).toThrow(/overlaps/)
  })

  it('rejects traversal and symlink paths while allowing ordinary changed files', async () => {
    const root = await createRoot()
    const outside = await createRoot()
    await writeFile(join(root, 'safe.txt'), 'safe')
    await symlink(outside, join(root, 'linked'))

    await expect(assertNoSymlinkWorkspacePath(root, 'safe.txt')).resolves.toBeUndefined()
    await expect(assertNoSymlinkWorkspacePath(root, 'new/deep/file.txt')).resolves.toBeUndefined()
    await expect(assertNoSymlinkWorkspacePath(root, '../outside.txt')).rejects.toThrow(/traversal/)
    await expect(assertNoSymlinkWorkspacePath(root, 'nested\\..\\outside.txt')).rejects.toThrow(/non-empty/)
    await expect(assertNoSymlinkWorkspacePath(root, 'linked/secret.txt')).rejects.toThrow(/symbolic link/)
    await expect(assertNoSymlinkWorkspacePath(root, 'safe.txt\0other')).rejects.toThrow(/non-empty/)
  })

  it('rejects a workspace root reached through a symlink', async () => {
    const root = await createRoot()
    const alias = join(await realpath(tmpdir()), 'dsh-workspace-restore-alias-' + String(Date.now()))
    await symlink(root, alias)
    temporaryRoots.push(alias)

    await expect(assertNoSymlinkWorkspacePath(alias, 'file.txt')).rejects.toThrow(/workspace root cannot contain a symbolic link/)
  })
})
