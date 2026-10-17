import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createThreads, type JjExecutor, type JjResult } from './threads.js'

const ok = (stdout: string): JjResult => ({ exitCode: 0, stdout, stdoutLossy: false, stderr: '' })

const roots: string[] = []

const createRoot = async (): Promise<{ readonly repoRoot: string; readonly directory: string }> => {
  const repoRoot = await mkdtemp(join(tmpdir(), 'jj-threads-list-'))
  const directory = join(repoRoot, 'threads')
  await mkdir(directory, { recursive: true })
  roots.push(repoRoot)
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
    threads: createThreads({ executor, bookmark: () => 'main', threadsDirectory: repoRoot => join(repoRoot, 'threads') }),
    maximumConcurrent: () => maximumConcurrent,
    logReads: () => logReads,
  }
}

describe('threads.list', () => {
  it('reads thread workspaces concurrently within the cap and keeps workspace order', async () => {
    const { repoRoot, directory } = await createRoot()
    const names = Array.from({ length: 12 }, (_, index) => `thread-${String(index).padStart(2, '0')}`)
    for (const name of names) await mkdir(join(directory, name, '.jj'), { recursive: true })

    const listing = threadsFor(names)
    const statuses = await listing.threads.list(repoRoot)

    expect(statuses.map(status => status.name)).toEqual(names)
    expect(statuses.every(status => status.unlanded.length === 0 && status.behind === false && status.missing === false)).toBe(true)
    expect(listing.logReads()).toBe(names.length * 2)
    expect(listing.maximumConcurrent()).toBeGreaterThan(1)
    expect(listing.maximumConcurrent()).toBeLessThanOrEqual(4)
  })

  it('skips a workspace that has no checkout and is not a thread workspace', async () => {
    const { repoRoot, directory } = await createRoot()
    await mkdir(join(directory, 'thread-keep', '.jj'), { recursive: true })

    const statuses = await threadsFor(['thread-keep', 'stale-project']).threads.list(repoRoot)

    expect(statuses.map(status => status.name)).toEqual(['thread-keep'])
  })
})
