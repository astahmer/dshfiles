import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JjIntegrationTestHost, type JjIntegrationTestHarness } from './host-test-harness.js'

const jjAvailable = spawnSync('jj', ['--version']).status === 0

/**
 * A secondary JJ workspace whose checkout folder is gone cannot be resolved through the DSH workspace registry, which
 * canonicalizes the path it is given. The cleanup preview must report that row instead of failing every other row.
 */
describe.skipIf(!jjAvailable)('cleanup preview beside a secondary workspace whose folder is gone', () => {
  let root: string
  let repo: string
  let goneWorkspaceId: string
  let harness: JjIntegrationTestHarness

  beforeAll(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'jj-cleanup-missing-')))
    repo = join(root, 'repo')
    JjIntegrationTestHost.initRepository(repo)
    harness = await JjIntegrationTestHost.start({ settings: { syncWorkspaceAfterLand: '' } })
    await harness.register(repo)
    const gone = join(root, 'gone-secondary')
    JjIntegrationTestHost.jj(repo, 'workspace', 'add', gone, '--name', 'gone-secondary')
    goneWorkspaceId = await harness.register(gone)
    rmSync(gone, { recursive: true, force: true })
  })

  afterAll(async () => {
    await harness?.dispose()
    rmSync(root, { recursive: true, force: true })
  })

  it('previews the other workspaces instead of failing on the missing folder', async () => {
    const preview = await harness.api.cleanupWorkspaces({
      path: repo,
      olderThanHours: 0,
      kinds: ['empty', 'integrated', 'untracked', 'secondary'],
      apply: false,
    })

    expect(preview.workspaces).toContainEqual(expect.objectContaining({ name: 'gone-secondary', kind: 'secondary', missing: true }))
  })

  it('removes the missing workspace and forgets its registry entry only when it is selected', async () => {
    const preview = await harness.api.cleanupWorkspaces({
      path: repo,
      olderThanHours: 0,
      kinds: ['secondary'],
      apply: false,
    })
    const row = preview.workspaces.find(workspace => workspace.name === 'gone-secondary')
    expect(row).toBeDefined()

    const applied = await harness.api.cleanupWorkspaces({
      path: repo,
      olderThanHours: 0,
      kinds: ['secondary'],
      targets: [{ repoRoot: repo, name: 'gone-secondary', kind: 'secondary' }],
      apply: true,
    })

    expect(applied.workspaces).toContainEqual(expect.objectContaining({ name: 'gone-secondary', outcome: 'removed' }))
    expect(() => harness.workspacePath(goneWorkspaceId)).toThrow()
    expect(existsSync(join(root, 'gone-secondary'))).toBe(false)
  })
})
