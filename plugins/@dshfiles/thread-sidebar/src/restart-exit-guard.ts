import { Duration, Effect } from 'effect'

/**
 * DSH's `appExit` disposes the plugin tree, then only sets `process.exitCode` and waits for the event loop to drain:
 * its 5 s force-exit timer is cleared as soon as disposal resolves. DSH 0.2.1-rc.2 resolves that disposal without
 * running every plugin's disposer (thread-sidebar's own Effect scope stays open, measured on a scratch Host), so one
 * leftover timer or socket keeps a Host that already closed its web server alive forever: the page shows
 * "Reconnecting", the supervisor waits on an exit that never comes, and nothing is logged.
 *
 * The guard is forked right after a managed restart calls `appExit`, as a detached fiber: plugin disposal (when DSH
 * runs it) does not interrupt it. After the grace it logs what still holds the process and exits with the restart
 * code, which the supervisor accepts because the request file it named was already written. Its sleep keeps the
 * event loop alive, so a Host that would have exited on its own still exits with that code, at most the grace later.
 */
export const RESTART_EXIT_GRACE = Duration.seconds(10)

export interface RestartExitGuardOptions {
  readonly code: number
  readonly grace?: Duration.Duration
  readonly exit?: (code: number) => void
  readonly write?: (line: string) => void
  readonly activeResources?: () => ReadonlyArray<string>
}

export const restartExitGuard = (options: RestartExitGuardOptions): Effect.Effect<void> => {
  const grace = options.grace ?? RESTART_EXIT_GRACE
  const write = options.write ?? (line => void process.stderr.write(`${line}\n`))
  const exit = options.exit ?? (code => process.exit(code))
  const activeResources = options.activeResources ?? (() => process.getActiveResourcesInfo())
  return Effect.asVoid(
    Effect.forkDetach(
      Effect.sleep(grace).pipe(
        Effect.andThen(
          Effect.sync(() => {
            const held = [...new Set(activeResources())].join(', ') || 'none reported'
            write(
              `[thread-sidebar] restart: DSH was still running ${String(Duration.toSeconds(grace))} s after it was asked to exit (still open: ${held}); forcing exit ${String(options.code)} so the supervisor starts the new Host.`,
            )
            exit(options.code)
          }),
        ),
      ),
    ),
  )
}
