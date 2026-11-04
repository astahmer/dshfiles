import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { commandAttributes } from '@dshfiles/dshx/tracing'
import { Config, Context, Duration, Effect, FileSystem, Layer, Option, type PlatformError, Schema, Stream } from 'effect'
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

/** Only HOME, BW_SESSION and SECRET_SESSION_FILE reach the CLI. */
type SessionEnvironment = Readonly<Record<string, string>>

const sessionEnvironment = Effect.gen(function* (): Effect.fn.Return<SessionEnvironment, Config.ConfigError> {
  const home = yield* sessionVariable('HOME')
  const bitwardenSession = yield* sessionVariable('BW_SESSION')
  const sessionFile = yield* sessionVariable('SECRET_SESSION_FILE')
  return {
    ...Option.match(home, { onNone: () => ({}), onSome: value => ({ HOME: value }) }),
    ...Option.match(bitwardenSession, { onNone: () => ({}), onSome: value => ({ BW_SESSION: value }) }),
    ...Option.match(sessionFile, { onNone: () => ({}), onSome: value => ({ SECRET_SESSION_FILE: value }) }),
  }
}).pipe(Effect.orElseSucceed((): SessionEnvironment => ({})))

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

export interface SecretCliShape {
  readonly run: (request: SecretCliRequest) => Effect.Effect<string, SecretCliError>
  /**
   * What `print` for this folder depends on, as an opaque key: the session identity (hashed, never the token) and the
   * stat of every config file the CLI reads for it. Equal keys mean an unchanged answer; it never fails.
   */
  readonly revision: (folder: string | null) => Effect.Effect<string>
}

const hashed = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)

/** The fixed secret CLI, run through DSH's managed process boundary with a deadline and bounded output. */
export class SecretCli extends Context.Service<SecretCli, SecretCliShape>()('@dshfiles/secret-catalog/SecretCli') {
  static readonly make = (executable: string) =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const fs = yield* FileSystem.FileSystem

      const stamp = (path: string) =>
        fs.stat(path).pipe(
          Effect.map(
            info =>
              `${Option.getOrElse(
                Option.map(info.mtime, date => date.getTime()),
                () => 0,
              )}:${info.size}:${info.ino ?? 0}`,
          ),
          Effect.orElseSucceed(() => 'absent'),
        )

      const revision = (folder: string | null) =>
        Effect.gen(function* () {
          const env = yield* sessionEnvironment
          const sessionFile = env['SECRET_SESSION_FILE']
          const home = env['HOME'] ?? homedir()
          const files = [
            join(home, '.config', 'secret', 'config.json'),
            ...(sessionFile === undefined ? [] : [sessionFile]),
            ...(folder === null ? [] : [join(folder, '.secret.json'), join(folder, '.secret.local.json')]),
          ]
          const stamps = yield* Effect.forEach(files, stamp, { concurrency: 'unbounded' })
          return hashed(JSON.stringify([home, env['BW_SESSION'] ?? '', files, stamps]))
        })

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
        revision,
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
  static readonly layerTest = (
    run: (request: SecretCliRequest) => Effect.Effect<string, SecretCliError>,
    revision: (folder: string | null) => Effect.Effect<string> = () => Effect.succeed('fixed'),
  ) => Layer.succeed(SecretCli, SecretCli.of({ run, revision }))
}
