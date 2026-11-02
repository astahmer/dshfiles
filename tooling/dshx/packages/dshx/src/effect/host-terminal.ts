import type { SubprocessTerminalEnvironment, SubprocessTerminalHandle, SubprocessTerminalSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { Context, Effect, Layer, Schema, type Scope } from 'effect'
import { hostService } from './host-context.js'

/** The DSH subprocess provider could not answer or start what was asked. */
export class HostTerminalFailed extends Schema.TaggedError<HostTerminalFailed>()('HostTerminalFailed', {
  operation: Schema.Literals(['resolve-executable', 'environment', 'spawn']),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `The DSH subprocess provider failed to ${this.operation.replace('-', ' ')}.`
  }
}

/**
 * Pseudo-terminal sessions and executable lookup on the DSH subprocess provider, which may run on another machine.
 * Plain processes go through `ChildProcessSpawner` (`@dshfiles/dshx/effect/child-process-spawner`).
 */
export class HostTerminal extends Context.Service<
  HostTerminal,
  {
    /** Absolute path of `command` in the provider's world, searched with `env`'s PATH when given. */
    readonly resolveExecutable: (command: string, env?: Readonly<Record<string, string>>) => Effect.Effect<string, HostTerminalFailed>
    readonly environment: Effect.Effect<SubprocessTerminalEnvironment, HostTerminalFailed>
    /** A terminal session that is terminated when the Scope closes. */
    readonly spawn: (spec: Omit<SubprocessTerminalSpawnSpec, 'signal'>) => Effect.Effect<SubprocessTerminalHandle, HostTerminalFailed, Scope.Scope>
  }
>()('@dshfiles/dshx/HostTerminal') {
  static readonly layer = Layer.effect(
    HostTerminal,
    Effect.gen(function* () {
      const subprocess = yield* hostService('subprocess')
      return HostTerminal.of({
        resolveExecutable: Effect.fn('terminal resolve-executable')(function* (command, env) {
          return yield* Effect.tryPromise({
            try: signal => subprocess.resolveExecutable(command, env, signal),
            catch: cause => new HostTerminalFailed({ operation: 'resolve-executable', cause }),
          })
        }),
        environment: Effect.tryPromise({
          try: signal => subprocess.terminalEnvironment(signal),
          catch: cause => new HostTerminalFailed({ operation: 'environment', cause }),
        }).pipe(Effect.withSpan('terminal environment')),
        spawn: Effect.fn('terminal spawn')(function* (spec) {
          return yield* Effect.acquireRelease(
            Effect.tryPromise({
              try: signal => subprocess.spawnTerminal({ ...spec, signal }),
              catch: cause => new HostTerminalFailed({ operation: 'spawn', cause }),
            }),
            terminal => Effect.tryPromise(() => terminal.terminate()).pipe(Effect.ignore({ log: 'Warn', message: 'DSH terminal did not stop cleanly' })),
          )
        }),
      })
    }),
  )
}
