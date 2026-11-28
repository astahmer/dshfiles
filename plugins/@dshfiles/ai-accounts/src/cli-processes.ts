import { Context, Duration, Effect, Fiber, Layer, Queue, Schema, type Scope, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'

/**
 * A wrapped vendor CLI (`agy acp`, `vibe-acp`) could not be started, or failed while it ran. The routes own the
 * user-facing recovery, since only they know which install command and sign-in the account needs.
 */
export class CliProcessFailed extends Schema.TaggedError<CliProcessFailed>()('CliProcessFailed', {
  /** The executable was not found on the Host. */
  missing: Schema.Boolean,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.missing ? 'The wrapped CLI is not installed on the Host.' : 'The wrapped CLI failed.'
  }
}

export interface CliLaunch {
  readonly executable: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
}

/** One running CLI: the lines it reads, the lines it writes, and how it ended. */
export interface CliProcess {
  readonly lines: Stream.Stream<string, CliProcessFailed>
  readonly stderr: Stream.Stream<string, CliProcessFailed>
  readonly exitCode: Effect.Effect<number, CliProcessFailed>
}

const KILL_GRACE = Duration.seconds(5)

const isMissing = (cause: unknown): boolean => /NotFound|ENOENT|not found/iu.test(`${String(cause)} ${JSON.stringify(cause) ?? ''}`)

const failed = (cause: unknown): CliProcessFailed => new CliProcessFailed({ missing: isMissing(cause), cause })

/**
 * CLI processes on the Host's spawner. Closing the Scope a process started in stops its whole process range (an ACP
 * front's per-session worker included), after a grace period.
 */
export class CliProcesses extends Context.Service<
  CliProcesses,
  {
    readonly start: (input: CliLaunch & { readonly input: Stream.Stream<string> }) => Effect.Effect<CliProcess, CliProcessFailed, Scope.Scope>
  }
>()('@dshfiles/ai-accounts/CliProcesses') {
  static readonly layer = Layer.effect(
    CliProcesses,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const encoder = new TextEncoder()
      const start = Effect.fn('cli process start')(function* (input: CliLaunch & { readonly input: Stream.Stream<string> }) {
        yield* Effect.annotateCurrentSpan({
          'process.executable.name': input.executable.split(/[\\/]/u).at(-1) ?? input.executable,
          'process.args_count': input.args.length,
        })
        const handle = yield* spawner
          .spawn(
            ChildProcess.make(input.executable, [...input.args], {
              cwd: input.cwd,
              env: { ...input.env },
              stdin: input.input.pipe(Stream.map(line => encoder.encode(`${line}\n`))),
              stdout: 'pipe',
              stderr: 'pipe',
              forceKillAfter: KILL_GRACE,
            }),
          )
          .pipe(Effect.mapError(failed))
        const process: CliProcess = {
          lines: handle.stdout.pipe(Stream.decodeText, Stream.splitLines, Stream.mapError(failed)),
          stderr: handle.stderr.pipe(Stream.decodeText, Stream.mapError(failed)),
          exitCode: handle.exitCode.pipe(Effect.map(Number), Effect.mapError(failed)),
        }
        return process
      })
      return CliProcesses.of({ start })
    }),
  )

  /**
   * The service on the Host's DSH subprocess spawner. A Host without that service still activates AI Accounts: only
   * Antigravity accounts then report that `agy` cannot run, instead of every account route failing to load.
   */
  static readonly hostLayer = CliProcesses.layer.pipe(
    Layer.provide(DshChildProcessSpawner.layer),
    Layer.catch(() =>
      Layer.succeed(
        CliProcesses,
        CliProcesses.of({
          start: () => Effect.fail(new CliProcessFailed({ missing: false, cause: 'This Host offers no subprocess service to run the CLI.' })),
        }),
      ),
    ),
  )
}

/** A running CLI as a transport drives it: send a line, and stop it (resolves once its process range is gone). */
export interface CliRunning {
  readonly send: (line: string) => void
  readonly stop: () => Promise<void>
}

export type CliOutcome = { readonly kind: 'exited'; readonly code: number } | { readonly kind: 'failed'; readonly missing: boolean; readonly message: string }

/** What the unported transport code reads: start one CLI, and run something after a delay. */
export interface CliProcessesPromise {
  readonly launch: (
    input: CliLaunch & {
      readonly onLine: (line: string) => void
      readonly onStderr: (text: string) => void
      readonly onEnd: (outcome: CliOutcome) => void
    },
  ) => CliRunning
  /** Run `task` after `delay`; the returned function cancels it. */
  readonly after: (delay: Duration.Input, task: () => void) => () => void
}

export class CliProcessesPromiseModel {
  static readonly facade = (processes: CliProcesses['Service'], services: Context.Context<never>): CliProcessesPromise => {
    const fork = Effect.runForkWith(services)
    const sync = Effect.runSyncWith(services)
    const run = Effect.runPromiseWith(services)
    return {
      launch: input => {
        const queue = sync(Queue.unbounded<string>())
        const lifetime = Effect.scoped(
          Effect.gen(function* () {
            const process = yield* processes.start({ ...input, input: Stream.fromQueue(queue) })
            yield* process.stderr.pipe(
              Stream.runForEach(text => Effect.sync(() => input.onStderr(text))),
              Effect.ignore,
              Effect.forkScoped,
            )
            yield* process.lines.pipe(Stream.runForEach(line => Effect.sync(() => input.onLine(line))))
            const code = yield* process.exitCode
            input.onEnd({ kind: 'exited', code })
          }),
        ).pipe(
          Effect.catchTag('CliProcessFailed', error =>
            Effect.sync(() => input.onEnd({ kind: 'failed', missing: error.missing, message: String(error.cause ?? error.message) })),
          ),
        )
        const fiber = fork(lifetime)
        return {
          send: line => {
            Queue.offerUnsafe(queue, line)
          },
          stop: () => run(Fiber.interrupt(fiber)),
        }
      },
      after: (delay, task) => {
        const fiber = fork(Effect.sleep(delay).pipe(Effect.andThen(Effect.sync(task))))
        return () => {
          fork(Fiber.interrupt(fiber))
        }
      },
    }
  }
}
