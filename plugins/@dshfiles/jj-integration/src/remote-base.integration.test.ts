import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThreadWorkspaceModel } from './thread-workspace-model.js'
import { ThreadWorkspacesTestSupport, type JjExecutor } from './thread-workspaces-test-support.js'

const jjAvailable = spawnSync('jj', ['--version']).status === 0
const gitAvailable = spawnSync('git', ['--version']).status === 0

const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
}
const jjEnv = { ...process.env, JJ_CONFIG: '' }

const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv }).trim()
const jj = (cwd: string, ...args: string[]): string =>
  execFileSync('jj', ['--color=never', '--no-pager', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: jjEnv }).trim()

const executor: JjExecutor = async ({ args, cwd }) => {
  const result = spawnSync('jj', ['--color=never', '--no-pager', ...args], { cwd, encoding: 'utf8', env: jjEnv })
  return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr }
}

/** Someone else pushes a commit to `main` on the bare origin; the repository under test has not fetched it. */
const pushFromElsewhere = (root: string, origin: string, message: string): void => {
  const other = join(root, `other-${String(Date.now())}`)
  git(root, 'clone', '-q', origin, other)
  git(other, 'config', 'user.name', 'Test')
  git(other, 'config', 'user.email', 'test@example.com')
  writeFileSync(join(other, `${message.replaceAll(' ', '-')}.txt`), `${message}\n`)
  git(other, 'add', '--all')
  git(other, 'commit', '-q', '-m', message)
  git(other, 'push', '-q', 'origin', 'HEAD:main')
}

describe.skipIf(!jjAvailable || !gitAvailable)('starting a jj thread workspace from a remote bookmark', () => {
  let root: string
  let origin: string
  let repo: string
  const threads = ThreadWorkspacesTestSupport.promiseThreads({ executor })

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'jj-remote-base-')))
    origin = join(root, 'origin.git')
    repo = join(root, 'repo')
    git(root, 'init', '-q', '--bare', '-b', 'main', origin)
    execFileSync('jj', ['git', 'init', repo], { stdio: 'ignore', env: jjEnv })
    jj(repo, 'config', 'set', '--repo', 'user.name', 'Test')
    jj(repo, 'config', 'set', '--repo', 'user.email', 'test@example.com')
    writeFileSync(join(repo, 'shared.txt'), 'one\n')
    jj(repo, 'commit', '-m', 'base')
    jj(repo, 'bookmark', 'create', 'main', '-r', '@-')
    jj(repo, 'git', 'remote', 'add', 'origin', origin)
    jj(repo, 'git', 'push', '--bookmark', 'main')
  })

  afterEach(() => {
    rmSync(ThreadWorkspaceModel.defaultThreadsDirectory(repo), { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
  })

  it('offers the remote copy of the main branch first', async () => {
    jj(repo, 'bookmark', 'create', 'feature', '-r', 'main')
    jj(repo, 'git', 'push', '--bookmark', 'feature')
    expect(await threads.remoteBookmarks(repo)).toEqual(['main@origin', 'feature@origin'])
  })

  it('fetches the remote bookmark first, so the thread starts from what the remote holds now', async () => {
    pushFromElsewhere(root, origin, 'pushed elsewhere')
    expect(jj(repo, '--ignore-working-copy', 'log', '--no-graph', '-r', 'main@origin', '-T', 'description.first_line()')).toBe('base')

    const thread = await threads.provision(repo, 'main@origin')

    expect(jj(thread.path, 'log', '--no-graph', '-r', '@-', '-T', 'description.first_line()')).toBe('pushed elsewhere')
    expect((await threads.bookmarks(thread.path)).current).not.toBeNull()
  })

  it('names the remote bookmark as the starting point when no local bookmark is that recent', async () => {
    // An untracked remote bookmark moves alone on fetch, leaving the local main behind it.
    jj(repo, 'bookmark', 'untrack', 'main@origin')
    pushFromElsewhere(root, origin, 'pushed elsewhere')

    const thread = await threads.provision(repo, 'main@origin')

    expect((await threads.bookmarks(thread.path)).current).toBe('main@origin')
  })

  it('starts from the last fetched position when the remote cannot be reached', async () => {
    renameSync(origin, `${origin}.offline`)

    const thread = await threads.provision(repo, 'main@origin')

    expect(jj(thread.path, 'log', '--no-graph', '-r', '@-', '-T', 'description.first_line()')).toBe('base')
  })

  it('never claims a spare made before the fetch at the old position', async () => {
    await threads.prewarm(repo, 'main@origin')
    await expect.poll(() => jj(repo, '--ignore-working-copy', 'workspace', 'list', '-T', 'name ++ "\\n"').split('\n').filter(Boolean).length).toBe(2)
    pushFromElsewhere(root, origin, 'pushed elsewhere')

    const thread = await threads.provision(repo, 'main@origin')

    expect(jj(thread.path, 'log', '--no-graph', '-r', '@-', '-T', 'description.first_line()')).toBe('pushed elsewhere')
  })
})

describe.skipIf(!gitAvailable)('starting a git thread worktree from a remote branch', () => {
  let root: string
  let origin: string
  let repo: string
  const threads = ThreadWorkspacesTestSupport.promiseThreads()
  const saved = { ...process.env }

  beforeEach(() => {
    Object.assign(process.env, gitEnv)
    root = realpathSync(mkdtempSync(join(tmpdir(), 'git-remote-base-')))
    origin = join(root, 'origin.git')
    repo = join(root, 'repo')
    git(root, 'init', '-q', '--bare', '-b', 'main', origin)
    git(root, 'init', '-q', '-b', 'main', repo)
    git(repo, 'config', 'user.name', 'Test')
    git(repo, 'config', 'user.email', 'test@example.com')
    writeFileSync(join(repo, 'shared.txt'), 'one\n')
    git(repo, 'add', '--all')
    git(repo, 'commit', '-q', '-m', 'base')
    git(repo, 'remote', 'add', 'origin', origin)
    git(repo, 'push', '-q', '-u', 'origin', 'main')
  })

  afterEach(() => {
    rmSync(ThreadWorkspaceModel.defaultThreadsDirectory(repo), { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    for (const key of Object.keys(gitEnv)) if (!(key in saved)) delete process.env[key]
  })

  it('offers origin/main and fetches it before starting the worktree', async () => {
    expect(await threads.remoteBookmarks(repo)).toEqual(['origin/main'])
    pushFromElsewhere(root, origin, 'pushed elsewhere')

    const thread = await threads.provision(repo, 'origin/main')

    expect(git(thread.path, 'log', '-1', '--format=%s')).toBe('pushed elsewhere')
    // The local branch is left where it was; only the remote-tracking ref moved.
    expect(git(repo, 'log', '-1', '--format=%s', 'main')).toBe('base')
  })

  it('starts a git worktree from the last fetched position when the remote cannot be reached', async () => {
    renameSync(origin, `${origin}.offline`)

    const thread = await threads.provision(repo, 'origin/main')

    expect(git(thread.path, 'log', '-1', '--format=%s')).toBe('base')
  })
})
