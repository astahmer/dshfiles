import { commandAttributes } from '@dshfiles/dshx/tracing'
import { Context, Duration, Effect, Layer, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'
import { GitFailed } from './errors.js'
import { Executables } from './executables-promise.js'

export interface GitOutput {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export interface GitCommand {
  /** Arguments after `git -c core.quotePath=false`. */
  readonly args: readonly string[]
  readonly cwd: string
  /** Extra variables merged over the Host environment, such as a scratch `GIT_INDEX_FILE`. */
  readonly env?: Readonly<Record<string, string>> | undefined
}

const TIMEOUT = Duration.minutes(2)
const KILL_GRACE = Duration.millis(1_500)
const MAX_STDOUT_BYTES = 512 * 1024
const MAX_STDERR_BYTES = 64 * 1024
const MAX_DETAIL_CHARACTERS = 400
const VALUE_FLAGS = ['-c', '-C', '-b', '-B', '-m', '--format', '--max-count']
/** Never prompt for credentials or an editor: a Host process has no terminal to answer them. */
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
  ).pipe(Effect.map(state => ({ text: new TextDecoder().decode(Buffer.concat(state.chunks)), truncated: state.truncated })))

const verbOf = (args: readonly string[]): string => args.find(arg => !arg.startsWith('-')) ?? ''

/**
 * Runs the git CLI for the git thread-workspace backend: the executable DSH's subprocess runtime resolves, stdin
 * ignored, bounded output, a two-minute timeout and one `git <verb>` client span per run (flag names and counts, never
 * values or paths).
 */
export class GitCli extends Context.Service<
  GitCli,
  {
    /** A non-zero exit is a value, so callers can read stderr (a failed rebase, a missing ref). */
    readonly run: (command: GitCommand) => Effect.Effect<GitOutput, GitFailed>
    /** Fails with `GitFailed` carrying the first stderr line on a non-zero exit. */
    readonly exec: (command: GitCommand) => Effect.Effect<string, GitFailed>
  }
>()('@dshfiles/jj-integration/GitCli') {
  static readonly layer = Layer.effect(
    GitCli,
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
      const executables = yield* Executables

      const run = (command: GitCommand): Effect.Effect<GitOutput, GitFailed> => {
        const verb = verbOf(command.args)
        const args = ['-c', 'core.quotePath=false', ...command.args]
        return Effect.gen(function* () {
          const git = yield* executables
            .resolve('git')
            .pipe(Effect.mapError(cause => new GitFailed({ detail: 'git was not found on this Host; install git.', cause })))
          const handle = yield* spawner
            .spawn(
              ChildProcess.make(git, args, {
                cwd: command.cwd,
                stdin: 'ignore',
                forceKillAfter: KILL_GRACE,
                extendEnv: true,
                env: { ...NON_INTERACTIVE, ...command.env },
              }),
            )
            .pipe(Effect.mapError(cause => new GitFailed({ detail: `git ${verb} could not be started.`, cause })))
          const [stdout, stderr, exitCode] = yield* Effect.all(
            [collectBounded(handle.stdout, MAX_STDOUT_BYTES), collectBounded(handle.stderr, MAX_STDERR_BYTES), handle.exitCode],
            { concurrency: 'unbounded' },
          ).pipe(Effect.mapError(cause => new GitFailed({ detail: `git ${verb}: reading its output failed.`, cause })))
          if (stdout.truncated)
            return yield* new GitFailed({ detail: `git ${verb} printed more than the safe output limit; refusing incomplete repository data.` })
          yield* Effect.annotateCurrentSpan({ 'process.exit.code': exitCode })
          return { exitCode, stdout: stdout.text, stderr: stderr.text } satisfies GitOutput
        }).pipe(
          Effect.scoped,
          Effect.timeoutOrElse({
            duration: TIMEOUT,
            orElse: () => Effect.fail(new GitFailed({ detail: `git ${verb} did not finish within ${String(Duration.toSeconds(TIMEOUT))} s and was stopped.` })),
          }),
          Effect.withSpan(`git ${verb}`.trim(), { kind: 'client', attributes: commandAttributes({ executable: 'git', args, valueFlags: VALUE_FLAGS }) }),
        )
      }

      const exec = (command: GitCommand) =>
        Effect.flatMap(run(command), output =>
          output.exitCode === 0
            ? Effect.succeed(output.stdout)
            : Effect.fail(
                new GitFailed({
                  detail: `git ${verbOf(command.args)}: ${output.stderr.trim().slice(0, MAX_DETAIL_CHARACTERS) || `exited with code ${String(output.exitCode)}`}`,
                }),
              ),
        )

      return GitCli.of({ run, exec })
    }),
  )
}
