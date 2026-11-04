import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { VcsProviders } from '@dshfiles/vcs-provider-port'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { JjIntegrationTestHost, type JjIntegrationTestHarness } from './host-test-harness.js'

const gitAvailable = spawnSync('git', ['--version']).status === 0
const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' }
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv }).trim()

/** The real jj-integration Host half over a git-only repository: the jj tools work there through the git backend. */
describe.skipIf(!gitAvailable)('jj-integration in a git-only repository', () => {
  let root: string
  let repo: string
  let harness: JjIntegrationTestHarness

  beforeAll(async () => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'jj-integration-git-')))
    repo = join(root, 'repo')
    execFileSync('git', ['init', '-q', '-b', 'main', repo], { env: gitEnv })
    // Repository config reaches every worktree, so the Host's own git commits (rebase) have an identity.
    git(repo, 'config', 'user.name', 'Test')
    git(repo, 'config', 'user.email', 'test@example.com')
    git(repo, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(repo, 'shared.txt'), 'one\n')
    git(repo, 'add', '--all')
    git(repo, 'commit', '-q', '-m', 'base')
    harness = await JjIntegrationTestHost.start()
  })

  afterAll(async () => {
    await harness?.dispose()
    rmSync(`${repo}-threads`, { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  })

  it('isolates, reports, lands and discards a thread through the same API a jj repository uses', async () => {
    const projectId = await harness.register(repo)
    const provisioned = await harness.api.provision({ workspaceId: projectId, isolate: true })
    expect(provisioned.isolated).toBe(true)
    expect(provisioned.destination).toMatchObject({ vcs: 'git', isolated: true, bookmark: 'main', bookmarks: ['main'] })
    const thread = harness.workspacePath(provisioned.workspaceId)
    expect(existsSync(join(thread, '.git'))).toBe(true)

    const provider = await createHostApiClient(harness.host.ctx, VcsProviders.contract('@dshfiles/jj-integration'), '@dshfiles/backlog').detect({
      path: thread,
    })
    expect(provider.match).toMatchObject({ vcs: 'git', priority: 50, repoRoot: repo, workspaceRoot: thread, isolated: true })

    writeFileSync(join(thread, 'feature.txt'), 'feature\n')
    git(thread, 'add', '--all')
    git(thread, 'commit', '-q', '-m', 'feat: git thread')
    const status = await harness.runTool('jj_thread_status', { path: thread }, { sessionId: 'session-git', cwd: thread })
    expect(status).toContain('feat: git thread')

    const landed = await harness.wire('land', { path: thread })
    expect(landed).toBe('ok')
    expect(git(repo, 'rev-parse', 'main')).toBe(git(thread, 'rev-parse', 'HEAD'))
    expect(readFileSync(join(repo, 'feature.txt'), 'utf8')).toBe('feature\n')

    expect(await harness.api.discard({ path: thread, force: false })).toEqual({ status: 'discarded', revisions: [] })
    expect(existsSync(thread)).toBe(false)
  })
})
