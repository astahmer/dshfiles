import { JjArgs, JjCommandFailed, JjViewReads, redactJjStderr } from '@dshfiles/jj-cli'
import { Context, Duration, Effect, Layer } from 'effect'
import { JujutsuCommandFailed, JujutsuTimedOut, JujutsuUnavailable, RepositoryMoved, type JjRunError } from './errors.js'
import { RepositoryIdentity } from './repository-identity.js'

const MAX_OUTPUT = 1_160_000
const COMMAND_TIMEOUT = Duration.seconds(30)

export interface JjRunOptions {
  readonly outputLimit?: number | undefined
  readonly timeout?: Duration.Input | undefined
}

/** stdout of a zero exit; `truncated` when it reached `outputLimit` and was cut there. */
export interface JjRunResult {
  readonly stdout: string
  readonly truncated: boolean
}

/** One jj invocation bound to a directory and its identity. */
export type JjRun = (args: readonly string[], options?: JjRunOptions) => Effect.Effect<JjRunResult, JjRunError>

interface JjRunInput extends JjRunOptions {
  readonly cwd: string
  /** The directory's `dev:ino`, checked before the command starts and again after it exits zero. */
  readonly expectedIdentity?: string | undefined
  readonly args: readonly string[]
}

/**
 * Runs jj for the panel and the composer through the shared jj-cli runner: view reads are answered per operation
 * head, a non-zero exit fails with its exit code only (stderr stays in the redacted cause), and the working
 * directory must keep its identity across the run.
 */
export class JujutsuCommands extends Context.Service<
  JujutsuCommands,
  {
    readonly run: (input: JjRunInput) => Effect.Effect<JjRunResult, JjRunError>
    readonly at: (input: { readonly cwd: string; readonly expectedIdentity?: string | undefined }) => JjRun
  }
>()('@dshfiles/jujutsu/JujutsuCommands') {
  static readonly layer = Layer.effect(
    JujutsuCommands,
    Effect.gen(function* () {
      const viewReads = yield* JjViewReads
      const identity = yield* RepositoryIdentity

      const currentIdentity = (cwd: string) => identity.of(cwd).pipe(Effect.catchTag('PlatformError', cause => Effect.fail(new JujutsuUnavailable({ cause }))))

      const run = Effect.fnUntraced(function* (input: JjRunInput) {
        const before = yield* currentIdentity(input.cwd)
        if (input.expectedIdentity !== undefined && before !== input.expectedIdentity) return yield* new RepositoryMoved({ reason: 'before-command' })
        const output = yield* viewReads
          .read({
            args: input.args,
            cwd: input.cwd,
            maxStdoutBytes: input.outputLimit ?? MAX_OUTPUT,
            onStdoutLimit: 'truncate',
            timeout: input.timeout ?? COMMAND_TIMEOUT,
          })
          .pipe(
            Effect.catchTags({
              JjTimedOut: cause => Effect.fail(new JujutsuTimedOut({ cause })),
              JjSpawnFailed: cause => Effect.fail(new JujutsuUnavailable({ cause })),
              JjOutputTruncated: cause => Effect.fail(new JujutsuUnavailable({ cause })),
            }),
          )
        if (output.exitCode !== 0) {
          return yield* new JujutsuCommandFailed({
            exitCode: output.exitCode,
            cause: new JjCommandFailed({
              verb: JjArgs.verb(input.args),
              args: JjArgs.redact(input.args),
              exitCode: output.exitCode,
              stderr: redactJjStderr(output.stderr),
              stderrTruncated: output.stderrTruncated,
            }),
          })
        }
        const after = yield* currentIdentity(input.cwd)
        if (input.expectedIdentity !== undefined && after !== input.expectedIdentity) return yield* new RepositoryMoved({ reason: 'during-command' })
        return { stdout: output.stdout, truncated: output.stdoutTruncated }
      })

      const at =
        (location: { readonly cwd: string; readonly expectedIdentity?: string | undefined }): JjRun =>
        (args, options) =>
          run({ ...location, ...options, args })

      return JujutsuCommands.of({ run, at })
    }),
  )
}
