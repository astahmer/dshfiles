import { Context, Duration, Effect, Fiber, Layer, Queue, Schema, type Scope, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'

/** `agy` could not be started, or failed while it ran. */
export class AntigravityProcessFailed extends Schema.TaggedError<AntigravityProcessFailed>()('AntigravityProcessFailed', {
  /** The executable was not found on the Host. */
  missing: Schema.Boolean,
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return this.missing ? 'The Antigravity CLI (agy) is not installed on the Host.' : 'The Antigravity CLI (agy) failed.'
  }
}

export interface AgyLaunch {
  readonly executable: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
}

/** One running `agy`: the lines it reads, the lines it writes, and how it ended. */
export interface AgyProcess {
  readonly lines: Stream.Stream<string, AntigravityProcessFailed>
  readonly stderr: Stream.Stream<string, AntigravityProcessFailed>
  readonly exitCode: Effect.Effect<number, AntigravityProcessFailed>
}

const KILL_GRACE = Duration.seconds(5)

const isMissing = (cause: unknown): boolean => /NotFound|ENOENT|not found/iu.test(`${String(cause)} ${JSON.stringify(cause) ?? ''}`)

const failed = (cause: unknown): AntigravityProcessFailed => new AntigravityProcessFailed({ missing: isMissing(cause), cause })

/**
 * `agy` processes on the Host's spawner. Closing the Scope a process started in stops its whole process range (the ACP
 * front and the per-session worker it starts), after a grace period.
 */
export class AntigravityProcesses extends Context.Service<
  AntigravityProcesses,
  {
    readonly start: (input: AgyLaunch & { readonly input: Stream.Stream<string> }) => Effect.Effect<AgyProcess, AntigravityProcessFailed, Scope.Scope>
  }
>()('@dshfiles/ai-accounts/AntigravityProcesses') {
  static readonly layer = Layer.effect(
    AntigravityProcesses,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const encoder = new TextEncoder()
      const start = Effect.fn('antigravity process start')(function* (input: AgyLaunch & { readonly input: Stream.Stream<string> }) {
        yield* Effect.annotateCurrentSpan({ 'process.executable.name': 'agy', 'process.args_count': input.args.length })
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
        const process: AgyProcess = {
          lines: handle.stdout.pipe(Stream.decodeText, Stream.splitLines, Stream.mapError(failed)),
          stderr: handle.stderr.pipe(Stream.decodeText, Stream.mapError(failed)),
          exitCode: handle.exitCode.pipe(Effect.map(Number), Effect.mapError(failed)),
        }
        return process
      })
      return AntigravityProcesses.of({ start })
    }),
  )

  /**
   * The service on the Host's DSH subprocess spawner. A Host without that service still activates AI Accounts: only
   * Antigravity accounts then report that `agy` cannot run, instead of every account route failing to load.
   */
  static readonly hostLayer = AntigravityProcesses.layer.pipe(
    Layer.provide(DshChildProcessSpawner.layer),
    Layer.catch(() =>
      Layer.succeed(
        AntigravityProcesses,
        AntigravityProcesses.of({
          start: () => Effect.fail(new AntigravityProcessFailed({ missing: false, cause: 'This Host offers no subprocess service to run agy.' })),
        }),
      ),
    ),
  )
}

/** A running `agy` as the transport drives it: send a line, and stop it (resolves once its process range is gone). */
export interface AgyRunning {
  readonly send: (line: string) => void
  readonly stop: () => Promise<void>
}

export type AgyOutcome = { readonly kind: 'exited'; readonly code: number } | { readonly kind: 'failed'; readonly missing: boolean; readonly message: string }

/** What the unported transport code reads: start one `agy`, and run something after a delay. */
export interface AntigravityProcessesPromise {
  readonly launch: (
    input: AgyLaunch & {
      readonly onLine: (line: string) => void
      readonly onStderr: (text: string) => void
      readonly onEnd: (outcome: AgyOutcome) => void
    },
  ) => AgyRunning
  /** Run `task` after `delay`; the returned function cancels it. */
  readonly after: (delay: Duration.Input, task: () => void) => () => void
}

export class AntigravityProcessesPromiseModel {
  static readonly facade = (processes: AntigravityProcesses['Service'], services: Context.Context<never>): AntigravityProcessesPromise => {
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
          Effect.catchTag('AntigravityProcessFailed', error =>
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
