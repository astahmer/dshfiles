import { Effect, Ref } from 'effect'
import { CleanupJobModel, MAX_CLEANUP_ACTIVITY_DETAIL } from './cleanup-jobs.js'
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

const keyOf = (kind: MaintenanceFailureKind, path: string): string => `${kind}\u0000${path}`

/** Words a POSIX shell reads as-is; any other goes in single quotes, where a single quote closes, escapes and reopens. */
const POSIX_PLAIN_WORD = /^[\w@%+=:,./-]+$/u

const quoteArgument = (word: string, platform: NodeJS.Platform): string => {
  // Windows paths cannot hold a double quote, so wrapping one in double quotes is enough for cmd and PowerShell.
  if (platform === 'win32') return /[\s&()^%!;,]/u.test(word) ? `"${word}"` : word
  return POSIX_PLAIN_WORD.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`
}

/** The exact command a recovery prints: each word quoted for the Host's shell, so a path with a space still runs. */
const commandLine = (words: readonly string[], platform: NodeJS.Platform = process.platform): string =>
  words.map(word => quoteArgument(word, platform)).join(' ')

/** What one failure says in the activity timeline: what stayed, why, and the safe next step. */
const report = (failure: MaintenanceFailure) => {
  if (failure.kind === 'finished-thread')
    return {
      summary: `Could not remove finished thread workspace ${failure.name}${CleanupJobModel.inProject(failure.repoRoot)}`,
      detail: [
        failure.reason,
        `Its folder and work are kept: removal never forces unlanded work. Fix what blocked it (${CleanupJobModel.blockedRemovalHint}), then remove it from its row in ${CleanupJobModel.panelOf(failure.repoRoot)} or run Clean up thread workspaces\u2026 there. The sweep also retries every 10 minutes.`,
      ]
        .join('\n')
        .slice(0, MAX_CLEANUP_ACTIVITY_DETAIL),
    }
  return {
    summary: `Could not clear the dependencies of archived thread ${failure.name}${CleanupJobModel.inProject(failure.repoRoot)}`,
    detail: [
      failure.reason,
      `The thread's folder and unlanded work are kept; only its node_modules stayed in ${failure.path}. Once nothing holds a file there, ${failure.command === undefined ? 'delete that node_modules folder' : `run ${failure.command}`}; setup reinstalls it if the thread is reopened. The sweep also retries every 10 minutes.`,
    ]
      .join('\n')
      .slice(0, MAX_CLEANUP_ACTIVITY_DETAIL),
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
  static readonly commandLine = commandLine
}
