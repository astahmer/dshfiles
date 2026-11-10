import { Effect, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import { ProjectBookmarkModel } from './project-bookmarks.js'
import { defaultJjIntegrationSettings } from './settings.js'

describe('detected default branch', () => {
  it("reads git's origin/HEAD", () => {
    expect(ProjectBookmarkModel.parseDetectedName('ref: refs/remotes/origin/master\n', 'git-origin-head')).toBe('master')
    expect(ProjectBookmarkModel.parseDetectedName('ref: refs/remotes/origin/release/2.x', 'git-origin-head')).toBe('release/2.x')
  })

  it('ignores another remote, a detached origin/HEAD and empty output', () => {
    expect(ProjectBookmarkModel.parseDetectedName('ref: refs/remotes/upstream/main', 'git-origin-head')).toBeNull()
    expect(ProjectBookmarkModel.parseDetectedName('ref: refs/remotes/origin/HEAD', 'git-origin-head')).toBeNull()
    expect(ProjectBookmarkModel.parseDetectedName('ref: refs/remotes/origin/../../config', 'git-origin-head')).toBeNull()
    expect(ProjectBookmarkModel.parseDetectedName('', 'git-origin-head')).toBeNull()
  })

  it('reads the trunk() alias jj git clone records', () => {
    expect(ProjectBookmarkModel.parseDetectedName('develop@origin\n', 'jj-trunk-alias')).toBe('develop')
    expect(ProjectBookmarkModel.parseDetectedName('"release/2.x@origin"', 'jj-trunk-alias')).toBe('release/2.x')
  })

  it('ignores a trunk() alias on another remote or written as a revset', () => {
    expect(ProjectBookmarkModel.parseDetectedName('main@upstream', 'jj-trunk-alias')).toBeNull()
    expect(ProjectBookmarkModel.parseDetectedName('latest(main@origin | master@origin)', 'jj-trunk-alias')).toBeNull()
  })

  it('finds a branch git packed', () => {
    const packed = '# pack-refs with: peeled fully-peeled sorted\n1cf17fae refs/heads/develop\n2ab0 refs/remotes/origin/main\n'
    expect(ProjectBookmarkModel.packedRefsList(packed, 'refs/heads/develop')).toBe(true)
    expect(ProjectBookmarkModel.packedRefsList(packed, 'refs/heads/main')).toBe(false)
  })

  it('ticks once per change to the fallback or a per-project choice, never for the current value or other settings', async () => {
    const develop = { ...defaultJjIntegrationSettings, repositoryBookmarks: [{ repository: '/repo', bookmark: 'develop' }] }
    const ticks = await Effect.runPromise(
      Stream.runCount(
        ProjectBookmarkModel.mainBranchChanges(
          Stream.make(
            defaultJjIntegrationSettings,
            { ...defaultJjIntegrationSettings, isolateByDefault: !defaultJjIntegrationSettings.isolateByDefault },
            develop,
            develop,
            { ...develop, bookmark: 'trunk' },
          ),
        ),
      ),
    )
    expect(ticks).toBe(2)
  })
})
