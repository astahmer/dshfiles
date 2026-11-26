import type { JsonValue } from '@dshfiles/dshx/json'
import { Context, Deferred, Duration, Effect, Exit, Layer, Option, PlatformError, Queue, Schema, Scope, Stream, SynchronizedRef } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import {
  decodeAnswerLine,
  initializeParams,
  type JsonRpcRequest,
  type SecretMcpAnswer,
  type SecretMcpRunResult,
  toolOutcomeOf,
  toRunResult,
} from './secret-mcp.js'

export interface SecretMcpShape {
  readonly run: (input: {
    readonly command: readonly string[]
    readonly cwd: string
    readonly environment: string
    readonly timeoutSeconds?: number
  }) => Effect.Effect<SecretMcpRunResult, SecretMcpError>
}

const failureMessages = {
  missing: 'The secret CLI (`secret mcp`) is not on the Host PATH.',
  timeout: 'secret mcp did not answer in time.',
  failed: 'secret mcp failed.',
} as const

export class SecretMcpError extends Schema.TaggedError<SecretMcpError>()(
  'SecretMcpError',
  { code: Schema.Literals(['missing', 'timeout', 'failed']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'secret-mcp-error' },
) {
  override get message(): string {
    return failureMessages[this.code]
  }
}

const INITIALIZE_TIMEOUT = Duration.seconds(30)
const DEFAULT_RUN_TIMEOUT_SECONDS = 60
const KILL_GRACE = Duration.seconds(2)

const spawnFailure = (error: PlatformError.PlatformError): SecretMcpError =>
  new SecretMcpError({ code: error.reason._tag === 'NotFound' ? 'missing' : 'failed', cause: error })

/** One running `secret mcp`: send a request and wait for its answer, or learn that the server is gone. */
interface Connection {
  readonly request: (input: {
    readonly method: string
    readonly params: JsonValue
    readonly timeout: Duration.Input
  }) => Effect.Effect<SecretMcpAnswer, SecretMcpError>
  readonly ended: Deferred.Deferred<void>
  readonly scope: Scope.Closeable
}

/** `secret mcp` as a service: one long-lived server per Host, values never cross it. */
export class SecretMcp extends Context.Service<SecretMcp, SecretMcpShape>()('@dshfiles/secret-catalog/SecretMcp') {
  static readonly layer = Layer.effect(
    SecretMcp,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const layerScope = yield* Effect.scope
      const encoder = new TextEncoder()

      const connect = Effect.fn('secret mcp connect')(function* () {
        const scope = yield* Scope.fork(layerScope)
        const outgoing = yield* Queue.unbounded<string>()
        const pending = new Map<number, Deferred.Deferred<SecretMcpAnswer, SecretMcpError>>()
        const ended = yield* Deferred.make<void>()
        let nextId = 1
        const write = (payload: JsonRpcRequest) => Queue.offer(outgoing, `${JSON.stringify(payload)}\n`)
        const handle = yield* spawner
          .spawn(
            ChildProcess.make(process.env['SECRET_BIN'] ?? 'secret', ['mcp'], {
              stdin: Stream.fromQueue(outgoing).pipe(Stream.map(line => encoder.encode(line))),
              stdout: 'pipe',
              stderr: 'ignore',
              forceKillAfter: KILL_GRACE,
            }),
          )
          .pipe(
            Scope.provide(scope),
            Effect.mapError(spawnFailure),
            Effect.onError(() => Scope.close(scope, Exit.void)),
          )
        const deliver = (line: string) =>
          Option.match(decodeAnswerLine(line), {
            onNone: () => Effect.void,
            onSome: answer => {
              const waiter = pending.get(answer.id)
              if (waiter === undefined) return Effect.void
              pending.delete(answer.id)
              return Deferred.succeed(waiter, answer)
            },
          })
        // The server is gone once it exits or its stdout ends: every open request fails, and the next call starts a new
        // server. `ended` is marked first so a caller woken by its failed request never reuses this connection.
        const failPending = Deferred.succeed(ended, undefined).pipe(
          Effect.andThen(
            Effect.suspend(() =>
              Effect.forEach([...pending.values()], waiter => Deferred.fail(waiter, new SecretMcpError({ code: 'missing', cause: 'secret mcp exited' })), {
                discard: true,
              }),
            ),
          ),
          Effect.andThen(Effect.sync(() => pending.clear())),
        )
        yield* handle.stdout.pipe(
          Stream.decodeText,
          Stream.splitLines,
          Stream.runForEach(deliver),
          Effect.ignore,
          Effect.raceFirst(Effect.ignore(handle.exitCode)),
          Effect.ensuring(failPending),
          Effect.forkIn(scope),
        )
        const request: Connection['request'] = input =>
          Effect.gen(function* () {
            const id = nextId++
            const waiter = yield* Deferred.make<SecretMcpAnswer, SecretMcpError>()
            pending.set(id, waiter)
            yield* write({ jsonrpc: '2.0', id, method: input.method, params: input.params })
            return yield* Deferred.await(waiter).pipe(
              Effect.timeoutOrElse({
                duration: input.timeout,
                orElse: () => Effect.fail(new SecretMcpError({ code: 'timeout', cause: `secret mcp ${input.method} timed out` })),
              }),
              Effect.ensuring(Effect.sync(() => pending.delete(id))),
            )
          })
        const connection: Connection = { request, ended, scope }
        yield* request({ method: 'initialize', params: initializeParams, timeout: INITIALIZE_TIMEOUT }).pipe(
          Effect.onError(() => Scope.close(scope, Exit.void)),
        )
        yield* write({ jsonrpc: '2.0', method: 'notifications/initialized' })
        return connection
      })

      // Started on first use: a Host that never runs a command keeps no child.
      const current = yield* SynchronizedRef.make(Option.none<Connection>())
      const live = SynchronizedRef.modifyEffect(current, held =>
        Effect.gen(function* () {
          if (Option.isSome(held) && !(yield* Deferred.isDone(held.value.ended))) return [held.value, held] as const
          if (Option.isSome(held)) yield* Scope.close(held.value.scope, Exit.void)
          const connection = yield* connect()
          return [connection, Option.some(connection)] as const
        }),
      )

      return SecretMcp.of({
        run: input =>
          Effect.gen(function* () {
            const timeoutSeconds = input.timeoutSeconds ?? DEFAULT_RUN_TIMEOUT_SECONDS
            const connection = yield* live
            const answer = yield* connection.request({
              method: 'tools/call',
              params: { name: 'secret_run', arguments: { command: [...input.command], cwd: input.cwd, env: input.environment, timeoutSeconds } },
              timeout: Duration.seconds(timeoutSeconds + 5),
            })
            const outcome = toolOutcomeOf('secret_run', answer)
            if (outcome === undefined) return yield* new SecretMcpError({ code: 'failed', cause: 'secret mcp secret_run returned no result' })
            if (outcome.kind === 'refused') return yield* new SecretMcpError({ code: 'failed', cause: outcome.message })
            return toRunResult(outcome.payload)
          }).pipe(Effect.withSpan('secret mcp run')),
      })
    }),
  )

  static readonly layerTest = (run: SecretMcpShape['run']) => Layer.succeed(SecretMcp, SecretMcp.of({ run }))
}
