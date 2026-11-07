import { Effect, Ref } from 'effect'
import { CleanupJobModel } from './cleanup-jobs.js'
import { ActivityLog } from './host-edges-promise.js'

/**
 * The background removals outside the cleanup job runner: the finished-thread sweep (`removeFinishedThreads`) and the
 * archived-thread dependency cleanup. Both retry every sweep, so a failure is reported once per workspace and reason.
 */
export type MaintenanceFailureKind = 'finished-thread' | 'kept-thread'

export interface MaintenanceFailure {
  readonly kind: MaintenanceFailureKind
  /** The project that owns the thread workspace; the timeline links the failure there. */
  readonly repoRoot: string
  readonly name: string
  readonly path: string
  readonly reason: string
  /** The exact command that retries the removal by hand, when there is one. */
  readonly command?: string | undefined
}

const MAX_DETAIL = 2000

const keyOf = (kind: MaintenanceFailureKind, path: string): string => `${kind}\u0000${path}`

const inProject = (repoRoot: string): string => {
  const name = CleanupJobModel.projectName(repoRoot)
  return name === null ? '' : ` in ${name}`
}

const panel = (repoRoot: string): string => {
  const name = CleanupJobModel.projectName(repoRoot)
  return name === null ? 'the project\u2019s Jujutsu panel' : `the ${name} Jujutsu panel`
}

/** What one failure says in the activity timeline: what stayed, why, and the safe next step. */
const report = (failure: MaintenanceFailure) => {
  if (failure.kind === 'finished-thread')
    return {
      summary: `Could not remove finished thread workspace ${failure.name}${inProject(failure.repoRoot)}`,
      detail: [
        failure.reason,
        `Its folder and work are kept: removal never forces unlanded work. Fix what blocked it (often a permission, or a process still holding one of its files), then remove it from its row in ${panel(failure.repoRoot)} or run Clean up thread workspaces\u2026 there. The sweep also retries every 10 minutes.`,
      ]
        .join('\n')
        .slice(0, MAX_DETAIL),
    }
  return {
    summary: `Could not clear the dependencies of archived thread ${failure.name}${inProject(failure.repoRoot)}`,
    detail: [
      failure.reason,
      `The thread's folder and unlanded work are kept; only its node_modules stayed in ${failure.path}. Once nothing holds a file there, ${failure.command === undefined ? 'delete that node_modules folder' : `run ${failure.command}`}; setup reinstalls it if the thread is reopened. The sweep also retries every 10 minutes.`,
    ]
      .join('\n')
      .slice(0, MAX_DETAIL),
  }
}

const make = Effect.gen(function* () {
  const log = yield* ActivityLog
  /** The reason last reported per workspace, so a sweep that fails the same way again stays quiet. */
  const reported = yield* Ref.make<ReadonlyMap<string, string>>(new Map())

  const failed = Effect.fn('maintenance failure report')(function* (failure: MaintenanceFailure) {
    const key = keyOf(failure.kind, failure.path)
    const isNew = yield* Ref.modify(reported, current =>
      current.get(key) === failure.reason ? [false, current] : [true, new Map([...current, [key, failure.reason] as const])],
    )
    yield* Effect.annotateCurrentSpan({ 'dshx.maintenance.kind': failure.kind, 'dshx.maintenance.reported': isNew })
    if (!isNew) return
    const { summary, detail } = report(failure)
    yield* log.emit({ type: 'workspace.cleanup-failed', summary, detail, path: failure.repoRoot, level: 'attention' })
  })

  /** The removal went through (or had nothing left to do): a later failure of the same workspace is news again. */
  const cleared = (kind: MaintenanceFailureKind, path: string) =>
    Ref.update(reported, current => {
      const key = keyOf(kind, path)
      if (!current.has(key)) return current
      const next = new Map(current)
      next.delete(key)
      return next
    })

  return { failed, cleared }
})

/**
 * Reports the failures of the background removals on the project that owns the workspace, once per reason. Built by
 * the maintenance layer, its only user, so it needs no service of its own.
 */
export class MaintenanceFailures {
  static readonly make = make
  static readonly report = report
}
