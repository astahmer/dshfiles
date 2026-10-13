import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createThreads, defaultThreadsDirectory, type JjExecutor } from './threads.js'

const jjAvailable = spawnSync('jj', ['--version']).status === 0

const executor: JjExecutor = async ({ args, cwd }) => {
  const result = spawnSync('jj', ['--color=never', '--no-pager', ...args], { cwd, encoding: 'utf8', env: { ...process.env, JJ_CONFIG: '' } })
  return { exitCode: result.status ?? 1, stdout: result.stdout, stderr: result.stderr }
}

const jj = (cwd: string, ...args: string[]): string =>
  execFileSync('jj', ['--color=never', '--no-pager', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, JJ_CONFIG: '' } })

const bookmarkTarget = (cwd: string): string => jj(cwd, '--ignore-working-copy', 'log', '--no-graph', '-r', 'main', '-T', 'description.first_line()')

describe.skipIf(!jjAvailable)('thread workspaces against real jj', () => {
  let root: string
  let repo: string
  const threads = createThreads({ executor, bookmark: () => 'main', threadsDirectory: defaultThreadsDirectory })

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'jj-threads-')))
    repo = join(root, 'repo')
    execFileSync('jj', ['git', 'init', repo], { stdio: 'ignore', env: { ...process.env, JJ_CONFIG: '' } })
    jj(repo, 'config', 'set', '--repo', 'user.name', 'Test')
    jj(repo, 'config', 'set', '--repo', 'user.email', 'test@example.com')
    writeFileSync(join(repo, 'shared.txt'), 'one\n')
    jj(repo, 'commit', '-m', 'base')
    jj(repo, 'bookmark', 'create', 'main', '-r', '@-')
  })

  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('provisions a checked-out workspace on the bookmark and recognises it as a thread', async () => {
    const thread = await threads.provision(repo)
    expect(thread.path).toBe(join(`${repo}-threads`, thread.name))
    expect(existsSync(join(thread.path, 'shared.txt'))).toBe(true)
    expect((await threads.locate(thread.path)).threadName).toBe(thread.name)
    expect((await threads.locate(repo)).threadName).toBeUndefined()
    expect((await threads.list(repo)).map(entry => entry.name)).toEqual([thread.name])
  })

  it('lists local bookmarks and starts a thread from the chosen one', async () => {
    jj(repo, 'bookmark', 'create', 'feature', '-r', '@')
    jj(repo, 'describe', '-m', 'feature base')
    expect(await threads.bookmarks(repo)).toEqual({ current: 'feature', names: ['feature', 'main'] })
    const thread = await threads.provision(repo, 'feature')
    expect(jj(thread.path, 'log', '--no-graph', '-r', '@-', '-T', 'description.first_line()')).toBe('feature base')
    expect((await threads.bookmarks(thread.path)).current).toBe('feature')
  })

  it('lands described work onto the bookmark and leaves a fresh working copy', async () => {
    const thread = await threads.provision(repo)
    writeFileSync(join(thread.path, 'feature.txt'), 'feature\n')
    jj(thread.path, 'describe', '-m', 'feat: add feature')
    writeFileSync(join(repo, 'other.txt'), 'other\n')
    jj(repo, 'commit', '-m', 'other work')
    jj(repo, 'bookmark', 'set', 'main', '-r', '@-')

    const outcome = await threads.land(thread.path)
    expect(outcome).toMatchObject({ status: 'landed', revisions: [{ description: 'feat: add feature', conflict: false }] })
    expect(bookmarkTarget(repo)).toBe('feat: add feature')
    expect(jj(repo, '--ignore-working-copy', 'log', '--no-graph', '-r', 'main-', '-T', 'description.first_line()')).toBe('other work')
    const [status] = await threads.list(repo)
    expect(status).toMatchObject({ unlanded: [], behind: false })
  })

  it('asks for a description instead of landing placeholder work', async () => {
    const thread = await threads.provision(repo)
    writeFileSync(join(thread.path, 'feature.txt'), 'feature\n')
    jj(thread.path, 'describe', '-m', 'wip')
    expect(await threads.land(thread.path)).toMatchObject({ status: 'needs-description' })
    expect(bookmarkTarget(repo)).toBe('base')
  })

  it('reports conflicting files and keeps the bookmark where it was', async () => {
    const thread = await threads.provision(repo)
    writeFileSync(join(thread.path, 'shared.txt'), 'thread\n')
    jj(thread.path, 'describe', '-m', 'thread edit')
    writeFileSync(join(repo, 'shared.txt'), 'main\n')
    jj(repo, 'commit', '-m', 'main edit')
    jj(repo, 'bookmark', 'set', 'main', '-r', '@-')

    expect(await threads.land(thread.path)).toMatchObject({ status: 'conflicted', files: ['shared.txt'] })
    expect(bookmarkTarget(repo)).toBe('main edit')
  })

  it('discards an empty thread completely and refuses one with unlanded work', async () => {
    const empty = await threads.provision(repo)
    const busy = await threads.provision(repo)
    writeFileSync(join(busy.path, 'draft.txt'), 'draft\n')

    expect(await threads.discard({ repoRoot: repo, name: empty.name, force: false })).toEqual({ status: 'discarded' })
    expect(existsSync(empty.path)).toBe(false)
    expect(jj(repo, '--ignore-working-copy', 'log', '--no-graph', '-r', 'heads(mutable()) & empty() ~ working_copies()', '-T', 'commit_id')).toBe('')

    expect(await threads.discard({ repoRoot: repo, name: busy.name, force: false })).toMatchObject({ status: 'has-work' })
    expect(existsSync(join(busy.path, 'draft.txt'))).toBe(true)
    expect(await threads.discard({ repoRoot: repo, name: busy.name, force: true })).toEqual({ status: 'discarded' })
    expect((await threads.list(repo)).map(entry => entry.name)).toEqual([])
  })
})
