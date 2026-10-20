import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { JjReadCache } from './jj-read-cache.js'

const jjAvailable = spawnSync('jj', ['--version']).status === 0
const env = { ...process.env, JJ_CONFIG: '' }

describe.skipIf(!jjAvailable)('JjReadCache against real jj', () => {
  let repo: string
  let spawns: number

  beforeEach(() => {
    repo = join(realpathSync(mkdtempSync(join(tmpdir(), 'jj-read-cache-'))), 'repo')
    execFileSync('jj', ['git', 'init', repo], { stdio: 'ignore', env })
    spawns = 0
  })

  afterEach(() => {
    rmSync(join(repo, '..'), { recursive: true, force: true })
  })

  const describeAt = (cache: JjReadCache<string>, cwd: string) => {
    const args = ['--ignore-working-copy', 'log', '--no-graph', '-r', '@', '-T', 'description']
    return cache.read({
      args,
      cwd,
      run: async () => {
        spawns += 1
        return execFileSync('jj', ['--color=never', ...args], { cwd, encoding: 'utf8', env })
      },
      succeeded: () => true,
    })
  }

  it('answers a repeated view read without spawning jj until an operation lands', async () => {
    const cache = new JjReadCache<string>()

    expect(await describeAt(cache, repo)).toBe('')
    expect(await describeAt(cache, repo)).toBe('')
    expect(spawns).toBe(1)

    execFileSync('jj', ['describe', '-m', 'first'], { cwd: repo, stdio: 'ignore', env })
    expect(await describeAt(cache, repo)).toBe('first\n')
    expect(spawns).toBe(2)
  })

  it('shares the operation head with a secondary workspace of the same store', async () => {
    const cache = new JjReadCache<string>()
    const secondary = join(repo, '..', 'secondary')
    execFileSync('jj', ['workspace', 'add', secondary], { cwd: repo, stdio: 'ignore', env })

    await describeAt(cache, secondary)
    execFileSync('jj', ['describe', '-m', 'from the main workspace'], { cwd: repo, stdio: 'ignore', env })
    await describeAt(cache, secondary)
    expect(spawns).toBe(2)
  })

  it('only treats --ignore-working-copy reads as view reads', () => {
    expect(JjReadCache.isViewRead(['--ignore-working-copy', 'workspace', 'list'])).toBe(true)
    expect(JjReadCache.isViewRead(['--ignore-working-copy', 'workspace', 'forget', 'thread-1'])).toBe(false)
    expect(JjReadCache.isViewRead(['log', '-r', '@'])).toBe(false)
  })
})
