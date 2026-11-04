import { Context, Duration, Effect, Layer, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { GitCommandFailed, GitRunFailed, type GitExecError } from './errors.js'
import { GitArgs } from './git-args.js'
import { redactGitStderr } from './stderr-redaction.js'

export interface GitCommand {
  /** Arguments after `git -c core.quotePath=false`. */
  readonly args: readonly string[]
  readonly cwd: string
  /** Variables merged over the spawner's environment, such as a scratch `GIT_INDEX_FILE` or a commit identity. */
  readonly env?: Readonly<Record<string, string>> | undefined
  readonly timeout?: Duration.Input | undefined
  readonly maxStdoutBytes?: number | undefined
  /** `fail` (default) fails as `output-truncated`; `truncate` keeps the first bytes and sets `stdoutTruncated`. */
  readonly onStdoutLimit?: 'fail' | 'truncate' | undefined
}

export interface GitOutput {
  readonly exitCode: number
  readonly stdout: string
  readonly stdoutTruncated: boolean
  /** Raw stderr; `GitCommandFailed.stderr` is the redacted copy that may leave the Host. */
  readonly stderr: string
}

export interface GitOptions {
  /**
   * The executable. Defaults to the bare `git`: DSH's spawner resolves a bare name through its subprocess runtime, and a
   * plain Node spawner looks it up on `PATH`.
   */
  readonly executable?: string | undefined
  readonly timeout?: Duration.Input | undefined
  readonly maxStdoutBytes?: number | undefined
  readonly maxStderrBytes?: number | undefined
}

const DEFAULT_TIMEOUT = Duration.minutes(2)
const DEFAULT_MAX_STDOUT_BYTES = 512 * 1024
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024
const KILL_GRACE = Duration.millis(1_500)
/** Never prompt for credentials, an editor or a pager: a Host process has no terminal to answer them. */
const NON_INTERACTIVE = { GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', GIT_PAGER: 'cat' }

const collectBounded = <E>(stream: Stream.Stream<Uint8Array, E>, maxBytes: number) =>
  Stream.runFold(
    stream,
    () => ({ chunks: new Array<Uint8Array>(), bytes: 0, truncated: false }),
    (state, chunk) => {
      const room = maxBytes - state.bytes
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

/**
 * Runs the git CLI for Host plugins: stdin ignored, a non-interactive environment, bounded output, a timeout that kills
 * the process, and one `git <verb>` client span per run with value-free attributes and the exit code.
 */
export class Git extends Context.Service<
  Git,
  {
    /** A non-zero exit is a value, so callers can read stderr (a failed rebase, a missing ref). */
    readonly run: (command: GitCommand) => Effect.Effect<GitOutput, GitRunFailed>
    /** Stdout on exit 0, otherwise `GitCommandFailed` with redacted arguments and stderr. */
    readonly exec: (command: GitCommand) => Effect.Effect<string, GitExecError>
  }
>()('@dshfiles/git-cli/Git') {
  static readonly make = Effect.fnUntraced(function* (options: GitOptions) {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const executable = options.executable ?? 'git'
    const maxStderrBytes = options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES

    const bounded = (command: GitCommand): Effect.Effect<GitOutput, GitRunFailed> => {
      const args = ['-c', 'core.quotePath=false', ...command.args]
      const verb = GitArgs.verb(command.args)
      const timeout = Duration.fromInputUnsafe(command.timeout ?? options.timeout ?? DEFAULT_TIMEOUT)
      const maxStdoutBytes = command.maxStdoutBytes ?? options.maxStdoutBytes ?? DEFAULT_MAX_STDOUT_BYTES
      return Effect.gen(function* () {
        const handle = yield* spawner
          .spawn(
            ChildProcess.make(executable, args, {
              cwd: command.cwd,
              stdin: 'ignore',
              forceKillAfter: KILL_GRACE,
              extendEnv: true,
              env: { ...NON_INTERACTIVE, ...command.env },
            }),
          )
          .pipe(Effect.mapError(cause => new GitRunFailed({ verb, reason: 'spawn-failed', cause })))
        const [stdout, stderr, exitCode] = yield* Effect.all(
          [collectBounded(handle.stdout, maxStdoutBytes), collectBounded(handle.stderr, maxStderrBytes), handle.exitCode],
          { concurrency: 'unbounded' },
        ).pipe(Effect.mapError(cause => new GitRunFailed({ verb, reason: 'output-read-failed', cause })))
        yield* Effect.annotateCurrentSpan({ 'process.exit.code': exitCode })
        if (stdout.truncated && command.onStdoutLimit !== 'truncate') return yield* new GitRunFailed({ verb, reason: 'output-truncated' })
        return { exitCode, stdout: stdout.text, stdoutTruncated: stdout.truncated, stderr: stderr.text } satisfies GitOutput
      }).pipe(Effect.scoped, Effect.timeoutOrElse({ duration: timeout, orElse: () => Effect.fail(new GitRunFailed({ verb, reason: 'timed-out' })) }))
    }

    /** One span per run, around exec's exit check too, so a failed exec ends its span as an error. */
    const traced = <A, E>(command: GitCommand, effect: Effect.Effect<A, E>) =>
      effect.pipe(
        Effect.withSpan(GitArgs.spanName(command.args), {
          kind: 'client',
          attributes: GitArgs.attributes(['-c', 'core.quotePath=false', ...command.args]),
        }),
      )

    const run = (command: GitCommand): Effect.Effect<GitOutput, GitRunFailed> => traced(command, bounded(command))

    const exec = (command: GitCommand): Effect.Effect<string, GitExecError> =>
      traced(
        command,
        Effect.flatMap(bounded(command), output =>
          output.exitCode === 0
            ? Effect.succeed(output.stdout)
            : Effect.fail(
                new GitCommandFailed({
                  verb: GitArgs.verb(command.args),
                  args: GitArgs.redact(command.args),
                  exitCode: output.exitCode,
                  stderr: redactGitStderr(output.stderr),
                }),
              ),
        ),
      )

    return Git.of({ run, exec })
  })

  static readonly layer = Layer.effect(Git, Git.make({}))

  static readonly layerWith = (options: GitOptions) => Layer.effect(Git, Git.make(options))
}
