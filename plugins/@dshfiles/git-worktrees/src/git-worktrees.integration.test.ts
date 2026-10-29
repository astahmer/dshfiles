import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createGitWorktrees } from './git-worktrees.js'

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

describe('git worktrees against real git', () => {
  let root: string
  let repo: string
  const worktrees = createGitWorktrees({ threadsDirectory: repoRoot => `${repoRoot}-threads` })

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'git-worktrees-')))
    repo = join(root, 'repo')
    execFileSync('git', ['init', '-q', '-b', 'main', repo])
    git(repo, 'config', 'user.name', 'Test')
    git(repo, 'config', 'user.email', 'test@example.com')
    writeFileSync(join(repo, 'shared.txt'), 'one\n')
    writeFileSync(join(repo, '.gitignore'), 'ignored.txt\n')
    git(repo, 'add', '.')
    git(repo, 'commit', '-q', '-m', 'base')
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('provisions a thread worktree on its own branch and recognises it', async () => {
    const thread = await worktrees.provision(repo, undefined)

    expect(thread.path).toBe(join(`${repo}-threads`, thread.name))
    expect(readFileSync(join(thread.path, 'shared.txt'), 'utf8')).toBe('one\n')
    expect(await worktrees.locate(thread.path)).toEqual({ repoRoot: repo, workspaceRoot: thread.path, threadName: thread.name })
    expect(await worktrees.locate(repo)).toEqual({ repoRoot: repo, workspaceRoot: repo, threadName: undefined })
    expect(await worktrees.worktrees(repo)).toEqual([{ name: thread.name, path: thread.path, branch: `dsh/${thread.name}` }])

    await worktrees.remove(thread.path, false)
    expect(existsSync(thread.path)).toBe(false)
    expect(await worktrees.worktrees(repo)).toEqual([])
  })

  it('is not a repository outside git and refuses to remove the project checkout', async () => {
    using recorder = recordSpans()
    expect(await worktrees.locate(root)).toBeUndefined()
    const span = recorder.span('git rev-parse')
    expect(span.status.code).toBe('error')
    expect(JSON.stringify(span.attributes)).not.toContain(root)
    await expect(worktrees.remove(repo, true)).rejects.toThrow('not a thread worktree')
  })

  it('restores files to a snapshot and back, leaving the index, HEAD and ignored files alone', async () => {
    const head = git(repo, 'rev-parse', 'HEAD')
    writeFileSync(join(repo, 'untracked.txt'), 'kept\n')
    const before = await worktrees.snapshot(repo)
    writeFileSync(join(repo, 'shared.txt'), 'two\n')
    writeFileSync(join(repo, 'added.txt'), 'new\n')
    writeFileSync(join(repo, 'ignored.txt'), 'local\n')
    rmSync(join(repo, 'untracked.txt'))

    const redo = await worktrees.restore(repo, before)

    expect(readFileSync(join(repo, 'shared.txt'), 'utf8')).toBe('one\n')
    expect(readFileSync(join(repo, 'untracked.txt'), 'utf8')).toBe('kept\n')
    expect(existsSync(join(repo, 'added.txt'))).toBe(false)
    expect(readFileSync(join(repo, 'ignored.txt'), 'utf8')).toBe('local\n')
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head)
    expect(git(repo, 'diff', '--cached', '--name-only')).toBe('')

    await worktrees.restore(repo, redo)
    expect(readFileSync(join(repo, 'shared.txt'), 'utf8')).toBe('two\n')
    expect(readFileSync(join(repo, 'added.txt'), 'utf8')).toBe('new\n')
    expect(existsSync(join(repo, 'untracked.txt'))).toBe(false)
    await expect(worktrees.restore(repo, 'HEAD~1')).rejects.toThrow('not a git commit id')
  })
})
