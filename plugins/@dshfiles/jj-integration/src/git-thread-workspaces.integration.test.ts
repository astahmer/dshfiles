import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ThreadWorkspaceModel } from './thread-workspace-model.js'
import { ThreadWorkspacesTestSupport } from './thread-workspaces-test-support.js'

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
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: gitEnv }).trim()
const commit = (cwd: string, file: string, text: string, message: string): string => {
  writeFileSync(join(cwd, file), text)
  git(cwd, 'add', '--all')
  git(cwd, 'commit', '-q', '-m', message)
  return git(cwd, 'rev-parse', 'HEAD')
}

describe.skipIf(!gitAvailable)('thread workspaces in a git-only repository', () => {
  let root: string
  let repo: string
  const threads = ThreadWorkspacesTestSupport.promiseThreads()
  const saved = { ...process.env }

  beforeEach(() => {
    // The Host's git reads the same identity the fixture commits with.
    Object.assign(process.env, gitEnv)
    root = realpathSync(mkdtempSync(join(tmpdir(), 'git-threads-')))
    repo = join(root, 'repo')
    execFileSync('git', ['init', '-q', '-b', 'main', repo], { env: gitEnv })
    commit(repo, 'shared.txt', 'one\n', 'base')
  })

  afterEach(() => {
    rmSync(ThreadWorkspaceModel.defaultThreadsDirectory(repo), { recursive: true, force: true })
    rmSync(root, { recursive: true, force: true })
    for (const key of Object.keys(gitEnv)) if (!(key in saved)) delete process.env[key]
  })

  it('provisions a git worktree on the bookmark and locates it as a git thread', async () => {
    const thread = await threads.provision(repo)
    expect(thread.path).toBe(join(`${repo}-threads`, thread.name))
    expect(readFileSync(join(thread.path, 'shared.txt'), 'utf8')).toBe('one\n')
    expect(git(thread.path, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(`dsh/${thread.name}`)
    expect(await threads.locate(thread.path)).toEqual({ repoRoot: repo, workspaceRoot: thread.path, threadName: thread.name, vcs: 'git' })
    expect((await threads.locate(repo)).threadName).toBeUndefined()
    expect((await threads.list(repo)).map(entry => [entry.name, entry.unlanded.length, entry.behind])).toEqual([[thread.name, 0, false]])
    expect(await threads.bookmarks(thread.path)).toEqual({ current: 'main', names: ['main'] })
  })

  it('lands described commits by rebasing onto the moved bookmark and fast-forwarding the checked-out branch', async () => {
    const thread = await threads.provision(repo)
    commit(thread.path, 'feature.txt', 'feature\n', 'feat: add feature')
    commit(repo, 'other.txt', 'other\n', 'chore: other work on main')

    const before = await threads.status(repo, thread.name)
    expect(before.unlanded.map(revision => revision.description)).toEqual(['feat: add feature'])
    expect(before.behindCount).toBe(1)

    const outcome = await threads.land(thread.path, { sessionId: 'session-1' })

    expect(outcome.status).toBe('landed')
    const head = git(thread.path, 'rev-parse', 'HEAD')
    expect(git(repo, 'rev-parse', 'main')).toBe(head)
    // The main worktree had `main` checked out, so its files followed the bookmark.
    expect(readFileSync(join(repo, 'feature.txt'), 'utf8')).toBe('feature\n')
    expect(git(repo, 'status', '--porcelain')).toBe('')
    const history = await threads.reviewHistory({ repoRoot: repo, name: thread.name })
    expect(history.integrations.map(record => [record.tipChangeId, record.sessionId])).toEqual([[head, 'session-1']])
    expect((await threads.status(repo, thread.name)).unlanded).toEqual([])
    expect(await threads.land(thread.path)).toEqual({ status: 'nothing-to-land' })
  })

  it('asks for a commit before landing uncommitted edits and reports conflicts without leaving a rebase behind', async () => {
    const thread = await threads.provision(repo)
    writeFileSync(join(thread.path, 'shared.txt'), 'uncommitted\n')
    const dirty = await threads.land(thread.path)
    expect(dirty.status).toBe('needs-description')

    git(thread.path, 'commit', '-q', '-am', 'feat: thread edit')
    commit(repo, 'shared.txt', 'main edit\n', 'fix: main edit')
    const conflicted = await threads.land(thread.path)

    expect(conflicted).toMatchObject({ status: 'conflicted', files: ['shared.txt'] })
    expect(existsSync(join(git(thread.path, 'rev-parse', '--absolute-git-dir'), 'rebase-merge'))).toBe(false)
    expect(readFileSync(join(thread.path, 'shared.txt'), 'utf8')).toBe('uncommitted\n')
  })

  it('lands a verified candidate only after its checks pass, and refuses a stale source', async () => {
    const thread = await threads.provision(repo)
    commit(thread.path, 'feature.txt', 'feature\n', 'feat: verified')
    const source = await threads.workingCopyCommitId(thread.path)
    const stale = await threads.landVerified({
      path: thread.path,
      expectedSourceRevision: '1'.repeat(40),
      authorize: async () => true,
      verifyCandidate: async () => ({ status: 'passed' }),
    })
    expect(stale.status).toBe('verification-stale')

    const failed = await threads.landVerified({
      path: thread.path,
      expectedSourceRevision: source,
      authorize: async () => true,
      verifyCandidate: async () => ({ status: 'failed', message: 'tests failed' }),
    })
    expect(failed).toEqual({ status: 'verification-failed', message: 'tests failed' })
    expect(git(repo, 'rev-parse', 'main')).not.toBe(source)

    const candidates: string[] = []
    const landed = await threads.landVerified({
      path: thread.path,
      expectedSourceRevision: source,
      authorize: async () => true,
      verifyCandidate: async candidate => {
        candidates.push(candidate.workingCopyCommitId)
        return { status: 'passed' }
      },
    })
    expect(landed.status).toBe('landed')
    expect(git(repo, 'rev-parse', 'main')).toBe(candidates[0])
  })

  it('reports work already on the bookmark as integrated instead of landing it twice', async () => {
    const thread = await threads.provision(repo)
    const work = commit(thread.path, 'feature.txt', 'feature\n', 'feat: duplicated')
    // Move main first, so the cherry-pick is a new commit with the same patch rather than the very same commit.
    commit(repo, 'other.txt', 'other\n', 'chore: other')
    git(repo, 'cherry-pick', work)
    const outcome = await threads.landVerified({
      path: thread.path,
      expectedSourceRevision: work,
      authorize: async () => true,
      verifyCandidate: async () => ({ status: 'passed' }),
    })
    expect(outcome.status).toBe('already-integrated')
  })

  it('keeps a thread with work unless forced, then removes its worktree and branch', async () => {
    const thread = await threads.provision(repo)
    commit(thread.path, 'feature.txt', 'feature\n', 'feat: unlanded')

    const kept = await threads.discard({ repoRoot: repo, name: thread.name, force: false })
    expect(kept.status).toBe('has-work')
    expect(existsSync(thread.path)).toBe(true)

    expect(await threads.discard({ repoRoot: repo, name: thread.name, force: true })).toEqual({ status: 'discarded' })
    expect(existsSync(thread.path)).toBe(false)
    expect(git(repo, 'branch', '--list', `dsh/${thread.name}`)).toBe('')
    expect(await threads.list(repo)).toEqual([])
  })

  it('checks a deleted thread folder out again on its branch, keeping its commits', async () => {
    const thread = await threads.provision(repo)
    const work = commit(thread.path, 'feature.txt', 'feature\n', 'feat: survives')
    rmSync(thread.path, { recursive: true, force: true })
    expect((await threads.status(repo, thread.name)).missing).toBe(true)

    await threads.restore(repo, thread.path)

    expect(git(thread.path, 'rev-parse', 'HEAD')).toBe(work)
    expect(readFileSync(join(thread.path, 'feature.txt'), 'utf8')).toBe('feature\n')
  })

  it('snapshots and restores a worktree without moving HEAD or the real index', async () => {
    const thread = await threads.provision(repo)
    const head = git(thread.path, 'rev-parse', 'HEAD')
    const before = await threads.snapshotFiles(thread.path)
    writeFileSync(join(thread.path, 'shared.txt'), 'two\n')
    writeFileSync(join(thread.path, 'added.txt'), 'new\n')

    const redo = await threads.restoreFiles(thread.path, before)

    expect(readFileSync(join(thread.path, 'shared.txt'), 'utf8')).toBe('one\n')
    expect(existsSync(join(thread.path, 'added.txt'))).toBe(false)
    expect(git(thread.path, 'rev-parse', 'HEAD')).toBe(head)
    expect(git(thread.path, 'diff', '--cached', '--name-only')).toBe('')
    await threads.restoreFiles(thread.path, redo)
    expect(readFileSync(join(thread.path, 'added.txt'), 'utf8')).toBe('new\n')
    await expect(threads.restoreFiles(thread.path, 'not-a-commit')).rejects.toThrow('not a git commit id')
  })

  it('lists other worktrees as secondary and stray folders as untracked, and removes only clean ones', async () => {
    const other = join(root, 'other-worktree')
    git(repo, 'worktree', 'add', '-q', '-b', 'other', other)
    const directory = ThreadWorkspaceModel.defaultThreadsDirectory(repo)
    const stray = join(directory, 'stray')
    execFileSync('mkdir', ['-p', stray])

    const secondary = await threads.secondaryWorkspaces(repo)
    expect(secondary.map(workspace => [workspace.path, workspace.workingCopyState])).toEqual([[other, 'clean']])
    expect((await threads.untrackedEntries(repo)).map(entry => entry.name)).toEqual(['stray'])

    writeFileSync(join(other, 'edit.txt'), 'dirty\n')
    const refused = await threads.discardSecondaryMany({ repoRoot: repo, workspaces: [{ name: 'other-worktree', path: other, missing: false }] })
    expect(refused.results[0]?.status).toBe('has-work')
    rmSync(join(other, 'edit.txt'))
    const removed = await threads.discardSecondaryMany({ repoRoot: repo, workspaces: [{ name: 'other-worktree', path: other, missing: false }] })
    expect(removed.results[0]?.status).toBe('discarded')
    expect(existsSync(other)).toBe(false)

    await threads.removeUntrackedEntry({ repoRoot: repo, name: 'stray' })
    expect(existsSync(stray)).toBe(false)
    expect(await threads.danglingEmptyRevisions({ repoRoot: repo, abandon: false })).toEqual([])
  })

  it('locates the repository from a subfolder, not its parent', async () => {
    const sub = join(repo, 'nested', 'deeper')
    mkdirSync(sub, { recursive: true })
    expect(await threads.locate(sub)).toEqual({ repoRoot: repo, workspaceRoot: repo, threadName: undefined, vcs: 'git' })
  })

  it('treats worktrees in a threads directory reached through a symlink as threads, never as untracked folders', async () => {
    const real = join(root, 'real-threads')
    mkdirSync(real)
    const link = join(root, 'linked-threads')
    symlinkSync(real, link)
    const linked = ThreadWorkspacesTestSupport.promiseThreads({ settings: { threadsDirectory: link } })
    const thread = await linked.provision(repo)
    writeFileSync(join(thread.path, 'unsaved.txt'), 'work in progress\n')

    expect((await linked.list(repo)).map(entry => entry.name)).toEqual([thread.name])
    expect(await linked.untrackedEntries(repo)).toEqual([])
    await expect(linked.removeUntrackedEntry({ repoRoot: repo, name: thread.name })).rejects.toThrow()
    expect(readFileSync(join(real, 'repo', thread.name, 'unsaved.txt'), 'utf8')).toBe('work in progress\n')
    await expect(linked.discard({ repoRoot: repo, name: '../repo', force: true })).rejects.toThrow()
  })

  it('refuses a bookmark that looks like an option or names no branch, with a recovery hint', async () => {
    await expect(threads.provision(repo, '--output=/tmp/x')).rejects.toThrow(/Settings/)
    await expect(threads.provision(repo, 'no-such-branch')).rejects.toThrow(/Settings/)
  })
})
