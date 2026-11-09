import type { Path } from 'effect'
import { CleanupJobModel, MAX_CLEANUP_ACTIVITY_DETAIL, type CleanupJobView } from './cleanup-jobs.js'

const MAX_LISTED_FAILURES = 5

export interface CleanupFailureReport {
  /** The project the failure belongs to; null only when the failed run had no single repository. */
  readonly repoRoot: string | null
  readonly summary: string
  readonly detail: string
}

type PathOps = Pick<Path.Path, 'relative' | 'sep' | 'isAbsolute'>

/** The part of a repository view ownership reads: its root and where its thread workspaces sit. */
interface RepositoryPaths {
  readonly repoRoot: string
  readonly threads: readonly { readonly path: string }[]
}

const within = (path: PathOps, parent: string, candidate: string): boolean => {
  const relative = path.relative(parent, candidate)
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))
}

/**
 * The repository that owns `target`: the repository itself or a folder inside it, or one of its thread workspaces
 * (which sit in a sibling `-threads` directory, so no path prefix ties them to the project). The deepest match wins,
 * so a repository nested in another is not credited to the outer one.
 */
const owner = (input: { readonly path: PathOps; readonly repositories: readonly RepositoryPaths[]; readonly target: string }): string | null => {
  let best: { readonly repoRoot: string; readonly depth: number } | null = null
  for (const repository of input.repositories) {
    const roots = [repository.repoRoot, ...repository.threads.map(thread => thread.path)]
    for (const root of roots) {
      if (!within(input.path, root, input.target)) continue
      if (best === null || root.length > best.depth) best = { repoRoot: repository.repoRoot, depth: root.length }
    }
  }
  return best?.repoRoot ?? null
}

/**
 * The project a recorded job already tied `target` to: the folder a job was asked from, or a workspace it tried to
 * remove. It keeps a thread workspace that cleanup half-removed (forgotten by jj, folder left behind) linked to its
 * project after no scan or `jj root` can place it any more.
 */
const ownerFromJobs = (input: { readonly path: PathOps; readonly jobs: readonly CleanupJobView[]; readonly target: string }): string | null => {
  for (const job of input.jobs) {
    if (job.repoRoot !== null && job.request.path !== null && within(input.path, job.request.path, input.target)) return job.repoRoot
    const rows = job.result === null ? [] : [...job.result.workspaces, ...job.result.untracked]
    const row = rows.find(candidate => within(input.path, candidate.path, input.target))
    if (row !== undefined) return row.repoRoot
  }
  return null
}

/** The one repository every target of a folder-less request (a settle) belongs to; null when they span several. */
const ownerOfTargets = (targets: readonly { readonly repoRoot: string }[]): string | null => {
  const roots = new Set(targets.map(target => target.repoRoot))
  return roots.size === 1 ? ([...roots][0] ?? null) : null
}

const plural = (count: number, noun: string): string => `${String(count)} ${noun}${count === 1 ? '' : 's'}`

/**
 * What a settled job reports to the activity timeline: one event when the whole job failed, else one per repository
 * whose workspaces or folders could not be removed. Each names its project and ends with the safe recovery.
 */
const failures = (job: CleanupJobView): readonly CleanupFailureReport[] => {
  const automatic = job.request.trigger === 'automatic'
  if (job.state === 'failed') {
    const error = job.error ?? 'The cleanup stopped without saying why.'
    const recovery = job.recovery ?? CleanupJobModel.recovery({ repoRoot: job.repoRoot, error })
    return [
      {
        repoRoot: job.repoRoot,
        summary: `${automatic ? 'Automatic thread-workspace cleanup' : 'Thread-workspace cleanup'} failed${CleanupJobModel.inProject(job.repoRoot)}`,
        detail: `${error} ${recovery ?? ''}`.trim().slice(0, MAX_CLEANUP_ACTIVITY_DETAIL),
      },
    ]
  }
  const result = job.result
  if (job.state !== 'done' || result === null) return []
  const repoRoots = [...new Set(CleanupJobModel.failedRows(result).map(row => row.repoRoot))]
  return repoRoots.map(repoRoot => {
    const own = {
      ...result,
      workspaces: result.workspaces.filter(row => row.repoRoot === repoRoot),
      untracked: result.untracked.filter(row => row.repoRoot === repoRoot),
    }
    const rows = CleanupJobModel.failedRows(own)
    const listed = rows.slice(0, MAX_LISTED_FAILURES).map(row => `${row.name}: ${row.message ?? 'no reason given'}`)
    const more = rows.length > MAX_LISTED_FAILURES ? [`…and ${String(rows.length - MAX_LISTED_FAILURES)} more.`] : []
    const recovery = CleanupJobModel.recovery({ repoRoot, result: own })
    return {
      repoRoot,
      summary: `${automatic ? 'Automatic cleanup could' : 'Cleanup could'} not remove ${plural(rows.length, 'workspace')}${CleanupJobModel.inProject(repoRoot)}`,
      detail: [...listed, ...more, recovery ?? ''].join('\n').trim().slice(0, MAX_CLEANUP_ACTIVITY_DETAIL),
    }
  })
}

/** Ties cleanup jobs and their failures to the project that owns them, wherever the cleanup was asked from. */
export class CleanupOwnership {
  static readonly owner = owner
  static readonly ownerFromJobs = ownerFromJobs
  static readonly ownerOfTargets = ownerOfTargets
  static readonly failures = failures
}
