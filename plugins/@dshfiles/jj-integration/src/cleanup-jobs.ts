import type { CleanupResult, CleanupTarget } from './api.js'
import type { CleanupKind } from './workspace-cleanup.js'

/**
 * `queued` is a job waiting behind the one that runs; `running` starts with the scan and ends with `done` or `failed`.
 * A Host restart drops the trail with the job: what a restart cannot resume is a removal already done.
 */
export type CleanupJobState = 'queued' | 'running' | 'done' | 'failed'

/** `scanning` decides what qualifies, `removing` deletes workspaces and untracked folders, `abandoning` clears empties. */
export type CleanupJobPhase = 'queued' | 'scanning' | 'removing' | 'abandoning' | 'done' | 'failed'

export type CleanupJobOutcome = 'removed' | 'kept' | 'failed'

/** `automatic` is the Host's own interval run; it queues behind and attaches to manual jobs exactly like a click. */
export type CleanupTrigger = 'manual' | 'automatic'

export type CleanupJobRequest =
  | {
      /** Any folder inside the repository; null cleans every registered jj repository. */
      readonly path: string | null
      readonly olderThanHours: number
      readonly kinds: CleanupKind[]
      readonly targets?: CleanupTarget[]
      readonly trigger: 'manual'
    }
  | {
      readonly path: string | null
      readonly olderThanHours: number
      readonly kinds: Exclude<CleanupKind, 'secondary'>[]
      readonly trigger: 'automatic'
    }

export interface CleanupJobProgress {
  /** Workspaces and untracked folders the scan decided to remove; empty revisions are counted only when done. */
  readonly total: number
  readonly processed: number
  readonly removed: number
  readonly kept: number
  readonly failed: number
  /** The workspace or folder being removed right now. */
  readonly current: string | null
}

export interface CleanupJobView {
  readonly id: string
  readonly state: CleanupJobState
  readonly phase: CleanupJobPhase
  readonly request: CleanupJobRequest
  readonly startedAt: number
  readonly finishedAt: number | null
  readonly progress: CleanupJobProgress
  readonly error: string | null
  readonly result: CleanupResult | null
}

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error)).slice(0, 400)

export const MAX_CLEANUP_JOBS = 12

/** Pure decisions about a removal request, kept off the trail so a test can state them without a clock. */
export class CleanupJobModel {
  /** A second click on the same scope attaches to the job already running instead of queuing the same removal twice. */
  static readonly sameRequest = (left: CleanupJobRequest, right: CleanupJobRequest): boolean =>
    left.path === right.path &&
    left.olderThanHours === right.olderThanHours &&
    [...left.kinds].sort().join() === [...right.kinds].sort().join() &&
    ('targets' in left ? (left.targets ?? []) : [])
      .map(target => JSON.stringify(target))
      .sort()
      .join() ===
      ('targets' in right ? (right.targets ?? []) : [])
        .map(target => JSON.stringify(target))
        .sort()
        .join()

  static readonly removedCount = (result: CleanupResult) => ({
    workspaces: result.workspaces.filter(workspace => workspace.outcome === 'removed').length,
    untracked: result.untracked.filter(entry => entry.outcome === 'removed').length,
  })

  /** Why the rest stayed, e.g. `Skipped 41: 29 activity-unknown, 12 has-work.`, so a run that removed nothing explains itself. */
  static readonly skippedSummary = (result: CleanupResult): string | undefined => {
    if (result.skipped.length === 0) return undefined
    const counts = new Map<string, number>()
    for (const row of result.skipped) counts.set(row.reason, (counts.get(row.reason) ?? 0) + 1)
    return `Skipped ${String(result.skipped.length)}: ${[...counts].map(([reason, count]) => `${String(count)} ${reason}`).join(', ')}.`
  }
}

const emptyProgress: CleanupJobProgress = { total: 0, processed: 0, removed: 0, kept: 0, failed: 0, current: null }

const isLive = (job: CleanupJobView): boolean => job.state === 'queued' || job.state === 'running'

const copyCleanupRequest = (request: CleanupJobRequest): CleanupJobRequest => {
  if (request.trigger === 'automatic') return { path: request.path, olderThanHours: request.olderThanHours, kinds: [...request.kinds], trigger: 'automatic' }

  const scope = { path: request.path, olderThanHours: request.olderThanHours, kinds: [...request.kinds], trigger: 'manual' as const }
  if (request.targets === undefined) return scope
  return { ...scope, targets: [...request.targets] }
}

/**
 * A bounded, newest-first trail of cleanup jobs. A scan keeps the total unknown until it finishes, so progress is
 * reported per item rather than as a percentage of a guess.
 */
export const createCleanupJobTrail = (options: { readonly now?: () => number; readonly limit?: number } = {}) => {
  const now = options.now ?? Date.now
  const limit = options.limit ?? MAX_CLEANUP_JOBS
  const jobs = new Map<string, CleanupJobView>()
  let sequence = 0

  const patch = (id: string, change: Partial<CleanupJobView>): CleanupJobView => {
    const current = jobs.get(id)
    if (current === undefined) throw new Error(`Cleanup job ${id} is no longer recorded.`)
    const next: CleanupJobView = { ...current, ...change }
    jobs.set(id, next)
    return next
  }

  const trim = (): void => {
    while (jobs.size > limit) {
      const finished = [...jobs.values()].find(job => !isLive(job))
      if (finished === undefined) return
      jobs.delete(finished.id)
    }
  }

  return {
    start(request: CleanupJobRequest): CleanupJobView {
      sequence += 1
      const job: CleanupJobView = {
        id: `cleanup-${String(sequence)}`,
        state: 'queued',
        phase: 'queued',
        request: copyCleanupRequest(request),
        startedAt: now(),
        finishedAt: null,
        progress: emptyProgress,
        error: null,
        result: null,
      }
      jobs.set(job.id, job)
      trim()
      return job
    },
    begin(id: string, phase: Extract<CleanupJobPhase, 'scanning' | 'removing' | 'abandoning'>): CleanupJobView {
      const job = jobs.get(id)
      return patch(id, { state: 'running', phase, progress: { ...(job?.progress ?? emptyProgress), current: null } })
    },
    /** The scan finished: its candidates are what the removal pass now walks through. */
    planned(id: string, total: number): CleanupJobView {
      return patch(id, { phase: 'removing', progress: { ...emptyProgress, total } })
    },
    current(id: string, name: string): CleanupJobView {
      const job = jobs.get(id)
      return patch(id, { progress: { ...(job?.progress ?? emptyProgress), current: name } })
    },
    settled(id: string, outcome: CleanupJobOutcome): CleanupJobView {
      const job = jobs.get(id)
      const progress = job?.progress ?? emptyProgress
      return patch(id, {
        progress: {
          ...progress,
          processed: progress.processed + 1,
          removed: progress.removed + (outcome === 'removed' ? 1 : 0),
          kept: progress.kept + (outcome === 'kept' ? 1 : 0),
          failed: progress.failed + (outcome === 'failed' ? 1 : 0),
          current: null,
        },
      })
    },
    done(id: string, result: CleanupResult): CleanupJobView {
      const job = jobs.get(id)
      const progress = job?.progress ?? emptyProgress
      return patch(id, {
        state: 'done',
        phase: 'done',
        finishedAt: now(),
        result,
        error: null,
        progress: { ...progress, processed: progress.total, current: null },
      })
    },
    failed(id: string, message: string): CleanupJobView {
      const job = jobs.get(id)
      return patch(id, {
        state: 'failed',
        phase: 'failed',
        finishedAt: now(),
        error: message.slice(0, 400),
        progress: { ...(job?.progress ?? emptyProgress), current: null },
      })
    },
    /** Newest first. Only the newest job carries its rows, so a one-second poll stays small. */
    trail(): readonly CleanupJobView[] {
      return [...jobs.values()].reverse().map((job, index) => (index === 0 ? job : { ...job, result: null }))
    },
    /** The job a new removal has to wait behind, if any. */
    live(): CleanupJobView | undefined {
      return [...jobs.values()].find(isLive)
    },
  }
}

export type CleanupJobTrail = ReturnType<typeof createCleanupJobTrail>

/** What an executing cleanup reports back while it runs; the job owns the queue, the executor owns the work. */
export interface CleanupItemReporter {
  beginPhase(phase: Extract<CleanupJobPhase, 'removing' | 'abandoning'>): void
  beginItem(name: string): void
  settleItem(outcome: CleanupJobOutcome): void
}

export interface CleanupJobReporter extends CleanupItemReporter {
  /** The scan finished: its candidates are what the removal pass now walks through. */
  planned(total: number): void
}

export interface CleanupJobRunner {
  start(request: CleanupJobRequest): { readonly job: CleanupJobView; readonly done: Promise<CleanupResult> }
  live(): CleanupJobView | undefined
  trail(): readonly CleanupJobView[]
}

/**
 * One removal at a time: each forgets jj workspaces and reads the Session activity the others are judged on. The promise
 * is the job, not the request that asked for it, so closing the panel never stops a removal; a request for a scope that
 * is already queued or running attaches to it instead of queuing the same removal twice.
 */
export const createCleanupJobRunner = (options: {
  readonly execute: (input: { readonly request: CleanupJobRequest; readonly report: CleanupJobReporter }) => Promise<CleanupResult>
  readonly now?: () => number
  readonly limit?: number
}): CleanupJobRunner => {
  const trail = createCleanupJobTrail(options)
  const results = new Map<string, Promise<CleanupResult>>()
  let queue: Promise<void> = Promise.resolve()

  return {
    start(request: CleanupJobRequest) {
      const live = trail.live()
      const liveDone = live === undefined ? undefined : results.get(live.id)
      if (live !== undefined && liveDone !== undefined && CleanupJobModel.sameRequest(live.request, request)) return { job: live, done: liveDone }
      const job = trail.start(request)
      const done = queue.then(async (): Promise<CleanupResult> => {
        trail.begin(job.id, 'scanning')
        try {
          const result = await options.execute({
            request: job.request,
            report: {
              planned: total => {
                trail.planned(job.id, total)
              },
              beginPhase: phase => {
                trail.begin(job.id, phase)
              },
              beginItem: name => {
                trail.current(job.id, name)
              },
              settleItem: outcome => {
                trail.settled(job.id, outcome)
              },
            },
          })
          trail.done(job.id, result)
          return result
        } catch (error) {
          trail.failed(job.id, errorText(error))
          throw error
        }
      })
      results.set(job.id, done)
      const settled = done.then(
        () => undefined,
        () => undefined,
      )
      void settled.then(() => results.delete(job.id))
      queue = settled
      return { job, done }
    },
    live: () => trail.live(),
    trail: () => trail.trail(),
  }
}
