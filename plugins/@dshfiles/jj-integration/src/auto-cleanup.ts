import type { CleanupResult } from './api.js'
import type { CleanupJobRequest, CleanupJobRunner } from './cleanup-jobs.js'
import type { JjIntegrationSettings } from './settings.js'

type AutoCleanupSettings = JjIntegrationSettings['autoCleanup']

export type AutoCleanupOutcome =
  | { readonly status: 'disabled' }
  | { readonly status: 'busy'; readonly jobId: string }
  | { readonly status: 'done'; readonly jobId: string; readonly result: CleanupResult }
  | { readonly status: 'failed'; readonly jobId: string; readonly message: string }

/** Long enough for boot, the first repository scan and Session activity to settle before anything is judged idle. */
export const AUTO_CLEANUP_FIRST_RUN_DELAY_MS = 5 * 60_000

const request = (settings: AutoCleanupSettings): CleanupJobRequest | undefined => {
  if (!settings.enabled || settings.kinds.length === 0) return undefined
  return { path: null, olderThanHours: settings.olderThanHours, kinds: [...new Set(settings.kinds)], trigger: 'automatic' }
}

export class AutoCleanupModel {
  static readonly request = request
  static readonly intervalMs = (settings: AutoCleanupSettings): number => settings.intervalMinutes * 60_000
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
 */
export const createAutoCleanupScheduler = (options: {
  readonly runner: Pick<CleanupJobRunner, 'start' | 'live'>
  readonly settings: () => AutoCleanupSettings
  readonly report: (outcome: AutoCleanupOutcome) => void
  readonly firstRunDelayMs?: number
  readonly schedule?: (run: () => void, delayMs: number) => () => void
}) => {
  const schedule = options.schedule ?? scheduleTimeout
  let cancel: (() => void) | undefined
  let disposed = false

  const runOnce = async (): Promise<AutoCleanupOutcome> => {
    const next = request(options.settings())
    if (next === undefined) return { status: 'disabled' }
    const live = options.runner.live()
    if (live !== undefined) return { status: 'busy', jobId: live.id }
    const started = options.runner.start(next)
    try {
      return { status: 'done', jobId: started.job.id, result: await started.done }
    } catch (error) {
      return { status: 'failed', jobId: started.job.id, message: (error instanceof Error ? error.message : String(error)).slice(0, 400) }
    }
  }

  const arm = (delayMs: number): void => {
    if (disposed) return
    cancel = schedule(() => {
      void runOnce()
        .then(outcome => {
          if (!disposed) options.report(outcome)
        })
        .finally(() => arm(AutoCleanupModel.intervalMs(options.settings())))
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
