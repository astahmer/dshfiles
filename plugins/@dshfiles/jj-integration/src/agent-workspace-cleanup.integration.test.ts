import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Schema } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JjIntegrationTestHost, type JjIntegrationTestHarness } from './host-test-harness.js'

const jj = JjIntegrationTestHost.jj
const jjAvailable = spawnSync('jj', ['--version']).status === 0

const isolatedWorkspace = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ name: Schema.String, path: Schema.String })))

/**
 * A subagent that isolates its own workspace with `jj_thread_isolate` instead of a raw `jj workspace add` is covered by
 * the cleanup the Host already runs: its Session guards the workspace while it works, and once the work landed and the
 * Session is idle the same cleanup removes the folder (and its node_modules) without a human.
 */
describe.skipIf(!jjAvailable)('workspaces agents isolate for themselves', () => {
  let root: string
  let repo: string
  let harness: JjIntegrationTestHarness

  beforeAll(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'jj-agent-workspace-')))
    repo = join(root, 'repo')
    JjIntegrationTestHost.initRepository(repo)
    harness = await JjIntegrationTestHost.start({ settings: { syncWorkspaceAfterLand: '' } })
    await harness.register(repo)
  })

  afterAll(async () => {
    await harness?.dispose()
    rmSync(join(root, 'repo-threads'), { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  })

  const cleanup = (apply: boolean) => harness.api.cleanupWorkspaces({ path: repo, olderThanHours: 0, kinds: ['empty', 'integrated'], apply })

  it('keeps the workspace while its work is unlanded or its Session works, then removes it once it landed', async () => {
    const subagent = { sessionId: 'session-subagent', cwd: repo }
    harness.setSession(subagent.sessionId, { running: true, questions: 0 })
    const isolated = isolatedWorkspace(await harness.runTool('jj_thread_isolate', {}, subagent))
    writeFileSync(join(isolated.path, 'feature.txt'), 'feature\n')
    jj(isolated.path, 'describe', '-m', 'feat: add feature')

    const unlanded = await cleanup(true)
    expect(unlanded.workspaces).toStrictEqual([])
    expect(unlanded.skipped).toContainEqual(expect.objectContaining({ name: isolated.name, reason: 'has-work' }))

    harness.setSession(subagent.sessionId, { running: false, questions: 0 })
    expect(await harness.runTool('jj_thread_rebase', { path: isolated.path }, { sessionId: 'session-parent', cwd: repo })).toContain('landed')
    harness.setSession(subagent.sessionId, { running: true, questions: 0 })
    const busy = await cleanup(true)
    expect(busy.skipped).toContainEqual(expect.objectContaining({ name: isolated.name, reason: 'busy' }))
    expect(existsSync(isolated.path)).toBe(true)

    harness.setSession(subagent.sessionId, { running: false, questions: 0 })
    const removed = await cleanup(true)
    expect(removed.workspaces.map(workspace => ({ name: workspace.name, kind: workspace.kind, outcome: workspace.outcome }))).toStrictEqual([
      { name: isolated.name, kind: 'integrated', outcome: 'removed' },
    ])
    expect(existsSync(isolated.path)).toBe(false)
    expect(jj(repo, '--ignore-working-copy', 'workspace', 'list', '-T', 'name ++ "\\n"')).not.toContain(isolated.name)
  })

  const bookmarkCommit = (name: string): string =>
    jj(repo, '--ignore-working-copy', 'log', '--no-graph', '-r', `bookmarks(exact:${JSON.stringify(name)})`, '-T', 'commit_id ++ "\\n"').trim()

  const isolate = async (sessionId: string, file: string) => {
    harness.setSession(sessionId, { running: false, questions: 0 })
    const isolated = isolatedWorkspace(await harness.runTool('jj_thread_isolate', {}, { sessionId, cwd: repo }))
    writeFileSync(join(isolated.path, file), `${file}\n`)
    jj(isolated.path, 'describe', '-m', `feat: add ${file}`)
    return isolated
  }

  it('offers work already on another bookmark, naming it, and leaves that bookmark and its revisions alone', async () => {
    const isolated = await isolate('session-release', 'release.txt')
    jj(isolated.path, 'bookmark', 'create', 'release', '-r', '@')
    jj(isolated.path, 'new')
    const held = bookmarkCommit('release')

    harness.setSession('session-release', { running: true, questions: 0 })
    expect((await cleanup(false)).skipped).toContainEqual(expect.objectContaining({ name: isolated.name, reason: 'busy' }))
    harness.setSession('session-release', { running: false, questions: 0 })

    const preview = await cleanup(false)
    expect(preview.workspaces).toContainEqual(
      expect.objectContaining({ name: isolated.name, kind: 'integrated', integratedInto: ['release'], outcome: 'would-remove' }),
    )
    expect(existsSync(isolated.path)).toBe(true)

    const applied = await cleanup(true)
    expect(applied.workspaces).toContainEqual(expect.objectContaining({ name: isolated.name, integratedInto: ['release'], outcome: 'removed' }))
    expect(existsSync(isolated.path)).toBe(false)
    expect(bookmarkCommit('release')).toBe(held)
    expect(jj(repo, '--ignore-working-copy', 'file', 'list', '-r', 'bookmarks(exact:"release")')).toContain('release.txt')
  })

  it('keeps a workspace with one revision above the bookmark', async () => {
    const isolated = await isolate('session-above', 'above-base.txt')
    jj(isolated.path, 'bookmark', 'create', 'partly', '-r', '@')
    jj(isolated.path, 'new')
    writeFileSync(join(isolated.path, 'above.txt'), 'above\n')
    jj(isolated.path, 'describe', '-m', 'feat: add above')

    const applied = await cleanup(true)
    expect(applied.skipped).toContainEqual(expect.objectContaining({ name: isolated.name, reason: 'has-work' }))
    expect(existsSync(isolated.path)).toBe(true)
  })

  it('counts edits still on disk as work no bookmark holds', async () => {
    const isolated = await isolate('session-dirty', 'dirty-base.txt')
    jj(isolated.path, 'bookmark', 'create', 'dirty-base', '-r', '@')
    jj(isolated.path, 'new')
    writeFileSync(join(isolated.path, 'unsnapshotted.txt'), 'edit\n')

    const applied = await cleanup(true)
    expect(applied.workspaces.find(workspace => workspace.name === isolated.name)?.outcome).toBe('has-work')
    expect(existsSync(join(isolated.path, 'unsnapshotted.txt'))).toBe(true)
  })

  it('does not trust a conflicted bookmark, which could still lose the work', async () => {
    const isolated = await isolate('session-conflicted', 'conflicted.txt')
    jj(repo, '--ignore-working-copy', 'bookmark', 'create', 'contested', '-r', 'main')
    const before = jj(repo, '--ignore-working-copy', 'op', 'log', '--no-graph', '-n', '1', '-T', 'id').trim()
    jj(isolated.path, 'bookmark', 'set', 'contested', '-r', '@')
    jj(repo, '--ignore-working-copy', '--at-op', before, 'bookmark', 'delete', 'contested')
    jj(isolated.path, 'new')
    expect(jj(repo, '--ignore-working-copy', 'bookmark', 'list', 'contested')).toContain('contested (conflicted)')

    expect((await cleanup(false)).skipped).toContainEqual(expect.objectContaining({ name: isolated.name, reason: 'has-work' }))
  })
})
