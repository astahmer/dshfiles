import { redactIdentifier } from '@dshfiles/dshx/tracing'
import { Context, Duration, Effect, Exit, Layer, Option, Ref, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { basename, isAbsolute } from 'node:path'
import { ProcessGroupStillRunning } from './errors.js'
import { Executables } from './host-promise.js'

type ProcessFailure = 'spawn-failed' | 'process-group-failed' | 'timed-out'

export interface ProcessResult {
  readonly exitCode: number | null
  readonly stdout: string
  readonly stderr: string
  readonly failure: ProcessFailure | null
}

export interface ProcessRequest {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly timeoutMs: number
}

const STOP_CONFIRM_TIMEOUT = Duration.seconds(10)
const STDOUT_LIMIT = 16_384
const STDERR_LIMIT = 4_096

const decoder = new TextDecoder()

/** The last `limit` bytes of a stream as text: the collected tail a check's diagnostics need. */
const tailText = <E>(stream: Stream.Stream<Uint8Array, E>, limit: number) =>
  Stream.runFold(
    stream,
    () => new Uint8Array(),
    (tail, chunk) => {
      const joined = new Uint8Array(tail.length + chunk.length)
      joined.set(tail)
      joined.set(chunk, tail.length)
      return joined.length > limit ? joined.slice(joined.length - limit) : joined
    },
  ).pipe(Effect.map(bytes => decoder.decode(bytes)))

const failed = (failure: ProcessFailure, exitCode: number | null = null): ProcessResult => ({ exitCode, stdout: '', stderr: '', failure })

/**
 * Runs one check process on the DSH spawner. A timeout or interruption terminates its whole process range; the run
 * reports `process-group-failed` (or, when interrupted, dies with `ProcessGroupStillRunning`) unless that range is
 * confirmed empty.
 */
export class ProcessRunner extends Context.Service<ProcessRunner, { readonly run: (request: ProcessRequest) => Effect.Effect<ProcessResult> }>()(
  '@dshfiles/project-checks/ProcessRunner',
) {
  static readonly layer = Layer.effect(
    ProcessRunner,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const executables = yield* Executables

      const run = Effect.fn('project-checks run')(
        function* (request: ProcessRequest) {
          const executableName = redactIdentifier(basename(request.command)) ?? 'process'
          yield* Effect.annotateCurrentSpan({ 'process.executable.name': executableName, 'dshx.project-checks.argument_count': request.args.length })
          const executable = yield* Effect.option(executables.resolve(request.command))
          if (Option.isNone(executable) || !isAbsolute(executable.value) || executable.value.includes('\0')) return failed('spawn-failed')

          const stopAttempted = yield* Ref.make(false)
          const stopGroupOf = (handle: ChildProcessSpawner.ChildProcessHandle) =>
            Ref.set(stopAttempted, true).pipe(
              Effect.andThen(handle.kill()),
              Effect.timeoutOption(STOP_CONFIRM_TIMEOUT),
              Effect.map(Option.isSome),
              Effect.catch(() => Effect.succeed(false)),
            )
          const spawned = yield* Effect.uninterruptible(
            spawner.spawn(ChildProcess.make(executable.value, request.args, { cwd: request.cwd, stdin: 'ignore', forceKillAfter: Duration.seconds(1) })).pipe(
              Effect.tap(handle =>
                Effect.addFinalizer(() =>
                  Effect.gen(function* () {
                    if (yield* Ref.get(stopAttempted)) return
                    if (!(yield* stopGroupOf(handle))) return yield* Effect.die(new ProcessGroupStillRunning({ executable: executableName }))
                  }),
                ),
              ),
              Effect.exit,
            ),
          )
          if (Exit.isFailure(spawned)) return failed('spawn-failed')
          const handle = spawned.value
          const stopGroup = stopGroupOf(handle)

          const outcome = yield* Effect.all(
            {
              exitCode: handle.exitCode.pipe(
                Effect.map(Option.some<number>),
                Effect.catch(error => (error.reason.method === 'exitCode' ? Effect.succeed(Option.none()) : Effect.fail(error))),
              ),
              stdout: tailText(handle.stdout, STDOUT_LIMIT),
              stderr: tailText(handle.stderr, STDERR_LIMIT),
            },
            { concurrency: 'unbounded' },
          ).pipe(Effect.timeoutOption(Duration.millis(request.timeoutMs)), Effect.exit)

          const confirmed = yield* stopGroup
          if (Exit.isFailure(outcome)) return failed(confirmed ? 'spawn-failed' : 'process-group-failed')
          if (Option.isNone(outcome.value)) return failed(confirmed ? 'timed-out' : 'process-group-failed')
          const exitCode = Option.getOrNull(outcome.value.value.exitCode)
          if (!confirmed) return failed('process-group-failed', exitCode)
          return { exitCode, stdout: outcome.value.value.stdout, stderr: outcome.value.value.stderr, failure: null }
        },
        Effect.scoped,
        Effect.tap(result =>
          Effect.annotateCurrentSpan({ 'process.exit.code': result.exitCode ?? undefined, 'dshx.project-checks.failure': result.failure ?? undefined }),
        ),
      )

      return ProcessRunner.of({ run })
    }),
  )
}
