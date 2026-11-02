import { Cache, Config, Context, Duration, Effect, Exit, FileSystem, Layer, Option, Path, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { JjArgs } from './jj-args.ts'
import { JjCommandFailed, JjOutputTruncated, JjSpawnFailed, JjTimedOut, type JjExecError, type JjRunError } from './errors.ts'
import { redactJjStderr } from './stderr-redaction.ts'

export interface JjCommand {
  /** Arguments after `jj --color=never --no-pager`. */
  readonly args: readonly string[]
  readonly cwd: string
  readonly timeout?: Duration.Input | undefined
  readonly maxStdoutBytes?: number | undefined
  /** `fail` (default) fails with `JjOutputTruncated`; `truncate` keeps the first bytes and sets `stdoutTruncated`. */
  readonly onStdoutLimit?: 'fail' | 'truncate' | undefined
}

export interface JjOutput {
  readonly exitCode: number
  readonly stdout: string
  readonly stdoutTruncated: boolean
  /** Raw stderr; `JjCommandFailed.stderr` is the redacted copy that may leave the Host. */
  readonly stderr: string
  readonly stderrTruncated: boolean
}

export interface JjOptions {
  /** Absolute jj path; resolved from `PATH` once when omitted. */
  readonly executable?: string | undefined
  readonly timeout?: Duration.Input | undefined
  readonly maxStdoutBytes?: number | undefined
  readonly maxStderrBytes?: number | undefined
}

const DEFAULT_TIMEOUT = Duration.seconds(30)
const DEFAULT_MAX_STDOUT_BYTES = 1_160_000
const DEFAULT_MAX_STDERR_BYTES = 64_000
const KILL_GRACE = Duration.millis(1_500)

interface CollectedText {
  readonly text: string
  readonly truncated: boolean
}

const collectBounded = <E>(input: { readonly stream: Stream.Stream<Uint8Array, E>; readonly maxBytes: number }): Effect.Effect<CollectedText, E> =>
  Stream.runFold(
    input.stream,
    () => ({ chunks: new Array<Uint8Array>(), bytes: 0, truncated: false }),
    (state, chunk) => {
      const room = input.maxBytes - state.bytes
      if (room <= 0) return chunk.byteLength === 0 ? state : { ...state, truncated: true }
      const kept = chunk.byteLength > room ? chunk.subarray(0, room) : chunk
      state.chunks.push(kept)
      return { chunks: state.chunks, bytes: state.bytes + kept.byteLength, truncated: state.truncated || kept !== chunk }
    },
  ).pipe(
    Effect.map(state => {
      const joined = new Uint8Array(state.bytes)
      let offset = 0
      for (const chunk of state.chunks) {
        joined.set(chunk, offset)
        offset += chunk.byteLength
      }
      return { text: new TextDecoder().decode(joined), truncated: state.truncated }
    }),
  )

const isSafeExecutable = (input: { readonly path: Path.Path; readonly executable: string }): boolean =>
  input.path.isAbsolute(input.executable) && !input.executable.includes('\0')

/** Runs the jj CLI with fixed global flags, bounded output, a timeout and a `jj <verb>` client span per run. */
export class Jj extends Context.Service<
  Jj,
  {
    /** Run jj; a non-zero exit is returned as a value so callers can read its stderr. */
    readonly run: (command: JjCommand) => Effect.Effect<JjOutput, JjRunError>
    /** Run jj and fail with `JjCommandFailed` (redacted args and stderr) on a non-zero exit. */
    readonly exec: (command: JjCommand) => Effect.Effect<JjOutput, JjExecError>
  }
>()('@dshfiles/jj-cli/Jj') {
  static readonly make = Effect.fnUntraced(function* (options: JjOptions) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const fileSystem = yield* FileSystem.FileSystem
    const path = yield* Path.Path

    const isExecutableFile = (candidate: string) =>
      fileSystem.stat(candidate).pipe(
        Effect.map(info => info.type === 'File' && (info.mode & 0o111) !== 0),
        Effect.orElseSucceed(() => false),
      )

    const findOnPath = Effect.gen(function* () {
      const searchPath = yield* Config.String('PATH').pipe(Config.withDefault(''))
      const candidates = searchPath
        .split(path.sep === '\\' ? ';' : ':')
        .filter(directory => directory.length > 0 && path.isAbsolute(directory))
        .map(directory => path.join(directory, 'jj'))
      const found = yield* Effect.findFirst(candidates, isExecutableFile)
      if (Option.isNone(found)) return yield* new JjSpawnFailed({ verb: '', reason: 'executable-not-found' })
      return found.value
    }).pipe(Effect.catchTag('ConfigError', cause => Effect.fail(new JjSpawnFailed({ verb: '', reason: 'executable-not-found', cause }))))

    const resolveExecutable = Effect.gen(function* () {
      const executable = options.executable ?? (yield* findOnPath)
      if (!isSafeExecutable({ path, executable })) return yield* new JjSpawnFailed({ verb: '', reason: 'unsafe-executable' })
      return executable
    })

    const executableCache = yield* Cache.makeWith(() => resolveExecutable, {
      capacity: 1,
      timeToLive: exit => (Exit.isSuccess(exit) ? Duration.infinity : Duration.zero),
    })

    const maxStderrBytes = options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES

    const spawnAndCollect = Effect.fnUntraced(function* (input: { readonly command: JjCommand; readonly verb: string }) {
      const executable = yield* Cache.get(executableCache, undefined).pipe(
        Effect.mapError(failure => new JjSpawnFailed({ verb: input.verb, reason: failure.reason, cause: failure.cause })),
      )
      const handle = yield* spawner
        .spawn(
          ChildProcess.make(executable, ['--color=never', '--no-pager', ...input.command.args], {
            cwd: input.command.cwd,
            stdin: 'ignore',
            forceKillAfter: KILL_GRACE,
          }),
        )
        .pipe(Effect.mapError(cause => new JjSpawnFailed({ verb: input.verb, reason: 'spawn-failed', cause })))
      const maxStdoutBytes = input.command.maxStdoutBytes ?? options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES
      const [stdout, stderr, exitCode] = yield* Effect.all(
        [
          collectBounded({ stream: handle.stdout, maxBytes: maxStdoutBytes }),
          collectBounded({ stream: handle.stderr, maxBytes: maxStderrBytes }),
          handle.exitCode,
        ],
        { concurrency: 'unbounded' },
      ).pipe(Effect.mapError(cause => new JjSpawnFailed({ verb: input.verb, reason: 'output-read-failed', cause })))
      if (stdout.truncated && input.command.onStdoutLimit !== 'truncate') return yield* new JjOutputTruncated({ verb: input.verb, maxBytes: maxStdoutBytes })
      return {
        exitCode,
        stdout: stdout.text,
        stdoutTruncated: stdout.truncated,
        stderr: stderr.text,
        stderrTruncated: stderr.truncated,
      } satisfies JjOutput
    })

    const bounded = (command: JjCommand) => {
      const verb = JjArgs.verb(command.args)
      const timeout = Duration.fromInputUnsafe(command.timeout ?? options.timeout ?? DEFAULT_TIMEOUT)
      return spawnAndCollect({ command, verb }).pipe(
        Effect.scoped,
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () => Effect.fail(new JjTimedOut({ verb, timeoutMillis: Duration.toMillis(timeout) })),
        }),
        Effect.tap(output => Effect.annotateCurrentSpan({ 'process.exit.code': output.exitCode, 'jj.output.truncated': output.stdoutTruncated })),
      )
    }

    const failOnNonZeroExit = (input: { readonly command: JjCommand; readonly output: JjOutput }) =>
      input.output.exitCode === 0
        ? Effect.succeed(input.output)
        : Effect.fail(
            new JjCommandFailed({
              verb: JjArgs.verb(input.command.args),
              args: JjArgs.redact(input.command.args),
              exitCode: input.output.exitCode,
              stderr: redactJjStderr(input.output.stderr),
              stderrTruncated: input.output.stderrTruncated,
            }),
          )

    const traced = <A, E>(input: { readonly command: JjCommand; readonly effect: Effect.Effect<A, E> }) =>
      input.effect.pipe(Effect.withSpan(JjArgs.spanName(input.command.args), { kind: 'client', attributes: JjArgs.attributes(input.command.args) }))

    return Jj.of({
      run: command => traced({ command, effect: bounded(command) }),
      exec: command => traced({ command, effect: bounded(command).pipe(Effect.flatMap(output => failOnNonZeroExit({ command, output }))) }),
    })
  })

  static readonly layer = Layer.effect(Jj, Jj.make({}))

  static readonly layerWith = (options: JjOptions) => Layer.effect(Jj, Jj.make(options))
}
