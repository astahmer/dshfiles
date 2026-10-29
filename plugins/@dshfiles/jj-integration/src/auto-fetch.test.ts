import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AutoFetchModel, createAutoFetchScheduler, type FetchOutcome } from './auto-fetch.js'
import { defaultJjIntegrationSettings } from './settings.js'
import type { JjExecutor } from './threads.js'

const jjAvailable = spawnSync('jj', ['--version']).status === 0
const env = { ...process.env, JJ_CONFIG: '', JJ_USER: 'Test', JJ_EMAIL: 'test@example.com' }

const execute: JjExecutor = async ({ args, cwd }) => {
  const result = spawnSync('jj', ['--color=never', '--no-pager', ...args], { cwd, encoding: 'utf8', env })
  return { exitCode: result.status ?? 1, stdout: result.stdout, stdoutLossy: false, stderr: result.stderr }
}

const jj = (cwd: string, ...args: string[]): string =>
  execFileSync('jj', ['--color=never', '--no-pager', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env })

const commitAt = (cwd: string, revset: string): string => jj(cwd, '--ignore-working-copy', 'log', '--no-graph', '-r', revset, '-T', 'commit_id').trim()

const advanceOrigin = (origin: string, content: string): void => {
  writeFileSync(join(origin, 'file.txt'), content)
  jj(origin, 'commit', '-m', content)
  jj(origin, 'bookmark', 'set', 'main', '-r', '@-')
}

describe('auto fetch settings', () => {
  it('is off by default and fetches origin every 30 minutes without moving the bookmark', () => {
    expect(defaultJjIntegrationSettings.autoFetch).toEqual({ enabled: false, intervalMinutes: 30, remote: 'origin', fastForwardBookmark: false })
  })
})

describe.skipIf(!jjAvailable)('auto fetch against real jj', () => {
  let root: string
  let origin: string
  let clone: string
  const fetch = (input: { readonly fastForward: boolean; readonly remote?: string }) =>
    AutoFetchModel.fetchRepository({ execute, repoRoot: clone, remote: input.remote ?? 'origin', bookmark: 'main', fastForward: input.fastForward })

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'jj-auto-fetch-')))
    origin = join(root, 'origin')
    clone = join(root, 'clone')
    execFileSync('jj', ['git', 'init', '--colocate', origin], { stdio: 'ignore', env })
    advanceOrigin(origin, 'one')
    execFileSync('jj', ['git', 'clone', origin, clone], { stdio: 'ignore', env })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('skips a repository without the configured remote', async () => {
    expect(await fetch({ fastForward: false, remote: 'upstream' })).toEqual({ status: 'no-remote', repoRoot: clone })
  })

  it('refreshes main@origin and reports when a tracked bookmark followed it', async () => {
    advanceOrigin(origin, 'two')
    expect(await fetch({ fastForward: false })).toEqual({ status: 'fetched', repoRoot: clone, bookmarkMoved: true })
    expect(commitAt(clone, 'main@origin')).toBe(commitAt(origin, 'main'))
  })

  it('fast-forwards an untracked local bookmark only when opted in', async () => {
    jj(clone, 'bookmark', 'untrack', 'main@origin')
    const before = commitAt(clone, 'main')
    advanceOrigin(origin, 'two')
    expect(await fetch({ fastForward: false })).toEqual({ status: 'fetched', repoRoot: clone, bookmarkMoved: false })
    expect(commitAt(clone, 'main')).toBe(before)
    const outcome = await fetch({ fastForward: true })
    expect(outcome).toEqual({ status: 'fast-forwarded', repoRoot: clone, from: before, to: commitAt(origin, 'main') })
    expect(commitAt(clone, 'main')).toBe(commitAt(origin, 'main'))
  })

  it('never moves a bookmark that holds local commits', async () => {
    jj(clone, 'bookmark', 'untrack', 'main@origin')
    jj(clone, 'new', 'main', '-m', 'local work')
    jj(clone, 'bookmark', 'set', 'main', '-r', '@')
    const local = commitAt(clone, 'main')
    advanceOrigin(origin, 'two')
    expect(await fetch({ fastForward: true })).toEqual({ status: 'fetched', repoRoot: clone, bookmarkMoved: false })
    expect(commitAt(clone, 'main')).toBe(local)
  })

  it('reports a failed fetch with a recovery hint and an error span', async () => {
    using recorder = recordSpans()
    rmSync(origin, { recursive: true, force: true })
    const outcome = await fetch({ fastForward: false })
    expect(outcome.status).toBe('failed')
    if (outcome.status !== 'failed') return
    expect(outcome.step).toBe('fetch')
    expect(AutoFetchModel.failureDetail(outcome, 'origin')).toContain('jj git fetch --remote origin')
    const span = recorder.span('jj-integration auto fetch')
    expect(span.attributes['dshx.fetch.status']).toBe('failed')
    expect(span.status.code).toBe('error')
  })

  it('runs every repository on schedule and stays idle while disabled', async () => {
    const reported: FetchOutcome[] = []
    let enabled = false
    const armed: (() => void)[] = []
    const scheduler = createAutoFetchScheduler({
      settings: () => ({ ...defaultJjIntegrationSettings.autoFetch, enabled }),
      bookmark: () => 'main',
      repositories: async () => [clone],
      execute,
      report: outcome => reported.push(outcome),
      schedule: run => {
        armed.push(run)
        return () => undefined
      },
    })
    expect(await scheduler.runOnce()).toEqual([])
    enabled = true
    expect(await scheduler.runOnce()).toEqual([{ status: 'fetched', repoRoot: clone, bookmarkMoved: false }])
    expect(reported).toHaveLength(1)
    expect(armed).toHaveLength(1)
    scheduler.dispose()
  })
})
