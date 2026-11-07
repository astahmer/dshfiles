import { describe, expect, it, vi } from 'vitest'
import type { CleanupJobView, CleanupResult } from '@dshfiles/jj-integration/api'
import {
  CleanupJobTrailModel,
  createCleanupJobsReader,
  requestWorkspaceCleanup,
  type CleanupJobsClient,
  type CleanupStartClient,
} from './cleanup-jobs-queries.js'

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
          { repoRoot: '/work/sample', name: 'thread-aaaaaa', path: '/t/a', kind: 'empty', lastUsedAt: 1, missing: false, outcome: 'removed' },
          { repoRoot: '/work/sample', name: 'thread-bbbbbb', path: '/t/b', kind: 'empty', lastUsedAt: 1, missing: false, outcome: 'removed' },
          { repoRoot: '/work/sample', name: 'thread-cccccc', path: '/t/c', kind: 'empty', lastUsedAt: 1, missing: false, outcome: 'failed', message: 'busy' },
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

describe('CleanupJobTrailModel failures', () => {
  const failedRows = { total: 2, processed: 2, removed: 1, kept: 0, failed: 1, current: null }

  it('treats a stopped job and a job that left a workspace behind as failures, and nothing else', () => {
    expect(CleanupJobTrailModel.hasFailure(job({ state: 'failed', phase: 'failed', error: 'boom' }))).toBe(true)
    expect(CleanupJobTrailModel.hasFailure(job({ state: 'done', phase: 'done', progress: failedRows }))).toBe(true)
    expect(CleanupJobTrailModel.hasFailure(job({ state: 'done', phase: 'done' }))).toBe(false)
    expect(CleanupJobTrailModel.hasFailure(job({ progress: failedRows }))).toBe(false)
  })

  it('shows the Host recovery, and a guarded rerun from a Host that predates it', () => {
    const recovery = 'thread-a stayed in place. Fix what blocked the removal, then run Clean up thread workspaces… again.'
    expect(CleanupJobTrailModel.recovery(job({ state: 'done', phase: 'done', progress: failedRows, recovery }))).toBe(recovery)
    expect(CleanupJobTrailModel.recovery(job({ state: 'failed', phase: 'failed', error: 'boom' }))).toContain('never forces unlanded work')
    expect(CleanupJobTrailModel.recovery(job({ state: 'done', phase: 'done' }))).toBeNull()
  })

  it('heads a failure with what stayed, and keeps the Host reason apart so a long path cannot hide it', () => {
    const failedRow = (name: string) =>
      ({
        repoRoot: '/work/sample',
        name,
        path: `/work/sample-threads/${name}`,
        kind: 'empty',
        lastUsedAt: 1,
        missing: false,
        outcome: 'failed',
        message: `Could not remove /work/sample-threads/${name}. PermissionDenied`,
      }) as const
    const partial = job({
      state: 'done',
      phase: 'done',
      progress: failedRows,
      result: { ...cleanupResult(), workspaces: [failedRow('thread-a'), failedRow('thread-b')] },
    })

    expect(CleanupJobTrailModel.failure(partial)).toEqual({
      headline: 'Could not remove thread-a and 1 more',
      reason: 'Could not remove /work/sample-threads/thread-a. PermissionDenied',
    })
    expect(CleanupJobTrailModel.failure(job({ state: 'done', phase: 'done', progress: failedRows }))).toEqual({
      headline: 'Could not remove 1 workspace',
      reason: null,
    })
    expect(CleanupJobTrailModel.failure(job({ state: 'failed', phase: 'failed', error: 'boom' }))).toEqual({ headline: 'Cleanup failed', reason: 'boom' })
    expect(CleanupJobTrailModel.failure(job({ state: 'done', phase: 'done' }))).toBeNull()
  })

  it('remembers a dismissal by job and start time, since job ids restart with the Host', () => {
    expect(CleanupJobTrailModel.dismissKey(job())).toBe('cleanup-1@1000')
    expect(CleanupJobTrailModel.dismissKey(job({ startedAt: 2_000 }))).not.toBe(CleanupJobTrailModel.dismissKey(job()))
  })
})

describe('createCleanupJobsReader', () => {
  const signal = new AbortController().signal
  const owned = job({ id: 'cleanup-2', repoRoot: '/work/sample', request: { path: '/work/sample-threads/thread-aaaaaa', olderThanHours: 0, kinds: ['empty'] } })

  it('asks for the project of the panel path, which the Host traces from a thread workspace', async () => {
    const cleanupJobs = vi.fn<CleanupJobsClient['cleanupJobs']>(async () => ({ repoRoot: '/work/sample', jobs: [owned] }))
    const read = createCleanupJobsReader()

    expect((await read({ cleanupJobs }, '/work/sample-threads/thread-aaaaaa', signal)).jobs).toEqual([owned])
    expect(cleanupJobs).toHaveBeenCalledWith({ path: '/work/sample-threads/thread-aaaaaa' }, { signal })
  })

  it('falls back to the whole trail once when the Host predates the project filter', async () => {
    class Refused extends Error {}
    const cleanupJobs = vi.fn<CleanupJobsClient['cleanupJobs']>(async input => {
      if (input.path !== undefined) throw new Refused('Unexpected key "path"')
      return { jobs: [job()] }
    })
    const read = createCleanupJobsReader({ isRefusal: error => error instanceof Refused })

    expect((await read({ cleanupJobs }, '/work/sample', signal)).jobs).toHaveLength(1)
    await read({ cleanupJobs }, '/work/sample', signal)

    expect(cleanupJobs.mock.calls.map(([input]) => input)).toEqual([{ path: '/work/sample' }, {}, {}])
  })

  it('reports any other failure and keeps asking for the project on the next poll', async () => {
    let calls = 0
    const cleanupJobs = vi.fn<CleanupJobsClient['cleanupJobs']>(async () => {
      calls += 1
      if (calls === 1) throw new Error('API handler failed. See Host diagnostics.')
      return { repoRoot: '/work/sample', jobs: [owned] }
    })
    const read = createCleanupJobsReader()

    await expect(read({ cleanupJobs }, '/work/sample', signal)).rejects.toThrow('API handler failed')
    expect((await read({ cleanupJobs }, '/work/sample', signal)).jobs).toEqual([owned])
    expect(cleanupJobs.mock.calls.map(([input]) => input)).toEqual([{ path: '/work/sample' }, { path: '/work/sample' }])
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

  it('does not broaden a selected cleanup when the Host lacks the background API', async () => {
    const api = client({
      startCleanup: vi.fn(async () => {
        throw new Error('Unknown API method jj-threads.startCleanup.')
      }),
    })
    const selectedRequest = { ...request, targets: [{ repoRoot: '/work/sample', name: 'thread-one', kind: 'empty' as const }] }

    await expect(requestWorkspaceCleanup(api, selectedRequest)).rejects.toThrow('This DSH Host cannot remove a selected subset.')
    expect(api.cleanupWorkspaces).not.toHaveBeenCalled()
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
