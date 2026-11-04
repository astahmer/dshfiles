import { randomUUID } from 'node:crypto'
import { Clock, Context, Effect, FiberHandle, FileSystem, Layer, Option, Path, Ref } from 'effect'
import { restartExitGuard } from './restart-exit-guard.js'
import { RecoveryStore } from './restart-recovery.js'
import { RestartRecordFailed, RestartRequestFailed, RestartUnavailable } from './sidebar-errors.js'
import { SidebarHost } from './sidebar-host-promise.js'

const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const LAUNCH_URL_PATTERN = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):\d+\/\?token=\S+$/u
const EXIT_DELAY = '1 second'
const RESTART_EXIT_CODE = 75

/** The supervisor hand-off this process was started with: `DSH_HOME`, `DSH_RESTART_RUN_ID`, `DSH_RESTART_REQUEST_PATH`. */
export interface RestartEnvironment {
  readonly DSH_HOME?: string | undefined
  readonly DSH_RESTART_RUN_ID?: string | undefined
  readonly DSH_RESTART_REQUEST_PATH?: string | undefined
}

/**
 * The managed restart: the dsh-web supervisor restarts DSH when this process exits with code 75 after writing the
 * request file it named. Running threads are recorded first, so they resume after the boot.
 */
export class RestartControl extends Context.Service<
  RestartControl,
  {
    readonly available: boolean
    /**
     * Identifies this Host process: the supervisor's run id under the managed launcher, a random id otherwise. A page
     * that asked for a restart polls it to tell the new Host from the old one.
     */
    readonly run: string
    readonly request: Effect.Effect<{ readonly accepted: true }, RestartUnavailable | RestartRequestFailed>
    /** The tokenized launch URL the supervisor recorded, when it is a loopback URL. */
    readonly launchUrl: Effect.Effect<string | null>
  }
>()('@dshfiles/thread-sidebar/RestartControl') {
  static readonly layerWith = (input: {
    readonly env: RestartEnvironment
    readonly homeDirectory: string
    /** Armed right after `appExit`; forces the exit DSH may never finish on its own (see restart-exit-guard.ts). */
    readonly armExitGuard?: (code: number) => Effect.Effect<void>
  }) =>
    Layer.effect(
      RestartControl,
      Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        const host = yield* SidebarHost
        const recovery = yield* RecoveryStore
        const scope = yield* Effect.scope
        const env = input.env
        const dshHome = path.resolve(env.DSH_HOME?.trim() || path.join(input.homeDirectory, '.dsh'))
        const runId = env.DSH_RESTART_RUN_ID
        const expectedRequestPath =
          runId !== undefined && RUN_ID_PATTERN.test(runId) ? path.join(dshHome, 'runtime', `dsh-web-restart-${runId}.request`) : undefined
        const requestPath = env.DSH_RESTART_REQUEST_PATH
        const handOff =
          runId !== undefined &&
          expectedRequestPath !== undefined &&
          requestPath !== undefined &&
          path.isAbsolute(requestPath) &&
          path.resolve(requestPath) === expectedRequestPath
            ? Option.some({ runId, requestPath: expectedRequestPath })
            : Option.none()
        const appExit = host.appExit
        const available = Option.isSome(handOff) && Option.isSome(appExit)
        const run = Option.match(handOff, { onNone: () => randomUUID(), onSome: request => request.runId })
        const armExitGuard = input.armExitGuard ?? (code => restartExitGuard({ code }))

        const recordRunning = Effect.gen(function* () {
          yield* host.flushPersistence
          const sessionIds = yield* host.runningSessionIds
          yield* recovery.record({ sessionIds, reason: 'restart' })
          yield* Effect.annotateCurrentSpan('dshx.restart.recorded_sessions', sessionIds.length)
          return sessionIds.length
        }).pipe(Effect.mapError(cause => new RestartRecordFailed({ cause })))

        const exitLater = (request: { readonly requestPath: string }, exit: (code: number) => void) =>
          Effect.sleep(EXIT_DELAY).pipe(
            Effect.andThen(recordRunning),
            Effect.tap(recorded =>
              Effect.logInfo(
                `thread-sidebar: restart: recorded ${String(recorded)} running thread(s) to resume; asking DSH to exit with code ${String(RESTART_EXIT_CODE)} for the supervisor`,
              ),
            ),
            Effect.andThen(Effect.sync(() => exit(RESTART_EXIT_CODE))),
            Effect.andThen(armExitGuard(RESTART_EXIT_CODE)),
            Effect.catch(error =>
              fs
                .remove(request.requestPath, { force: true })
                .pipe(
                  Effect.ignore,
                  Effect.andThen(
                    Effect.logError('thread-sidebar: restart canceled: running threads could not be recorded, so DSH keeps running. Retry Restart DSH.', error),
                  ),
                ),
            ),
            Effect.withSpan('restart exit'),
          )

        return RestartControl.of({
          available,
          run,
          request: Effect.gen(function* () {
            if (Option.isNone(handOff) || Option.isNone(appExit)) return yield* new RestartUnavailable()
            const request = handOff.value
            yield* fs
              .makeDirectory(path.join(dshHome, 'runtime'), { recursive: true, mode: 0o700 })
              .pipe(Effect.mapError(cause => new RestartRequestFailed({ cause })))
            yield* fs.writeFileString(request.requestPath, request.runId, { flag: 'wx', mode: 0o600 }).pipe(
              Effect.tapError(error =>
                error.reason._tag === 'AlreadyExists' ? Effect.void : fs.remove(request.requestPath, { force: true }).pipe(Effect.ignore),
              ),
              Effect.mapError(cause => new RestartRequestFailed({ cause })),
            )
            yield* Effect.logInfo(`thread-sidebar: restart: request ${request.runId} written for the supervisor; DSH exits in ${EXIT_DELAY}`)
            yield* Effect.forkIn(exitLater(request, appExit.value), scope)
            return { accepted: true as const }
          }).pipe(Effect.withSpan('restart request')),
          launchUrl: fs.readFileString(path.join(dshHome, 'runtime', 'web-url')).pipe(
            Effect.map(recorded => recorded.trim()),
            Effect.map(recorded => (LAUNCH_URL_PATTERN.test(recorded) ? recorded : null)),
            Effect.orElseSucceed(() => null),
          ),
        })
      }),
    )
}

/** How often a pending restart looks for running turns, and how long it waits before restarting anyway. */
const DRAIN_POLL = '2 seconds'
const DRAIN_LIMIT = '30 minutes'

/**
 * One restart waiting for this Host to go idle. It restarts after two polls in a row find no running turn, so a
 * queued follow-up that starts right after a turn ends is not cut off; past the limit it restarts anyway, and the
 * managed restart records whatever still runs so it resumes after boot.
 */
export class RestartDrain extends Context.Service<
  RestartDrain,
  {
    readonly pending: Effect.Effect<{ readonly since: number; readonly running: number } | null>
    readonly request: Effect.Effect<{ readonly accepted: true }, RestartUnavailable>
    readonly cancel: Effect.Effect<{ readonly canceled: boolean }>
  }
>()('@dshfiles/thread-sidebar/RestartDrain') {
  static readonly layer = Layer.effect(
    RestartDrain,
    Effect.gen(function* () {
      const control = yield* RestartControl
      const host = yield* SidebarHost
      const handle = yield* FiberHandle.make<void>()
      const since = yield* Ref.make(Option.none<number>())
      const running = Effect.map(host.runningSessionIds, ids => ids.length)

      const idleTwice = Effect.gen(function* () {
        const idlePolls = yield* Ref.make(0)
        yield* Effect.sleep(DRAIN_POLL).pipe(
          Effect.andThen(running),
          Effect.flatMap(count => Ref.updateAndGet(idlePolls, polls => (count === 0 ? polls + 1 : 0))),
          Effect.repeat({ until: polls => polls >= 2 }),
        )
      })

      const drainThenRestart = idleTwice.pipe(
        Effect.timeoutOption(DRAIN_LIMIT),
        Effect.tap(idle =>
          Effect.logInfo(
            Option.isSome(idle)
              ? 'thread-sidebar: restart when idle: no turn is running; restarting DSH'
              : `thread-sidebar: restart when idle: turns still running after ${DRAIN_LIMIT}; restarting DSH anyway, they resume after the restart`,
          ),
        ),
        Effect.andThen(Ref.set(since, Option.none())),
        Effect.andThen(control.request),
        Effect.catch(error => Effect.logWarning('thread-sidebar: the restart waiting for idle could not start', error)),
        Effect.onInterrupt(() => Ref.set(since, Option.none())),
        Effect.withSpan('restart drain'),
      )

      return RestartDrain.of({
        pending: Effect.gen(function* () {
          const started = yield* Ref.get(since)
          if (Option.isNone(started)) return null
          return { since: started.value, running: yield* running }
        }),
        request: Effect.gen(function* () {
          if (!control.available) return yield* new RestartUnavailable()
          if (Option.isSome(yield* Ref.get(since))) return { accepted: true as const }
          yield* Ref.set(since, Option.some(yield* Clock.currentTimeMillis))
          yield* FiberHandle.run(handle, drainThenRestart, { onlyIfMissing: true })
          return { accepted: true as const }
        }).pipe(Effect.withSpan('restart drain request')),
        cancel: Effect.gen(function* () {
          if (Option.isNone(yield* Ref.get(since))) return { canceled: false }
          yield* FiberHandle.clear(handle)
          yield* Ref.set(since, Option.none())
          return { canceled: true }
        }),
      })
    }),
  )
}
