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
      /** Set when a settle names the workspaces; the interval run scans every qualifying one. */
      readonly targets?: CleanupTarget[]
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
  /**
   * The repository that owns `request.path`, even when the cleanup was asked from one of its thread workspaces; null for
   * a run over every repository, or when the folder could not be traced to one.
   */
  readonly repoRoot: string | null
  readonly startedAt: number
  readonly finishedAt: number | null
  readonly progress: CleanupJobProgress
  readonly error: string | null
  readonly result: CleanupResult | null
  /** What the user can safely do next when the job failed or left a workspace it could not remove; null otherwise. */
  readonly recovery: string | null
}

export const MAX_CLEANUP_JOBS = 12

/** The API's limit on a cleanup row message, a job's current item and its error (`api.ts` checks these). */
export const MAX_CLEANUP_MESSAGE_LENGTH = 400
/** The API's limit on a job's recovery. */
export const MAX_CLEANUP_RECOVERY_LENGTH = 600
/** Activity events clamp their detail; reports keep the reasons first so the recovery still fits. */
export const MAX_CLEANUP_ACTIVITY_DETAIL = 2000

/** Why a removal usually fails, for every recovery that asks the user to fix it first. */
const BLOCKED_REMOVAL_HINT = 'often a permission, or a process still holding one of its files'

/** The project a recovery names: the last path segment, read with either separator so a Windows root works too. */
const projectName = (repoRoot: string | null): string | null => {
  if (repoRoot === null) return null
  const name = repoRoot
    .replace(/[\\/]+$/u, '')
    .split(/[\\/]/u)
    .at(-1)
  return name === undefined || name.length === 0 ? repoRoot : name
}

/** `the <project> Jujutsu panel`, where a recovery sends the user. */
const panelOf = (repoRoot: string | null): string => {
  const name = projectName(repoRoot)
  return name === null ? 'the project’s Jujutsu panel' : `the ${name} Jujutsu panel`
}

/** ` in <project>` for an activity summary, empty when no project is known. */
const inProject = (repoRoot: string | null): string => {
  const name = projectName(repoRoot)
  return name === null ? '' : ` in ${name}`
}

type FailedRow = { readonly repoRoot: string; readonly name: string; readonly path: string; readonly message?: string | undefined }

/** Rows a done job tried and could not remove, workspaces first. */
const failedRows = (result: CleanupResult): readonly FailedRow[] => [
  ...result.workspaces.filter(row => row.outcome === 'failed'),
  ...result.untracked.filter(row => row.outcome === 'failed'),
]

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

  static readonly failedRows = failedRows

  static readonly panelOf = panelOf

  static readonly inProject = inProject

  static readonly blockedRemovalHint = BLOCKED_REMOVAL_HINT

  /**
   * The safe next step after a failure. Cleanup never forces unlanded work, so every recovery is the same guarded
   * preview again, once the cause named by the error is fixed; nothing here suggests a forced removal.
   */
  static readonly recovery = (input: {
    readonly repoRoot: string | null
    readonly error?: string | null | undefined
    readonly result?: CleanupResult | null | undefined
  }): string | null => {
    const rerun = `run Clean up thread workspaces… again from ${panelOf(input.repoRoot)}: its preview rechecks every workspace and never forces unlanded work.`
    if (input.error !== undefined && input.error !== null)
      return `Nothing unlanded was removed. Fix what the error names, then ${rerun}`.slice(0, MAX_CLEANUP_RECOVERY_LENGTH)
    const rows = input.result === undefined || input.result === null ? [] : failedRows(input.result)
    const first = rows[0]
    if (first === undefined) return null
    const others = rows.length === 1 ? '' : ` and ${String(rows.length - 1)} more`
    return `${first.name}${others} stayed in place. Fix what blocked the removal (${BLOCKED_REMOVAL_HINT}), then ${rerun} A folder whose workspace was already forgotten is offered under Untracked folders.`.slice(
      0,
      MAX_CLEANUP_RECOVERY_LENGTH,
    )
  }

  /**
   * Whether a job belongs in the trail of the repository at `repoRoot`: its own jobs, and runs over every repository
   * that are still going, failed outright or visibly touched this repository. A finished run that names nothing of
   * this repository (no rows, or rows the trail already dropped) is not "a later cleanup of the project", so it never
   * replaces the project's last failure on its panel.
   */
  static readonly belongsTo = (job: CleanupJobView, repoRoot: string): boolean => {
    if (job.repoRoot !== null) return job.repoRoot === repoRoot
    if (job.state !== 'done') return true
    if (job.result === null) return false
    return [...job.result.workspaces, ...job.result.untracked, ...job.result.skipped].some(row => row.repoRoot === repoRoot)
  }
}

const emptyProgress: CleanupJobProgress = { total: 0, processed: 0, removed: 0, kept: 0, failed: 0, current: null }

const isLive = (job: CleanupJobView): boolean => job.state === 'queued' || job.state === 'running'

const copyCleanupRequest = (request: CleanupJobRequest): CleanupJobRequest => {
  if (request.trigger === 'automatic') {
    const automatic = { path: request.path, olderThanHours: request.olderThanHours, kinds: [...request.kinds], trigger: 'automatic' as const }
    return request.targets === undefined ? automatic : { ...automatic, targets: [...request.targets] }
  }

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
    start(request: CleanupJobRequest, repoRoot: string | null = null): CleanupJobView {
      sequence += 1
      const job: CleanupJobView = {
        id: `cleanup-${String(sequence)}`,
        state: 'queued',
        phase: 'queued',
        request: copyCleanupRequest(request),
        repoRoot,
        startedAt: now(),
        finishedAt: null,
        progress: emptyProgress,
        error: null,
        result: null,
        recovery: null,
      }
      jobs.set(job.id, job)
      trim()
      return job
    },
    begin(id: string, phase: Extract<CleanupJobPhase, 'scanning' | 'removing' | 'abandoning'>): CleanupJobView {
      const job = jobs.get(id)
      return patch(id, { state: 'running', phase, progress: { ...(job?.progress ?? emptyProgress), current: null } })
    },
    /** The scan traced the requested folder to its repository; a repository already known stays. */
    scoped(id: string, repoRoot: string): CleanupJobView {
      const job = jobs.get(id)
      return patch(id, { repoRoot: job?.repoRoot ?? repoRoot })
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
        recovery: CleanupJobModel.recovery({ repoRoot: job?.repoRoot ?? null, result }),
        progress: { ...progress, processed: progress.total, current: null },
      })
    },
    failed(id: string, message: string): CleanupJobView {
      const job = jobs.get(id)
      const error = message.slice(0, MAX_CLEANUP_MESSAGE_LENGTH)
      return patch(id, {
        state: 'failed',
        phase: 'failed',
        finishedAt: now(),
        error,
        recovery: CleanupJobModel.recovery({ repoRoot: job?.repoRoot ?? null, error }),
        progress: { ...(job?.progress ?? emptyProgress), current: null },
      })
    },
    /**
     * Newest first. Only the newest job of each repository carries its rows, so a one-second poll stays small and a
     * run in another project never hides the rows of this project's last cleanup.
     */
    trail(): readonly CleanupJobView[] {
      const withRows = new Set<string>()
      return [...jobs.values()].reverse().map(job => {
        const key = job.repoRoot ?? ''
        if (withRows.has(key)) return { ...job, result: null }
        withRows.add(key)
        return job
      })
    },
    /** The job a new removal has to wait behind, if any. */
    live(): CleanupJobView | undefined {
      return [...jobs.values()].find(isLive)
    },
  }
}

export type CleanupJobTrail = ReturnType<typeof createCleanupJobTrail>
