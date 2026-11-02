import { Clock, Context, Deferred, Duration, Effect, Fiber, Layer, Option, Schema, type Scope, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import {
  SshAuthenticationFailed,
  SshCommandFailed,
  SshHostKeyRejected,
  SshHostUnresolved,
  SshInputTooLarge,
  SshOutputTooLarge,
  SshTargetInvalid,
  SshTimedOut,
  SshUnavailable,
  SshUnreachable,
  TunnelFailed,
  TunnelTimedOut,
  type SshConnectionError,
  type SshExecError,
  type SshRunError,
  type SshTunnelError,
} from './errors.js'
import { sshTargetSchema } from './records.js'

const defaultOutputLimit = 128 * 1024
const inputLimit = 60 * 1024 * 1024
const stderrTailLength = 8_192
const defaultTimeout = Duration.seconds(12)
const tunnelReadyTimeout = Duration.seconds(12)
/** DSH escalates SIGTERM to SIGKILL after this grace; `killSignal` is not honoured by its spawner. */
const killGrace = Duration.millis(1_500)

export interface SshRun {
  readonly sshTarget: string
  readonly command: string
  readonly stdin?: Uint8Array | undefined
  readonly timeout?: Duration.Input | undefined
  readonly maxOutputBytes?: number | undefined
}

export interface SshResult {
  /** The remote command's exit status; null when ssh itself ended the run. */
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
  readonly outputExceeded: boolean
  readonly durationMs: number
}

export interface SshTunnelRequest {
  readonly sshTarget: string
  readonly remotePort: number
  readonly localAddress: string
  readonly localPort: number
}

export interface SshTunnel {
  /** Completes when the forwarding process exits, on its own or because its Scope closed. */
  readonly closed: Effect.Effect<void>
}

/** `-v` is only for tunnels: their readiness is read from a verbose stderr line. */
const sshOptions = (input: { readonly verbose: boolean }): string[] => [
  '-o',
  'BatchMode=yes',
  '-o',
  'StrictHostKeyChecking=yes',
  '-o',
  'ExitOnForwardFailure=yes',
  '-o',
  'ForwardAgent=no',
  '-o',
  'PermitLocalCommand=no',
  '-o',
  'ConnectTimeout=8',
  '-o',
  'ServerAliveInterval=10',
  '-o',
  'ServerAliveCountMax=2',
  ...(input.verbose ? ['-v'] : []),
]

const decodeTarget = Schema.decodeUnknownEffect(sshTargetSchema)

const validTarget = (sshTarget: string) => decodeTarget(sshTarget).pipe(Effect.mapError(() => new SshTargetInvalid()))

/** The ssh-level failure its stderr names, before any remote command ran; undefined when stderr names none. */
const connectionFailure = (stderr: string): SshConnectionError | undefined => {
  if (/host key verification failed|remote host identification has changed/i.test(stderr)) return new SshHostKeyRejected()
  if (/permission denied/i.test(stderr)) return new SshAuthenticationFailed()
  if (/could not resolve hostname|name or service not known/i.test(stderr)) return new SshHostUnresolved()
  if (/connection timed out|operation timed out|no route to host|connection refused/i.test(stderr)) return new SshUnreachable()
  return undefined
}

export const shellQuote = (value: string): string => `'${value.replace(/'/g, `'\\''`)}'`

/** The OpenSSH client run through DSH's subprocess runtime: bounded remote commands and scoped loopback forwards. */
export class Ssh extends Context.Service<
  Ssh,
  {
    /** One bounded remote process; a non-zero exit, a timeout and an output overflow are values, not failures. */
    readonly run: (input: SshRun) => Effect.Effect<SshResult, SshRunError>
    /** Run a remote command and return its stdout; any unsuccessful run fails with the error it names. */
    readonly exec: (input: Omit<SshRun, 'stdin'>) => Effect.Effect<string, SshExecError>
    /** A `-L` forward that is ready once this succeeds and stops when the Scope closes. */
    readonly tunnel: (request: SshTunnelRequest) => Effect.Effect<SshTunnel, SshTunnelError, Scope.Scope>
  }
>()('@dshfiles/multi-host/Ssh') {
  static readonly layer = Layer.effect(
    Ssh,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const serviceScope = yield* Effect.scope

      const runProcess = Effect.fnUntraced(function* (input: SshRun & { readonly target: string }) {
        const startedAt = yield* Clock.currentTimeMillis
        const maxOutputBytes = input.maxOutputBytes ?? defaultOutputLimit
        const handle = yield* spawner
          .spawn(
            ChildProcess.make('ssh', [...sshOptions({ verbose: false }), input.target, input.command], {
              stdin: input.stdin === undefined ? 'ignore' : Stream.make(input.stdin),
              forceKillAfter: killGrace,
            }),
          )
          .pipe(Effect.mapError(cause => new SshUnavailable({ cause })))
        const overflow = yield* Deferred.make<void>()
        const output = { stdout: '', stderr: '', bytes: 0 }
        const collect = (input: { readonly stream: Stream.Stream<Uint8Array, unknown>; readonly into: 'stdout' | 'stderr' }) =>
          Effect.suspend(() => {
            const decoder = new TextDecoder()
            return Stream.runForEach(input.stream, chunk =>
              Effect.suspend(() => {
                output.bytes += chunk.byteLength
                if (output.bytes > maxOutputBytes) return Deferred.succeed(overflow, undefined)
                output[input.into] += decoder.decode(chunk, { stream: true })
                return Effect.void
              }),
            ).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  output[input.into] += decoder.decode()
                }),
              ),
            )
          })
        const exited = Effect.all(
          [
            collect({ stream: handle.stdout, into: 'stdout' }),
            collect({ stream: handle.stderr, into: 'stderr' }),
            handle.exitCode.pipe(
              Effect.map((code): number | null => code),
              Effect.orElseSucceed(() => null),
            ),
          ],
          { concurrency: 'unbounded' },
        ).pipe(
          Effect.map(([, , code]) => ({ kind: 'exited' as const, code })),
          Effect.mapError(cause => new SshUnavailable({ cause })),
        )
        const settled = yield* Effect.raceFirst(exited, Effect.as(Deferred.await(overflow), { kind: 'overflow' as const })).pipe(
          Effect.timeoutOption(input.timeout ?? defaultTimeout),
        )
        const durationMs = (yield* Clock.currentTimeMillis) - startedAt
        const outcome = Option.getOrUndefined(settled)
        return {
          code: outcome?.kind === 'exited' ? outcome.code : null,
          stdout: output.stdout,
          stderr: output.stderr.slice(-stderrTailLength),
          timedOut: outcome === undefined,
          outputExceeded: outcome?.kind === 'overflow',
          durationMs,
        } satisfies SshResult
      })

      const run = Effect.fn('ssh command', { kind: 'client', attributes: { 'process.executable.name': 'ssh' } })(function* (input: SshRun) {
        const target = yield* validTarget(input.sshTarget)
        if (input.stdin !== undefined) {
          if (input.stdin.byteLength > inputLimit) return yield* new SshInputTooLarge({ bytes: input.stdin.byteLength, limit: inputLimit })
          yield* Effect.annotateCurrentSpan('dshx.multi-host.stdin_bytes', input.stdin.byteLength)
        }
        // The process lives in the service Scope so a cancelled caller returns at once while DSH stops ssh behind it.
        const process = yield* Effect.forkIn(Effect.scoped(runProcess({ ...input, target })), serviceScope)
        const result = yield* Fiber.join(process).pipe(Effect.onInterrupt(() => Effect.asVoid(Effect.forkIn(Fiber.interrupt(process), serviceScope))))
        yield* Effect.annotateCurrentSpan({
          'process.exit.code': result.code ?? -1,
          'dshx.multi-host.timed_out': result.timedOut,
          'dshx.multi-host.output_exceeded': result.outputExceeded,
        })
        if (result.code !== 0) yield* Effect.annotateCurrentSpan('error.type', result.timedOut ? 'timeout' : 'exit')
        return result
      })

      const exec = Effect.fnUntraced(function* (input: Omit<SshRun, 'stdin'>) {
        const result = yield* run(input)
        if (result.outputExceeded) return yield* new SshOutputTooLarge({ limit: input.maxOutputBytes ?? defaultOutputLimit })
        if (result.timedOut) return yield* new SshTimedOut({ timeoutMs: Duration.toMillis(Duration.fromInputUnsafe(input.timeout ?? defaultTimeout)) })
        if (result.code !== 0) return yield* connectionFailure(result.stderr) ?? new SshCommandFailed({ exitCode: result.code })
        return result.stdout
      })

      const tunnel = Effect.fn('ssh tunnel open', { kind: 'client', attributes: { 'process.executable.name': 'ssh' } })(function* (request: SshTunnelRequest) {
        const target = yield* validTarget(request.sshTarget)
        const forward = `${request.localAddress}:${request.localPort}:127.0.0.1:${request.remotePort}`
        const closed = yield* Deferred.make<void>()
        yield* Effect.addFinalizer(() => Deferred.succeed(closed, undefined))
        const handle = yield* spawner
          .spawn(
            ChildProcess.make('ssh', [...sshOptions({ verbose: true }), '-N', '-L', forward, target], {
              stdin: 'ignore',
              stdout: 'ignore',
              forceKillAfter: killGrace,
            }),
          )
          .pipe(Effect.mapError(cause => new SshUnavailable({ cause })))
        const readyLine = `Local forwarding listening on ${request.localAddress} port ${request.localPort}.`
        const ready = yield* Deferred.make<void, SshTunnelError>()
        const stderr = { tail: '' }
        yield* handle.stderr.pipe(
          Stream.decodeText,
          Stream.runForEach(chunk =>
            Effect.suspend(() => {
              stderr.tail = (stderr.tail + chunk).slice(-stderrTailLength)
              return stderr.tail.includes(readyLine) ? Deferred.succeed(ready, undefined) : Effect.void
            }),
          ),
          Effect.matchEffect({
            onFailure: cause => Deferred.fail(ready, new SshUnavailable({ cause })),
            onSuccess: () => Deferred.fail(ready, connectionFailure(stderr.tail) ?? new TunnelFailed()),
          }),
          Effect.forkScoped,
        )
        yield* Deferred.await(ready).pipe(
          Effect.timeoutOrElse({
            duration: tunnelReadyTimeout,
            orElse: () => Effect.fail(new TunnelTimedOut({ timeoutMs: Duration.toMillis(tunnelReadyTimeout) })),
          }),
        )
        yield* Effect.forkScoped(Effect.andThen(Effect.ignore(handle.exitCode), Deferred.succeed(closed, undefined)))
        return { closed: Deferred.await(closed) } satisfies SshTunnel
      })

      return Ssh.of({ run, exec, tunnel })
    }),
  )
}
