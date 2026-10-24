import type { CleanupResult } from './api.js'
import type { CleanupJobRequest, CleanupJobRunner } from './cleanup-jobs.js'
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
export const AUTO_CLEANUP_FIRST_RUN_DELAY_MS = 5 * 60_000

const automaticKinds = (kinds: readonly CleanupKind[]): Exclude<CleanupKind, 'secondary'>[] =>
  [...new Set(kinds)].filter((kind): kind is Exclude<CleanupKind, 'secondary'> => kind !== 'secondary')

const request = (settings: AutoCleanupSettings, path: string | null): CleanupJobRequest => ({
  path,
  olderThanHours: settings.olderThanHours,
  kinds: automaticKinds(settings.kinds),
  trigger: 'automatic',
})

export class AutoCleanupModel {
  static readonly request = request
  static readonly intervalMs = (settings: AutoCleanupSettings): number => settings.intervalMinutes * 60_000
  /** `activeWithinHours` 0 means every registered repository; otherwise only the ones the caller names as recent. */
  static readonly coversEveryRepository = (settings: AutoCleanupSettings): boolean => settings.activeWithinHours === 0
}

const scheduleTimeout = (run: () => void, delayMs: number): (() => void) => {
  const timer = setTimeout(run, delayMs)
  timer.unref()
  return () => clearTimeout(timer)
}

/**
 * Starts the shared cleanup job on the configured interval, never next to one already queued or running: a manual
 * click and the interval run go through the same runner, trail and qualifiers. Settings are read on every run, so a
 * changed interval or a disabled toggle applies from the next one.
 *
 * Automatic runs cover only the repositories `activeProjects` reports as recently used, one job per repository so an
 * idle project's trail stays out of the way; `activeWithinHours` 0 falls back to one job over every repository.
 */
export const createAutoCleanupScheduler = (options: {
  readonly runner: Pick<CleanupJobRunner, 'start' | 'live'>
  readonly settings: () => AutoCleanupSettings
  readonly report: (outcome: AutoCleanupOutcome) => void
  /** Repository roots whose checkout or thread workspaces changed within the given hours. */
  readonly activeProjects: (withinHours: number) => Promise<readonly string[]>
  /** Every registered repository root, so an inactive one can be counted rather than silently dropped. */
  readonly knownProjects?: () => Promise<readonly string[]>
  readonly firstRunDelayMs?: number
  readonly schedule?: (run: () => void, delayMs: number) => () => void
  /** A run fires from a timer, so a failure has nobody to reject to; it is reported here instead of crashing the Host. */
  readonly onError?: (error: unknown) => void
}) => {
  const schedule = options.schedule ?? scheduleTimeout
  let cancel: (() => void) | undefined
  let disposed = false

  const runOnce = async (): Promise<AutoCleanupOutcome> => {
    const settings = options.settings()
    if (!settings.enabled || settings.kinds.length === 0) return { status: 'disabled' }
    const live = options.runner.live()
    if (live !== undefined) return { status: 'busy', jobId: live.id }
    const everyRepository = AutoCleanupModel.coversEveryRepository(settings)
    const targets = everyRepository ? [null] : await options.activeProjects(settings.activeWithinHours)
    if (targets.length === 0) return { status: 'idle', activeWithinHours: settings.activeWithinHours }
    const known = everyRepository ? targets.length : ((await options.knownProjects?.()) ?? targets).length
    const runs: AutoCleanupRun[] = []
    for (const path of targets) {
      // A manual run started while this loop goes re-queues the rest instead of racing it.
      const queued = options.runner.live()
      if (queued !== undefined) return { status: 'busy', jobId: queued.id }
      const started = options.runner.start(request(settings, path))
      try {
        runs.push({ jobId: started.job.id, path: path ?? '', result: await started.done })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return { status: 'failed', jobId: started.job.id, message: message.slice(0, 400) }
      }
    }
    return { status: 'done', runs, inactive: Math.max(0, known - targets.length) }
  }

  const arm = (delayMs: number): void => {
    if (disposed) return
    cancel = schedule(() => {
      void runOnce()
        .then(outcome => {
          if (!disposed) options.report(outcome)
        })
        .finally(() => arm(AutoCleanupModel.intervalMs(options.settings())))
        .catch((error: unknown) => options.onError?.(error))
    }, delayMs)
  }

  arm(options.firstRunDelayMs ?? AUTO_CLEANUP_FIRST_RUN_DELAY_MS)

  return {
    runOnce,
    dispose: (): void => {
      disposed = true
      cancel?.()
      cancel = undefined
    },
  }
}
