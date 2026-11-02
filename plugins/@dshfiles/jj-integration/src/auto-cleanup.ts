import { Cause, Duration, Effect } from 'effect'
import type { CleanupResult } from './api.js'
import type { CleanupJobRequest, CleanupJobView } from './cleanup-jobs.js'
import type { StartedCleanup } from './cleanup-runner.js'
import type { JjIntegrationSettings } from './settings.js'
import type { CleanupKind } from './workspace-cleanup.js'

type AutoCleanupSettings = JjIntegrationSettings['autoCleanup']

export interface AutoCleanupRun {
  readonly jobId: string
  readonly path: string
  readonly result: CleanupResult
}

export type AutoCleanupOutcome =
  | { readonly status: 'disabled' }
  | { readonly status: 'busy'; readonly jobId: string }
  | { readonly status: 'idle'; readonly activeWithinHours: number }
  | { readonly status: 'done'; readonly runs: readonly AutoCleanupRun[]; readonly inactive: number }
  | { readonly status: 'failed'; readonly jobId: string; readonly message: string }

/** Long enough for boot, the first repository scan and Session activity to settle before anything is judged idle. */
export const AUTO_CLEANUP_FIRST_RUN_DELAY = Duration.minutes(5)

const automaticKinds = (kinds: readonly CleanupKind[]): Exclude<CleanupKind, 'secondary'>[] =>
  [...new Set(kinds)].filter((kind): kind is Exclude<CleanupKind, 'secondary'> => kind !== 'secondary')

const request = (settings: AutoCleanupSettings, path: string | null): CleanupJobRequest => ({
  path,
  olderThanHours: settings.olderThanHours,
  kinds: automaticKinds(settings.kinds),
  trigger: 'automatic',
})

interface AutoCleanupRunner<E> {
  readonly start: (request: CleanupJobRequest) => Effect.Effect<StartedCleanup<E>>
  readonly live: Effect.Effect<CleanupJobView | undefined>
}

const failureMessage = (cause: Cause.Cause<unknown>): string => {
  const error = Cause.squash(cause)
  return (error instanceof Error ? error.message : String(error)).slice(0, 400)
}

/**
 * Starts the shared cleanup job, never next to one already queued or running: a manual click and the interval run go
 * through the same runner, trail and qualifiers. Automatic runs cover only the repositories `activeProjects` reports as
 * recently used, one job per repository so an idle project's trail stays out of the way; `activeWithinHours` 0 falls
 * back to one job over every repository.
 */
const runOnce = Effect.fn('jj-integration auto cleanup')(function* <RunnerError, ScanError, R>(input: {
  readonly settings: AutoCleanupSettings
  readonly runner: AutoCleanupRunner<RunnerError>
  /** Repository roots whose checkout or thread workspaces changed within the given hours. */
  readonly activeProjects: (withinHours: number) => Effect.Effect<readonly string[], ScanError, R>
  /** Every registered repository root, so an inactive one can be counted rather than silently dropped. */
  readonly knownProjects?: Effect.Effect<readonly string[], ScanError, R> | undefined
}) {
  const settings = input.settings
  if (!settings.enabled || settings.kinds.length === 0) return { status: 'disabled' } satisfies AutoCleanupOutcome
  const live = yield* input.runner.live
  if (live !== undefined) return { status: 'busy', jobId: live.id } satisfies AutoCleanupOutcome
  const everyRepository = AutoCleanupModel.coversEveryRepository(settings)
  const targets = everyRepository ? [null] : yield* input.activeProjects(settings.activeWithinHours)
  if (targets.length === 0) return { status: 'idle', activeWithinHours: settings.activeWithinHours } satisfies AutoCleanupOutcome
  const known = everyRepository ? targets.length : (input.knownProjects === undefined ? targets : yield* input.knownProjects).length
  const runs: AutoCleanupRun[] = []
  // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- jobs are serial by design, and a manual run started meanwhile must stop the rest.
  for (const path of targets) {
    // A manual run started while this loop goes re-queues the rest instead of racing it.
    const queued = yield* input.runner.live
    if (queued !== undefined) return { status: 'busy', jobId: queued.id } satisfies AutoCleanupOutcome
    const started = yield* input.runner.start(request(settings, path))
    const outcome = yield* Effect.exit(started.done)
    if (outcome._tag === 'Failure') return { status: 'failed', jobId: started.job.id, message: failureMessage(outcome.cause) } satisfies AutoCleanupOutcome
    runs.push({ jobId: started.job.id, path: path ?? '', result: outcome.value })
  }
  return { status: 'done', runs, inactive: Math.max(0, known - targets.length) } satisfies AutoCleanupOutcome
})

/**
 * Runs `run` after a first delay, then again every `intervalMinutes`, read after each run so a changed interval or a
 * disabled toggle applies from the next one. A failed run is logged and the loop keeps going.
 */
const schedule = <A, E, R>(input: {
  readonly run: Effect.Effect<A, E, R>
  readonly intervalMinutes: Effect.Effect<number>
  readonly firstRunDelay: Duration.Input
}): Effect.Effect<never, never, R> =>
  Effect.andThen(
    Effect.sleep(input.firstRunDelay),
    Effect.forever(
      input.run.pipe(
        Effect.catchCause(cause => Effect.logWarning('jj-integration: scheduled run failed', cause)),
        Effect.andThen(Effect.flatMap(input.intervalMinutes, minutes => Effect.sleep(Duration.minutes(minutes)))),
      ),
    ),
  )

export class AutoCleanupModel {
  static readonly request = request
  static readonly runOnce = runOnce
  static readonly schedule = schedule
  /** `activeWithinHours` 0 means every registered repository; otherwise only the ones the caller names as recent. */
  static readonly coversEveryRepository = (settings: AutoCleanupSettings): boolean => settings.activeWithinHours === 0
}
