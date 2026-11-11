import { decodeJson, jsonValueSchema } from '@dshfiles/dshx/json'
import { Effect, Schema, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

/** `tailscale` exited with a non-zero code. */
class TailscaleFailed extends Schema.TaggedError<TailscaleFailed>()('TailscaleFailed', { exitCode: Schema.Number }) {}

/** Tailnet status parsing and the two Tailscale actions this plugin needs. */
export class Tailnet {
  /** The tailnet DNS name Tailscale reports for this machine, or undefined when it is not running. */
  static parseName(raw: string): string | undefined {
    const status = decodeJson(jsonValueSchema, raw)
    if (typeof status !== 'object' || status === null || !('Self' in status)) return undefined
    const self = status.Self
    if (typeof self !== 'object' || self === null || !('DNSName' in self)) return undefined
    const name = self.DNSName
    if (typeof name !== 'string') return undefined
    const trimmed = name.replace(/\.$/, '')
    return trimmed.endsWith('.ts.net') ? trimmed : undefined
  }
}

const runTailscale = (args: readonly string[]) =>
  Effect.scoped(
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const handle = yield* spawner.spawn(ChildProcess.make('tailscale', [...args], { stdin: 'ignore' }))
      const [stdout, exitCode] = yield* Effect.all([Stream.mkString(Stream.decodeText(Stream.drainFork(handle.stdout, handle.stderr))), handle.exitCode], {
        concurrency: 'unbounded',
      })
      if (exitCode !== 0) return yield* new TailscaleFailed({ exitCode })
      return stdout
    }),
  ).pipe(Effect.timeout('3 seconds'))

export const detectTailnet = runTailscale(['status', '--json']).pipe(
  Effect.flatMap(raw => Effect.try(() => Tailnet.parseName(raw))),
  Effect.orElseSucceed(() => undefined),
  Effect.withSpan('phone access tailnet'),
)

/** Point Tailscale Serve at the loopback proxy; the caller prints the undo command. */
export const serveTailnet = Effect.fn('phone access serve')(function* (port: number) {
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) return false
  return yield* runTailscale(['serve', '--bg', '--https=443', `http://127.0.0.1:${port}`]).pipe(
    Effect.as(true),
    Effect.orElseSucceed(() => false),
  )
})
