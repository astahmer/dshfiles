import { Context, Duration, Effect, Layer, Option, Ref, type Scope } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { LocalStartFailed } from './errors.js'
import { McpExecutables } from './host-promise.js'

export type LocalProcessStatus = 'not-configured' | 'starting' | 'running' | 'exited' | 'stopping' | 'stopped' | 'stop-unconfirmed'

export interface LocalCommand {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
}

/** A local start command running for the Scope that started it; closing that Scope stops its whole process range. */
export interface LocalProcess {
  readonly status: Effect.Effect<LocalProcessStatus>
  readonly markRunning: Effect.Effect<void>
}

const STOP_CONFIRM_TIMEOUT = Duration.seconds(10)

/** Host-owned local start commands on the DSH spawner; no command runs in the browser or through a shell. */
export class LocalCommands extends Context.Service<
  LocalCommands,
  {
    readonly start: (input: {
      readonly id: string
      readonly command: LocalCommand
      readonly env: Readonly<Record<string, string>>
    }) => Effect.Effect<LocalProcess, LocalStartFailed, Scope.Scope>
  }
>()('@dshfiles/mcp-servers/LocalCommands') {
  static readonly layer = Layer.effect(
    LocalCommands,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const executables = yield* McpExecutables

      const start = Effect.fn('mcp server start')(function* (input: {
        readonly id: string
        readonly command: LocalCommand
        readonly env: Readonly<Record<string, string>>
      }) {
        yield* Effect.annotateCurrentSpan({ 'dshx.mcp-servers.argument_count': input.command.args.length })
        const failed = (cause: unknown) => new LocalStartFailed({ id: input.id, cause })
        const executable = yield* executables.resolve({ command: input.command.command, env: input.env }).pipe(Effect.mapError(failed))
        const status = yield* Ref.make<LocalProcessStatus>('starting')
        const handle = yield* spawner
          .spawn(
            ChildProcess.make(executable, input.command.args, {
              cwd: input.command.cwd,
              env: { ...input.env },
              stdin: 'ignore',
              stdout: 'ignore',
              stderr: 'ignore',
              forceKillAfter: Duration.seconds(5),
            }),
          )
          .pipe(Effect.mapError(failed))
        yield* Effect.addFinalizer(() =>
          Ref.set(status, 'stopping').pipe(
            Effect.andThen(handle.kill()),
            Effect.timeoutOption(STOP_CONFIRM_TIMEOUT),
            Effect.map(Option.isSome),
            Effect.catch(() => Effect.succeed(false)),
            Effect.flatMap(confirmed => Ref.set(status, confirmed ? 'stopped' : 'stop-unconfirmed')),
          ),
        )
        yield* handle.exitCode.pipe(
          Effect.exit,
          Effect.andThen(Ref.update(status, current => (current === 'stopping' || current === 'stopped' ? current : 'exited'))),
          Effect.forkScoped,
        )
        const running: LocalProcess = {
          status: Ref.get(status),
          markRunning: Ref.update(status, current => (current === 'starting' ? 'running' : current)),
        }
        return running
      })

      return LocalCommands.of({ start })
    }),
  )
}
