import { hostname } from 'node:os'
import { Context, Effect, Layer, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

const SCUTIL_TIMEOUT = '1 second'

/** The Finder computer name ("MacBook Pro de Alexandre") on macOS; elsewhere, or when scutil fails, the short hostname. Read once. */
export class MachineName extends Context.Service<MachineName, { readonly name: Effect.Effect<string> }>()('@dshfiles/thread-sidebar/MachineName') {
  static readonly layerWith = (input: { readonly platform: NodeJS.Platform; readonly hostname: string }) =>
    Layer.effect(
      MachineName,
      Effect.gen(function* () {
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
        const shortHostname = input.hostname.replace(/\..*$/u, '')
        const computerName = Effect.gen(function* () {
          const handle = yield* spawner.spawn(ChildProcess.make('scutil', ['--get', 'ComputerName'], { stdin: 'ignore', stderr: 'ignore' }))
          return yield* handle.stdout.pipe(Stream.decodeText(), Stream.mkString)
        }).pipe(
          Effect.scoped,
          Effect.timeout(SCUTIL_TIMEOUT),
          Effect.map(stdout => stdout.trim() || shortHostname),
          Effect.orElseSucceed(() => shortHostname),
          Effect.withSpan('machine name read', { kind: 'client', attributes: { 'process.executable.name': 'scutil' } }),
        )
        const name = yield* Effect.cached(input.platform === 'darwin' ? computerName : Effect.succeed(shortHostname))
        return MachineName.of({ name })
      }),
    )

  static readonly layer = Layer.unwrap(Effect.sync(() => MachineName.layerWith({ platform: process.platform, hostname: hostname() })))
}
