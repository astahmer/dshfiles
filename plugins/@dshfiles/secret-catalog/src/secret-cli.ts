import { homedir } from 'node:os'
import { commandAttributes } from '@dshfiles/dshx/tracing'
import { Config, Context, Duration, Effect, Layer, Option, type PlatformError, Schema, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

const MAX_STDOUT_BYTES = 1_000_000
const COMMAND_TIMEOUT = Duration.seconds(15)

export const SecretCliFailureCode = Schema.Literals(['cli-missing', 'cli-timeout', 'cli-failed'])
export type SecretCliFailureCode = typeof SecretCliFailureCode.Type

const failureMessages = {
  'cli-missing': 'Secret CLI executable could not be found on the Host PATH.',
  'cli-timeout': 'Secret CLI command timed out.',
  'cli-failed': 'Secret CLI command failed.',
} as const satisfies Record<SecretCliFailureCode, string>

/** A CLI failure with a stable code, so callers can say what went wrong without parsing message text. */
export class SecretCliError extends Schema.TaggedError<SecretCliError>()(
  'SecretCliError',
  {
    code: SecretCliFailureCode,
    cleanupConfirmed: Schema.Boolean,
    cause: Schema.optional(Schema.Defect()),
  },
  { dshxWireCode: 'secret-cli-error' },
) {
  override get message(): string {
    const message = failureMessages[this.code]
    return this.cleanupConfirmed ? message : `${message} Process cleanup could not be confirmed.`
  }
}

export interface SecretCliRequest {
  readonly args: readonly string[]
  readonly cwd: string | null
  readonly captureStdout: boolean
  readonly stdin?: string
}

const sessionVariable = (name: string) => Config.option(Config.NonEmptyString(name))

const sessionEnvironment = Effect.gen(function* () {
  const bitwardenSession = yield* sessionVariable('BW_SESSION')
  const sessionFile = yield* sessionVariable('SECRET_SESSION_FILE')
  return {
    ...Option.match(bitwardenSession, { onNone: () => ({}), onSome: value => ({ BW_SESSION: value }) }),
    ...Option.match(sessionFile, { onNone: () => ({}), onSome: value => ({ SECRET_SESSION_FILE: value }) }),
  }
}).pipe(Effect.orElseSucceed(() => ({})))

const failed = (cause: unknown) => new SecretCliError({ code: 'cli-failed', cleanupConfirmed: true, cause })

const spawnFailed = (cause: PlatformError.PlatformError) =>
  new SecretCliError({ code: cause.reason._tag === 'NotFound' ? 'cli-missing' : 'cli-failed', cleanupConfirmed: true, cause })

class OutputTooLarge extends Schema.TaggedError<OutputTooLarge>()('OutputTooLarge', { cause: Schema.optional(Schema.Defect()) }) {
  override get message(): string {
    return `Secret CLI output exceeded ${MAX_STDOUT_BYTES} bytes.`
  }
}

const boundedText = (stdout: Stream.Stream<Uint8Array, PlatformError.PlatformError>) =>
  Stream.runFoldEffect(
    stdout,
    (): ReadonlyArray<Uint8Array> => [],
    (chunks, chunk) => {
      const size = chunks.reduce((total, previous) => total + previous.byteLength, chunk.byteLength)
      return size > MAX_STDOUT_BYTES ? Effect.fail(new OutputTooLarge({})) : Effect.succeed([...chunks, chunk])
    },
  ).pipe(Effect.map(chunks => Buffer.concat(chunks).toString('utf8')))

/** The fixed secret CLI, run through DSH's managed process boundary with a deadline and bounded output. */
export class SecretCli extends Context.Service<SecretCli, { readonly run: (request: SecretCliRequest) => Effect.Effect<string, SecretCliError> }>()(
  '@dshfiles/secret-catalog/SecretCli',
) {
  static readonly make = (executable: string) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

      const execute = (request: SecretCliRequest) =>
        Effect.scoped(
          Effect.gen(function* () {
            const env = yield* sessionEnvironment
            const handle = yield* spawner
              .spawn(
                ChildProcess.make(executable, [...request.args], {
                  cwd: request.cwd ?? homedir(),
                  env,
                  stdin: request.stdin === undefined ? 'ignore' : Stream.encodeText(Stream.make(request.stdin)),
                  stdout: request.captureStdout ? 'pipe' : 'ignore',
                  stderr: 'ignore',
                }),
              )
              .pipe(Effect.mapError(spawnFailed))
            const settle = Effect.gen(function* () {
              const output = request.captureStdout ? yield* boundedText(handle.stdout) : ''
              const exitCode = yield* handle.exitCode
              if (exitCode !== 0) return yield* failed(undefined)
              return output
            }).pipe(Effect.catchTags({ PlatformError: cause => Effect.fail(spawnFailed(cause)), OutputTooLarge: cause => Effect.fail(failed(cause)) }))
            return yield* settle.pipe(
              Effect.catchTag('SecretCliError', error =>
                handle.kill().pipe(
                  Effect.as(true),
                  Effect.orElseSucceed(() => false),
                  Effect.flatMap(cleanupConfirmed => Effect.fail(new SecretCliError({ code: error.code, cleanupConfirmed, cause: error.cause }))),
                ),
              ),
            )
          }),
        ).pipe(
          Effect.timeoutOrElse({
            duration: COMMAND_TIMEOUT,
            orElse: () => Effect.fail(new SecretCliError({ code: 'cli-timeout', cleanupConfirmed: true })),
          }),
        )

      return SecretCli.of({
        run: request => {
          const verb = request.args[0] ?? ''
          return execute(request).pipe(
            Effect.withSpan(`secret ${verb}`.trim(), {
              kind: 'client',
              attributes: { ...commandAttributes({ executable: 'secret', args: request.args }), 'process.command.verb': verb },
            }),
          )
        },
      })
    })

  static readonly layer = Layer.effect(SecretCli, SecretCli.make('secret'))

  /** A secret CLI standing in for the real executable: `run` answers each request the Catalog sends. */
  static readonly layerTest = (run: (request: SecretCliRequest) => Effect.Effect<string, SecretCliError>) => Layer.succeed(SecretCli, SecretCli.of({ run }))
}
