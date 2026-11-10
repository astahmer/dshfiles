import { posix } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CleanupResult } from './api.js'
import { createCleanupJobTrail, type CleanupJobRequest } from './cleanup-jobs.js'
import { CleanupOwnership } from './cleanup-ownership.js'

const repositories = [
  { repoRoot: '/work/sample', threads: [{ path: '/work/sample-threads/thread-aaaaaa' }] },
  { repoRoot: '/work/sample/vendor/nested', threads: [] },
]

const owner = (target: string) => CleanupOwnership.owner({ path: posix, repositories, target })

const request: CleanupJobRequest = { path: '/work/sample-threads/thread-aaaaaa', olderThanHours: 0, kinds: ['empty', 'integrated'], trigger: 'manual' }

const row = (repoRoot: string, name: string, outcome: 'removed' | 'failed'): CleanupResult['workspaces'][number] => ({
  repoRoot,
  name,
  path: `${repoRoot}-threads/${name}`,
  kind: 'integrated',
  lastUsedAt: 1,
  missing: false,
  outcome,
  ...(outcome === 'failed' && { message: `EACCES: permission denied, rmdir '${repoRoot}-threads/${name}/locked'` }),
})

const result = (workspaces: CleanupResult['workspaces']): CleanupResult => ({ applied: true, workspaces, skipped: [], untracked: [], emptyRevisions: [] })

describe('CleanupOwnership.owner', () => {
  it('traces an isolated thread workspace, which sits outside the project folder, back to its project', () => {
    expect(owner('/work/sample-threads/thread-aaaaaa')).toBe('/work/sample')
    expect(owner('/work/sample-threads/thread-aaaaaa/src')).toBe('/work/sample')
  })

  it('credits a folder to the deepest repository that holds it', () => {
    expect(owner('/work/sample/src')).toBe('/work/sample')
    expect(owner('/work/sample/vendor/nested/lib')).toBe('/work/sample/vendor/nested')
  })

  it('names no project for a sibling with a shared prefix or a folder outside every repository', () => {
    expect(owner('/work/sample-other')).toBeNull()
    expect(owner('/work/sample-threads/thread-bbbbbb')).toBeNull()
    expect(owner('/tmp')).toBeNull()
  })
})

describe('CleanupOwnership.ownerOfTargets', () => {
  it('gives a settle request without a folder the project all its targets share, and none when they span several', () => {
    const target = (repoRoot: string) => ({ repoRoot, name: 'thread-aaaaaa', kind: 'empty' as const })
    expect(CleanupOwnership.ownerOfTargets([target('/work/sample'), target('/work/sample')])).toBe('/work/sample')
    expect(CleanupOwnership.ownerOfTargets([target('/work/sample'), target('/work/other')])).toBeNull()
    expect(CleanupOwnership.ownerOfTargets([])).toBeNull()
  })
})

describe('CleanupOwnership.ownerFromJobs', () => {
  it('keeps a half-removed thread workspace tied to the project of the job that tried to remove it', () => {
    const trail = createCleanupJobTrail({ now: () => 1 })
    trail.done(trail.start({ ...request, path: '/work/sample' }, '/work/sample').id, result([row('/work/sample', 'thread-bbbbbb', 'failed')]))

    const jobs = trail.trail()

    expect(CleanupOwnership.ownerFromJobs({ path: posix, jobs, target: '/work/sample-threads/thread-bbbbbb' })).toBe('/work/sample')
    expect(CleanupOwnership.ownerFromJobs({ path: posix, jobs, target: '/work/sample/src' })).toBe('/work/sample')
    expect(CleanupOwnership.ownerFromJobs({ path: posix, jobs, target: '/work/unrelated' })).toBeNull()
  })
})

describe('CleanupOwnership.failures', () => {
  it('reports a failed job asked from a thread workspace on its project, with the reason and the recovery', () => {
    const trail = createCleanupJobTrail({ now: () => 1 })
    const failed = trail.failed(trail.start(request, '/work/sample').id, 'jj workspace forget exited 1')

    const [report, ...rest] = CleanupOwnership.failures(failed)

    expect(rest).toEqual([])
    expect(report).toMatchObject({ repoRoot: '/work/sample', summary: 'Thread-workspace cleanup failed in sample' })
    expect(report?.detail).toMatch(/^jj workspace forget exited 1 Nothing unlanded was removed\./u)
    expect(report?.detail).toContain('again from the sample Jujutsu panel')
  })

  it('reports workspaces a done job could not remove once per project, and nothing for a clean run', () => {
    const trail = createCleanupJobTrail({ now: () => 1 })
    const automatic: CleanupJobRequest = { path: null, olderThanHours: 24, kinds: ['empty', 'integrated'], trigger: 'automatic' }
    const job = trail.done(
      trail.start(automatic).id,
      result([row('/work/sample', 'thread-a', 'failed'), row('/work/sample', 'thread-b', 'removed'), row('/work/other', 'thread-c', 'failed')]),
    )
    const clean = trail.done(trail.start(automatic).id, result([row('/work/sample', 'thread-d', 'removed')]))

    const reports = CleanupOwnership.failures(job)

    expect(reports.map(report => [report.repoRoot, report.summary])).toEqual([
      ['/work/sample', 'Automatic cleanup could not remove 1 workspace in sample'],
      ['/work/other', 'Automatic cleanup could not remove 1 workspace in other'],
    ])
    expect(reports[0]?.detail).toContain("thread-a: EACCES: permission denied, rmdir '/work/sample-threads/thread-a/locked'")
    expect(reports[0]?.detail).toContain('thread-a stayed in place')
    expect(reports[0]?.detail).not.toContain('thread-c')
    expect(CleanupOwnership.failures(clean)).toEqual([])
  })
})
