import { execFileSync, spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ThreadWorkspacesTestSupport, type JjExecutor, type JjResult } from './thread-workspaces-test-support.js'

const ok = (stdout: string): JjResult => ({ exitCode: 0, stdout, stderr: '' })

const roots: string[] = []

const createRoot = async (): Promise<{ readonly repoRoot: string; readonly directory: string }> => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'jj-threads-list-'))
  const directory = `${repoRoot}-threads`
  await mkdir(directory, { recursive: true })
  roots.push(repoRoot, directory)
  return { repoRoot, directory }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

const threadsFor = (names: readonly string[]) => {
  let active = 0
  let maximumConcurrent = 0
  let logReads = 0
  const executor: JjExecutor = async input => {
    if (input.args.includes('workspace') && input.args.includes('list')) return ok(`${names.join('\n')}\n`)
    active += 1
    logReads += 1
    maximumConcurrent = Math.max(maximumConcurrent, active)
    await new Promise(resolve => setTimeout(resolve, 1))
    active -= 1
    return ok('')
  }
  return {
    threads: ThreadWorkspacesTestSupport.promiseThreads({ executor }),
    maximumConcurrent: () => maximumConcurrent,
    logReads: () => logReads,
  }
}

/** Mirrors `STATUS_READ_CONCURRENCY`: a store with dozens of thread workspaces is scanned while the user works. */
const MAX_CONCURRENT_THREAD_READS = 8

describe('threads.list', () => {
  it('reads every thread workspace of a repository with one jj log and keeps workspace order', async () => {
    const { repoRoot, directory } = await createRoot()
    const names = Array.from({ length: 44 }, (_, index) => `thread-${String(index).padStart(2, '0')}`)
    for (const name of names) await mkdir(join(directory, name, '.jj'), { recursive: true })

    const listing = threadsFor(names)
    const statuses = await listing.threads.list(repoRoot)

    expect(statuses.map(status => status.name)).toEqual(names)
    expect(statuses.every(status => status.unlanded.length === 0 && status.behind === false && status.missing === false)).toBe(true)
    // The workspaces' log, plus the bookmark and the target resolution.
    expect(listing.logReads()).toBe(3)
  })

  it('splits a very large store into a bounded number of concurrent reads', async () => {
    const { repoRoot, directory } = await createRoot()
    const names = Array.from({ length: 300 }, (_, index) => `thread-${String(index).padStart(4, '0')}`)
    for (const name of names) await mkdir(join(directory, name, '.jj'), { recursive: true })

    const listing = threadsFor(names)
    const statuses = await listing.threads.list(repoRoot)

    expect(statuses).toHaveLength(names.length)
    expect(listing.logReads()).toBe(Math.ceil(names.length / 128) + 2)
    expect(listing.maximumConcurrent()).toBeGreaterThan(1)
    expect(listing.maximumConcurrent()).toBeLessThanOrEqual(MAX_CONCURRENT_THREAD_READS)
  })

  it('skips a workspace that has no checkout and is not a thread workspace', async () => {
    const { repoRoot, directory } = await createRoot()
    await mkdir(join(directory, 'thread-keep', '.jj'), { recursive: true })

    const statuses = await threadsFor(['thread-keep', 'stale-project']).threads.list(repoRoot)

    expect(statuses.map(status => status.name)).toEqual(['thread-keep'])
  })
})

const jjAvailable = spawnSync('jj', ['--version']).status === 0

const jj = (cwd: string, ...args: string[]): string =>
  execFileSync('jj', ['--color=never', '--no-pager', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, JJ_CONFIG: '' },
  })

const REVISION_TEMPLATE = 'change_id ++ "\\t" ++ commit_id ++ "\\t" ++ conflict ++ "\\t" ++ description.first_line() ++ "\\n"'

/** What one workspace's own `jj log` read before every workspace shared one: its unlanded revisions and behind count. */
const perWorkspaceRead = (repoRoot: string, name: string) => {
  const target = 'bookmarks(exact:"main")'
  const unlanded = `(::${name}@ ~ ::${target}) ~ empty()`
  const output = jj(
    repoRoot,
    '--ignore-working-copy',
    'log',
    '--no-graph',
    '-r',
    `(${unlanded}) | latest((::${target} ~ ::${name}@) ~ empty(), 1001)`,
    '-T',
    `if(self.contained_in("${unlanded.replaceAll('"', '\\"')}"), "U\\t", "B\\t") ++ ${REVISION_TEMPLATE}`,
  )
  const marked = output.split('\n').filter(line => line.length > 0)
  return {
    unlanded: marked
      .filter(line => line.startsWith('U\t'))
      .map(line => {
        const [changeId = '', commitId = '', conflict = '', ...description] = line.slice(2).split('\t')
        return { changeId, commitId, conflict: conflict === 'true', description: description.join('\t').trim() }
      }),
    behindCount: marked.filter(line => line.startsWith('B\t')).length,
  }
}

describe.skipIf(!jjAvailable)('threads.list against real jj', () => {
  it('reads each workspace as its own log did, spawns nothing while the operation head stays, and reads again once it moves', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'jj-threads-list-real-')))
    roots.push(root)
    const repoRoot = join(root, 'repo')
    const directory = `${repoRoot}-threads`
    roots.push(directory)
    jj(root, 'git', 'init', repoRoot)
    jj(repoRoot, 'config', 'set', '--repo', 'user.name', 'Test')
    jj(repoRoot, 'config', 'set', '--repo', 'user.email', 'test@example.com')
    await writeFile(join(repoRoot, 'shared.txt'), 'one\n')
    jj(repoRoot, 'commit', '-m', 'base')
    jj(repoRoot, 'bookmark', 'create', 'main', '-r', '@-')
    const names = ['thread-aaaaaa', 'thread-bbbbbb', 'thread-cccccc']
    await mkdir(directory, { recursive: true })
    for (const name of names) jj(repoRoot, 'workspace', 'add', '--name', name, '-r', 'main', join(directory, name))
    await writeFile(join(directory, 'thread-aaaaaa', 'a.txt'), 'a\n')
    jj(join(directory, 'thread-aaaaaa'), 'commit', '-m', 'a work\twith a tab')
    await writeFile(join(directory, 'thread-bbbbbb', 'b.txt'), 'b\n')
    jj(join(directory, 'thread-bbbbbb'), 'describe', '-m', 'b draft')
    await writeFile(join(repoRoot, 'next.txt'), 'two\n')
    jj(repoRoot, 'commit', '-m', 'main advances')
    jj(repoRoot, 'bookmark', 'set', 'main', '-r', '@-')

    let logReads = 0
    const threads = ThreadWorkspacesTestSupport.promiseThreads({
      executor: input => {
        if (input.args.includes('log')) logReads += 1
        return ThreadWorkspacesTestSupport.spawnJj(input)
      },
    })
    try {
      const first = await threads.list(repoRoot)
      expect(first.map(status => status.name)).toEqual(names)
      for (const status of first) {
        const expected = perWorkspaceRead(repoRoot, status.name)
        expect({ unlanded: status.unlanded, behindCount: status.behindCount, behind: status.behind }).toEqual({
          unlanded: expected.unlanded,
          behindCount: expected.behindCount,
          behind: expected.behindCount > 0,
        })
      }
      expect(first.find(status => status.name === 'thread-aaaaaa')?.unlanded.map(revision => revision.description)).toEqual(['a work\twith a tab'])
      expect(first.find(status => status.name === 'thread-bbbbbb')?.unlanded.map(revision => revision.description)).toEqual(['b draft'])
      expect(first.find(status => status.name === 'thread-cccccc')?.behindCount).toBe(1)

      logReads = 0
      await threads.list(repoRoot)
      expect(logReads).toBe(0)

      await writeFile(join(directory, 'thread-cccccc', 'c.txt'), 'c\n')
      jj(join(directory, 'thread-cccccc'), 'describe', '-m', 'c draft')
      const moved = await threads.list(repoRoot)
      // The target resolution and one log for every workspace.
      expect(logReads).toBe(2)
      expect(moved.find(status => status.name === 'thread-cccccc')?.unlanded.map(revision => revision.description)).toEqual(['c draft'])
    } finally {
      await threads.dispose()
    }
  })
})
