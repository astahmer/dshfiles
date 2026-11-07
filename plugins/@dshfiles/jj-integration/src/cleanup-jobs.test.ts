import { describe, expect, it } from 'vitest'
import { CleanupJobModel, createCleanupJobTrail, MAX_CLEANUP_JOBS, type CleanupJobRequest } from './cleanup-jobs.js'
import type { CleanupResult } from './api.js'

const request: CleanupJobRequest = { path: '/work/sample', olderThanHours: 6, kinds: ['empty', 'integrated'], trigger: 'manual' }

const result = (input: { readonly workspaces: number; readonly untracked?: number; readonly revisions?: number }): CleanupResult => ({
  applied: true,
  workspaces: Array.from({ length: input.workspaces }, (_unused, index) => ({
    repoRoot: '/work/sample',
    name: `thread-${String(index).padStart(6, '0')}`,
    path: `/work/sample-threads/thread-${String(index).padStart(6, '0')}`,
    kind: 'empty' as const,
    lastUsedAt: 1,
    missing: false,
    outcome: 'removed' as const,
  })),
  skipped: [],
  untracked: Array.from({ length: input.untracked ?? 0 }, (_unused, index) => ({
    repoRoot: '/work/sample',
    name: `stray-${String(index)}.log`,
    path: `/work/sample-threads/stray-${String(index)}.log`,
    modifiedAt: 1,
    outcome: 'removed' as const,
  })),
  emptyRevisions: Array.from({ length: input.revisions ?? 0 }, () => ({ changeId: 'c', commitId: 'a'.repeat(40), description: '', conflict: false })),
})

const clock = () => {
  let at = 1_000
  return {
    now: () => at,
    advance: (ms: number): void => {
      at += ms
    },
  }
}

describe('createCleanupJobTrail', () => {
  it('starts queued with no progress until the scan reports its candidates', () => {
    const time = clock()
    const trail = createCleanupJobTrail({ now: time.now })

    const job = trail.start(request)

    expect(job.state).toBe('queued')
    expect(job.phase).toBe('queued')
    expect(job.progress).toEqual({ total: 0, processed: 0, removed: 0, kept: 0, failed: 0, current: null })
    expect(trail.live()?.id).toBe(job.id)
  })

  it('counts each removed, kept and failed item while naming the one in flight', () => {
    const time = clock()
    const trail = createCleanupJobTrail({ now: time.now })
    const job = trail.start(request)

    trail.begin(job.id, 'scanning')
    trail.planned(job.id, 3)
    trail.current(job.id, 'thread-aaaaaa')
    trail.settled(job.id, 'removed')
    trail.current(job.id, 'thread-bbbbbb')
    trail.settled(job.id, 'kept')
    trail.current(job.id, 'thread-cccccc')
    trail.settled(job.id, 'failed')

    const [view] = trail.trail()
    expect(view?.state).toBe('running')
    expect(view?.phase).toBe('removing')
    expect(view?.progress).toEqual({ total: 3, processed: 3, removed: 1, kept: 1, failed: 1, current: null })
  })

  it('settles a done job with its result and the scan total it processed', () => {
    const time = clock()
    const trail = createCleanupJobTrail({ now: time.now })
    const job = trail.start(request)
    trail.begin(job.id, 'scanning')
    trail.planned(job.id, 2)
    trail.settled(job.id, 'removed')
    trail.settled(job.id, 'removed')
    time.advance(5_000)

    const view = trail.done(job.id, result({ workspaces: 2, untracked: 1, revisions: 4 }))

    expect(time.now()).toBe(6_000)
    expect(view.state).toBe('done')
    expect(view.phase).toBe('done')
    expect(view.finishedAt).toBe(6_000)
    expect(view.error).toBeNull()
    expect(view.progress.processed).toBe(view.progress.total)
    expect(trail.live()).toBeUndefined()
  })

  it('keeps a failure message with the job instead of throwing away its progress', () => {
    const time = clock()
    const trail = createCleanupJobTrail({ now: time.now })
    const job = trail.start(request)
    trail.begin(job.id, 'scanning')

    const failed = trail.failed(job.id, 'jj workspace forget exited 1')

    expect(failed.state).toBe('failed')
    expect(failed.error).toBe('jj workspace forget exited 1')
    expect(failed.finishedAt).toBe(1_000)
  })

  it('lists the newest job first and drops the rows of older ones', () => {
    const time = clock()
    const trail = createCleanupJobTrail({ now: time.now })
    const older = trail.start(request)
    trail.done(older.id, result({ workspaces: 1 }))
    const newer = trail.start(request)

    const views = trail.trail()

    expect(views.map(view => view.id)).toEqual([newer.id, older.id])
    expect(views[0]?.result).toBeNull()
    expect(views[1]?.result).toBeNull()
    expect(trail.live()?.id).toBe(newer.id)
  })

  it('keeps the newest finished result readable once nothing runs', () => {
    const trail = createCleanupJobTrail({ now: clock().now })
    const job = trail.start(request)

    trail.done(job.id, result({ workspaces: 3 }))

    expect(trail.trail()[0]?.result?.workspaces).toHaveLength(3)
  })

  it('bounds the trail and never drops a job that still runs', () => {
    const trail = createCleanupJobTrail({ now: clock().now, limit: 2 })
    const first = trail.start(request)
    trail.done(first.id, result({ workspaces: 0 }))
    const second = trail.start(request)
    trail.done(second.id, result({ workspaces: 0 }))
    const third = trail.start(request)

    expect(trail.trail().map(view => view.id)).toEqual([third.id, second.id])
    expect(trail.trail()).toHaveLength(2)
    expect(MAX_CLEANUP_JOBS).toBeGreaterThan(2)
  })

  it('refuses to update a job it already dropped', () => {
    const trail = createCleanupJobTrail({ now: clock().now, limit: 1 })
    const first = trail.start(request)
    trail.done(first.id, result({ workspaces: 0 }))
    trail.start(request)

    expect(() => trail.begin(first.id, 'scanning')).toThrow(/no longer recorded/u)
  })
})

const failedRow = (repoRoot: string, name: string): CleanupResult['workspaces'][number] => ({
  repoRoot,
  name,
  path: `${repoRoot}-threads/${name}`,
  kind: 'integrated',
  lastUsedAt: 1,
  missing: false,
  outcome: 'failed',
  message: 'EACCES: permission denied, rmdir',
})

describe('cleanup jobs tied to their project', () => {
  it('records the owning repository at start, and the scan never replaces one already known', () => {
    const trail = createCleanupJobTrail({ now: clock().now })
    const known = trail.start({ ...request, path: '/work/sample-threads/thread-aaaaaa' }, '/work/sample')
    const traced = trail.start(request)

    expect(trail.scoped(known.id, '/elsewhere').repoRoot).toBe('/work/sample')
    expect(traced.repoRoot).toBeNull()
    expect(trail.scoped(traced.id, '/work/sample').repoRoot).toBe('/work/sample')
  })

  it('gives a failed job a recovery that names its project and never suggests forcing', () => {
    const trail = createCleanupJobTrail({ now: clock().now })
    const job = trail.start(request, '/work/sample')

    const failed = trail.failed(job.id, 'jj workspace forget exited 1')

    expect(failed.recovery).toContain('Clean up thread workspaces… again from the sample Jujutsu panel')
    expect(failed.recovery).toContain('never forces unlanded work')
    expect(failed.recovery).not.toMatch(/force: ?true|--force/u)
  })

  it('gives a done job a recovery only when a workspace it tried stayed in place', () => {
    const trail = createCleanupJobTrail({ now: clock().now })
    const clean = trail.done(trail.start(request, '/work/sample').id, result({ workspaces: 2 }))
    const partial = trail.done(trail.start(request, '/work/sample').id, {
      ...result({ workspaces: 1 }),
      workspaces: [failedRow('/work/sample', 'thread-bbbbbb'), failedRow('/work/sample', 'thread-cccccc')],
    })

    expect(clean.recovery).toBeNull()
    expect(partial.recovery).toContain('thread-bbbbbb and 1 more stayed in place')
    expect(partial.recovery).toContain('again from the sample Jujutsu panel')
    expect(partial.recovery).toContain('Untracked folders')
  })

  it('keeps the rows of each project’s newest job, so a run elsewhere does not hide this project’s failure', () => {
    const trail = createCleanupJobTrail({ now: clock().now })
    const sample = trail.done(trail.start(request, '/work/sample').id, { ...result({ workspaces: 0 }), workspaces: [failedRow('/work/sample', 'thread-a')] })
    const other = trail.done(trail.start({ ...request, path: '/work/other' }, '/work/other').id, result({ workspaces: 1 }))

    const views = trail.trail()

    expect(views.map(view => [view.id, view.result === null])).toEqual([
      [other.id, false],
      [sample.id, false],
    ])
    expect(views.filter(view => CleanupJobModel.belongsTo(view, '/work/sample')).map(view => view.id)).toEqual([sample.id])
  })

  it('shows a run over every repository in a project only while it runs, failed, or touched that project', () => {
    const trail = createCleanupJobTrail({ now: clock().now })
    const everywhere = { ...request, path: null }
    const running = trail.start(everywhere)
    expect(CleanupJobModel.belongsTo(running, '/work/sample')).toBe(true)
    const failed = trail.failed(running.id, 'Session list unreadable')
    expect(CleanupJobModel.belongsTo(failed, '/work/sample')).toBe(true)
    const elsewhere = trail.done(trail.start(everywhere).id, { ...result({ workspaces: 0 }), workspaces: [failedRow('/work/other', 'thread-a')] })
    expect(CleanupJobModel.belongsTo(elsewhere, '/work/sample')).toBe(false)
    expect(CleanupJobModel.belongsTo(elsewhere, '/work/other')).toBe(true)
  })

  it('never lets a run over every repository that named nothing of this project replace its last failure', () => {
    const trail = createCleanupJobTrail({ now: clock().now })
    const everywhere = { ...request, path: null }
    const failure = trail.done(trail.start(request, '/work/sample').id, { ...result({ workspaces: 0 }), workspaces: [failedRow('/work/sample', 'thread-a')] })
    const empty = trail.done(trail.start(everywhere).id, result({ workspaces: 0 }))
    const newer = trail.done(trail.start(everywhere).id, result({ workspaces: 0 }))
    const dropped = trail.trail().find(view => view.id === empty.id)

    expect(CleanupJobModel.belongsTo(newer, '/work/sample')).toBe(false)
    expect(dropped?.result).toBeNull()
    expect(dropped === undefined ? true : CleanupJobModel.belongsTo(dropped, '/work/sample')).toBe(false)
    expect(trail.trail().filter(view => CleanupJobModel.belongsTo(view, '/work/sample'))[0]?.id).toBe(failure.id)
  })
})

describe('CleanupJobModel.sameRequest', () => {
  it('matches the same scope regardless of kind order or trigger', () => {
    expect(CleanupJobModel.sameRequest(request, { path: '/work/sample', olderThanHours: 6, kinds: ['integrated', 'empty'], trigger: 'automatic' })).toBe(true)
  })

  it('summarizes why workspaces stayed, one count per reason', () => {
    const skipped = (reason: CleanupResult['skipped'][number]['reason'], name: string) => ({ repoRoot: '/work/sample', name, reason })
    const scan: CleanupResult = {
      ...result({ workspaces: 0 }),
      skipped: [skipped('activity-unknown', 'thread-a'), skipped('has-work', 'thread-b'), skipped('activity-unknown', 'thread-c')],
    }
    expect(CleanupJobModel.skippedSummary(scan)).toBe('Skipped 3: 2 activity-unknown, 1 has-work.')
    expect(CleanupJobModel.skippedSummary(result({ workspaces: 1 }))).toBeUndefined()
  })

  it('separates a different age, folder, kind set or selected targets', () => {
    expect(CleanupJobModel.sameRequest(request, { ...request, olderThanHours: 24 })).toBe(false)
    expect(CleanupJobModel.sameRequest(request, { ...request, path: null })).toBe(false)
    expect(CleanupJobModel.sameRequest(request, { ...request, kinds: ['empty'] })).toBe(false)
    const selected = { ...request, targets: [{ repoRoot: '/work/sample', name: 'thread-one', kind: 'empty' as const }] }
    expect(CleanupJobModel.sameRequest(selected, { ...selected, targets: [{ repoRoot: '/work/sample', name: 'thread-two', kind: 'empty' }] })).toBe(false)
    expect(CleanupJobModel.sameRequest(selected, { ...selected, targets: [...selected.targets].reverse() })).toBe(true)
  })
})

/** One executor call at a time, kept resolvable so a test can look at the trail mid-flight. */
