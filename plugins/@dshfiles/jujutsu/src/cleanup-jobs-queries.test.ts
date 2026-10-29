import { describe, expect, it, vi } from 'vitest'
import type { CleanupJobView, CleanupResult } from '@dshfiles/jj-integration/api'
import { CleanupJobTrailModel, requestWorkspaceCleanup, type CleanupStartClient } from './cleanup-jobs-queries.js'

const job = (overrides: Partial<CleanupJobView> = {}): CleanupJobView => ({
  id: 'cleanup-1',
  state: 'running',
  phase: 'scanning',
  request: { path: '/work/sample', olderThanHours: 6, kinds: ['empty', 'integrated'] },
  startedAt: 1_000,
  finishedAt: null,
  progress: { total: 0, processed: 0, removed: 0, kept: 0, failed: 0, current: null },
  error: null,
  result: null,
  ...overrides,
})

const request = { path: '/work/sample', olderThanHours: 6, kinds: ['empty', 'integrated'] as const }

const cleanupResult = (): CleanupResult => ({ applied: true, workspaces: [], skipped: [], untracked: [], emptyRevisions: [] })

describe('CleanupJobTrailModel.phaseLabel', () => {
  it('names the phase the Host reports', () => {
    expect(CleanupJobTrailModel.phaseLabel(job())).toBe('Looking for idle workspaces')
    expect(CleanupJobTrailModel.phaseLabel(job({ state: 'queued', phase: 'queued' }))).toBe('Waiting for the removal already running')
    expect(CleanupJobTrailModel.phaseLabel(job({ phase: 'removing' }))).toBe('Removing thread workspaces')
    expect(CleanupJobTrailModel.phaseLabel(job({ phase: 'abandoning' }))).toBe('Abandoning empty revisions')
  })

  it('names a settled job by its outcome', () => {
    expect(CleanupJobTrailModel.phaseLabel(job({ state: 'done', phase: 'done' }))).toBe('Cleanup finished')
    expect(CleanupJobTrailModel.phaseLabel(job({ state: 'failed', phase: 'failed' }))).toBe('Cleanup failed')
  })
})

describe('CleanupJobTrailModel.progressLabel', () => {
  it('counts settled items against the scan total, and says nothing before the scan found any', () => {
    expect(CleanupJobTrailModel.progressLabel(job())).toBe('')
    expect(CleanupJobTrailModel.progressLabel(job({ progress: { total: 8, processed: 3, removed: 3, kept: 0, failed: 0, current: 'thread-aaaaaa' } }))).toBe(
      '3/8',
    )
  })
})

describe('CleanupJobTrailModel.summary', () => {
  it('reports the failure message of a job that stopped', () => {
    expect(CleanupJobTrailModel.summary(job({ state: 'failed', phase: 'failed', error: 'jj workspace forget exited 1' }))).toBe('jj workspace forget exited 1')
  })

  it('summarizes a finished job from its rows, keeping the counts that are not zero', () => {
    const finished = job({
      state: 'done',
      phase: 'done',
      progress: { total: 4, processed: 4, removed: 2, kept: 1, failed: 1, current: null },
      result: {
        applied: true,
        workspaces: [
          { repoRoot: '/work/sample', name: 'thread-aaaaaa', path: '/t/a', kind: 'empty', lastUsedAt: 1, outcome: 'removed' },
          { repoRoot: '/work/sample', name: 'thread-bbbbbb', path: '/t/b', kind: 'empty', lastUsedAt: 1, outcome: 'removed' },
          { repoRoot: '/work/sample', name: 'thread-cccccc', path: '/t/c', kind: 'empty', lastUsedAt: 1, outcome: 'failed', message: 'busy' },
        ],
        skipped: [],
        untracked: [{ repoRoot: '/work/sample', name: 'stray.log', path: '/t/stray.log', modifiedAt: 1, outcome: 'removed' }],
        emptyRevisions: [{ changeId: 'c', commitId: 'a'.repeat(40), description: '', conflict: false }],
      },
    })

    expect(CleanupJobTrailModel.summary(finished)).toBe(
      '2 thread workspaces removed · 1 untracked folder removed · 1 empty revision abandoned · 1 kept · 1 failed (busy)',
    )
  })

  it('falls back to the progress counts for a job whose rows the trail dropped', () => {
    const older = job({ state: 'done', phase: 'done', progress: { total: 3, processed: 3, removed: 3, kept: 0, failed: 0, current: null } })

    expect(CleanupJobTrailModel.summary(older)).toBe('3 thread workspaces removed')
  })

  it('does not report a removal when cleanup removed nothing', () => {
    const finished = job({ state: 'done', phase: 'done', result: cleanupResult() })

    expect(CleanupJobTrailModel.summary(finished)).toBe('')
  })
})

describe('CleanupJobTrailModel.isActive', () => {
  it('keeps polling for a queued job that has not started yet', () => {
    expect(CleanupJobTrailModel.isActive(job({ state: 'queued', phase: 'queued' }))).toBe(true)
    expect(CleanupJobTrailModel.isActive(job())).toBe(true)
    expect(CleanupJobTrailModel.isActive(job({ state: 'done', phase: 'done' }))).toBe(false)
    expect(CleanupJobTrailModel.isActive(job({ state: 'failed', phase: 'failed' }))).toBe(false)
  })
})

describe('requestWorkspaceCleanup', () => {
  const client = (overrides: Partial<CleanupStartClient> = {}): CleanupStartClient => ({
    startCleanup: vi.fn(async () => ({ job: job() })),
    cleanupWorkspaces: vi.fn(async () => cleanupResult()),
    ...overrides,
  })

  it('starts the background job without waiting for a removal', async () => {
    const api = client()

    await requestWorkspaceCleanup(api, request)

    expect(api.startCleanup).toHaveBeenCalledWith({ ...request, kinds: ['empty', 'integrated'] })
    expect(api.cleanupWorkspaces).not.toHaveBeenCalled()
  })

  it('falls back to the blocking verb when the Host predates the background one', async () => {
    const api = client({
      startCleanup: vi.fn(async () => {
        throw new Error('Unknown API method jj-threads.startCleanup.')
      }),
    })

    await requestWorkspaceCleanup(api, request)

    expect(api.cleanupWorkspaces).toHaveBeenCalledWith({ ...request, kinds: ['empty', 'integrated'], apply: true })
  })

  it('reports a real refusal instead of removing synchronously behind the user', async () => {
    const api = client({
      startCleanup: vi.fn(async () => {
        throw new Error('The Host rejected the request.')
      }),
    })

    await expect(requestWorkspaceCleanup(api, request)).rejects.toThrow('The Host rejected the request.')
    expect(api.cleanupWorkspaces).not.toHaveBeenCalled()
  })
})
