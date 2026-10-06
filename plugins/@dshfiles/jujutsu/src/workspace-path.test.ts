import assert from 'node:assert/strict'
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished, test } from 'vitest'
import { resolveWorkspaceDestination } from './workspace-path.ts'

test('workspace destination must be a new sibling outside the registered repository tree', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dshfiles-jj-workspace-path-'))
  const repository = join(root, 'repository')
  const parent = join(root, 'workspaces')
  await mkdir(repository)
  await mkdir(parent)
  onTestFinished(() => rm(root, { recursive: true, force: true }))

  const destination = await resolveWorkspaceDestination(repository, parent, 'review-branch')
  const canonicalParent = await realpath(parent)
  assert.equal(destination.parentPath, canonicalParent)
  assert.equal(destination.path, join(canonicalParent, 'review-branch'))
  await assert.rejects(resolveWorkspaceDestination(repository, repository, 'nested-workspace'), /outside the registered repository tree/)
  await assert.rejects(resolveWorkspaceDestination(repository, root, 'repository'), /outside the registered repository tree/)
})

test('workspace destination rejects unsafe names, filesystem roots, and existing targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dshfiles-jj-workspace-path-'))
  const repository = join(root, 'repository')
  const parent = join(root, 'workspaces')
  await mkdir(repository)
  await mkdir(parent)
  await mkdir(join(parent, 'already-there'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))

  await assert.rejects(resolveWorkspaceDestination(repository, parent, '../escape'), /valid Jujutsu workspace name/)
  await assert.rejects(resolveWorkspaceDestination(repository, '/', 'workspace'), /filesystem root/)
  await assert.rejects(resolveWorkspaceDestination(repository, parent, 'already-there'), /already exists/)
})
