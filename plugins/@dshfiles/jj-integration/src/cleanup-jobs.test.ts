import { describe, expect, it } from 'vitest'
import { CleanupJobModel, createCleanupJobRunner, createCleanupJobTrail, MAX_CLEANUP_JOBS, type CleanupJobRequest } from './cleanup-jobs.js'
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
const controllableRunner = () => {
  const calls: { request: CleanupJobRequest; settle: (result: CleanupResult) => void; fail: (error: unknown) => void }[] = []
  const runner = createCleanupJobRunner({
    now: clock().now,
    execute: ({ request }) =>
      new Promise<CleanupResult>((resolve, reject) => {
        calls.push({ request, settle: resolve, fail: reject })
      }),
  })
  return { runner, calls }
}

const tick = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 0))
}

describe('createCleanupJobRunner', () => {
  it('runs one removal at a time and keeps the next job queued meanwhile', async () => {
    const { runner, calls } = controllableRunner()
    const first = runner.start(request)
    const second = runner.start({ ...request, olderThanHours: 24 })

    await tick()
    expect(calls).toHaveLength(1)
    expect(second.job.state).toBe('queued')
    expect(second.job.phase).toBe('queued')

    calls[0]?.settle(result({ workspaces: 1 }))
    await first.done
    await tick()
    expect(calls).toHaveLength(2)
    expect(runner.trail().map(view => view.state)).toEqual(['running', 'done'])
  })

  it('attaches to the job already running for the same scope instead of queuing it twice', async () => {
    const { runner, calls } = controllableRunner()
    const first = runner.start(request)

    const repeat = runner.start({ ...request, kinds: ['integrated', 'empty'] })

    await tick()
    expect(repeat.job.id).toBe(first.job.id)
    calls[0]?.settle(result({ workspaces: 0 }))
    await expect(repeat.done).resolves.toEqual(result({ workspaces: 0 }))
    expect(runner.trail()).toHaveLength(1)
  })

  it('records a failed job and rejects the promise it returned', async () => {
    const { runner, calls } = controllableRunner()
    const job = runner.start(request)

    await tick()
    calls[0]?.fail(new Error('jj workspace forget exited 1'))

    await expect(job.done).rejects.toThrow('jj workspace forget exited 1')
    expect(runner.trail()[0]).toMatchObject({ state: 'failed', phase: 'failed', error: 'jj workspace forget exited 1' })
  })

  it('keeps going after a failed job so a later removal still runs', async () => {
    const { runner, calls } = controllableRunner()
    const failed = runner.start(request)
    const next = runner.start({ ...request, olderThanHours: 12 })

    await tick()
    calls[0]?.fail(new Error('boom'))
    await expect(failed.done).rejects.toThrow('boom')
    await tick()
    expect(calls).toHaveLength(2)
    calls[1]?.settle(result({ workspaces: 2 }))
    await expect(next.done).resolves.toMatchObject({ applied: true })
  })

  it('reports the scan total and the item in flight on the job it owns', async () => {
    let release: (() => void) | undefined
    const runner = createCleanupJobRunner({
      now: clock().now,
      execute: async ({ report }) => {
        report.planned(3)
        report.beginPhase('removing')
        report.beginItem('thread-aaaaaa')
        await new Promise<void>(resolve => {
          release = resolve
        })
        report.settleItem('removed')
        return result({ workspaces: 1 })
      },
    })

    const { done } = runner.start(request)
    await tick()

    expect(runner.trail()[0]).toMatchObject({ state: 'running', phase: 'removing', progress: { total: 3, current: 'thread-aaaaaa' } })
    release?.()
    await done
    expect(runner.live()).toBeUndefined()
    expect(runner.trail()[0]).toMatchObject({ state: 'done', progress: { total: 3, removed: 1, current: null } })
  })
})
