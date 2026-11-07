import { Jj } from '@dshfiles/jj-cli'
import { Context, Effect, Layer, Schema } from 'effect'

/**
 * A jj read failed. `jj-missing`: no usable executable; `not-a-repository` / `jj-failed`: jj exited non-zero (its
 * stderr only classifies the failure and never leaves this module: jj prints credential-bearing remote URLs there);
 * `ambiguous-revision`: one name resolved to several revisions (a divergent change, a conflicted bookmark);
 * `unreadable`: the run timed out or its process could not be started or read.
 */
export class JjReadFailed extends Schema.TaggedError<JjReadFailed>()('JjReadFailed', {
  reason: Schema.Literals(['jj-missing', 'not-a-repository', 'jj-failed', 'ambiguous-revision', 'unreadable']),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Jujutsu could not read this workspace (${this.reason}).`
  }
}

export interface JjReadInput {
  readonly path: string
  readonly args: readonly string[]
  readonly outputLimit?: number | undefined
}

export interface JjReadOutput {
  readonly stdout: string
  readonly truncated: boolean
}

const isMissingRepository = (stderr: string): boolean => /no jj repo|not a jj repository|There is no jj repo/i.test(stderr)
const isAmbiguousRevision = (stderr: string): boolean => /is divergent|is ambiguous|resolved to more than one revision/i.test(stderr)

const failureReason = (stderr: string): 'not-a-repository' | 'ambiguous-revision' | 'jj-failed' => {
  if (isMissingRepository(stderr)) return 'not-a-repository'
  return isAmbiguousRevision(stderr) ? 'ambiguous-revision' : 'jj-failed'
}

/** Bounded jj reads in one workspace: output past `outputLimit` is cut and flagged instead of failing. */
export class ReviewJj extends Context.Service<ReviewJj, { readonly read: (input: JjReadInput) => Effect.Effect<JjReadOutput, JjReadFailed> }>()(
  '@dshfiles/pulls-review/ReviewJj',
) {
  static readonly layer = Layer.effect(
    ReviewJj,
    Effect.gen(function* () {
      const jj = yield* Jj
      return ReviewJj.of({
        read: input =>
          jj.run({ args: input.args, cwd: input.path, maxStdoutBytes: input.outputLimit ?? 1_200_000, onStdoutLimit: 'truncate' }).pipe(
            Effect.catchTags({
              JjSpawnFailed: cause =>
                Effect.fail(
                  new JjReadFailed({
                    reason: cause.reason === 'executable-not-found' || cause.reason === 'unsafe-executable' ? 'jj-missing' : 'unreadable',
                    cause,
                  }),
                ),
              JjTimedOut: cause => Effect.fail(new JjReadFailed({ reason: 'unreadable', cause })),
              JjOutputTruncated: cause => Effect.fail(new JjReadFailed({ reason: 'unreadable', cause })),
            }),
            Effect.flatMap(output =>
              output.exitCode === 0
                ? Effect.succeed({ stdout: output.stdout, truncated: output.stdoutTruncated })
                : Effect.fail(new JjReadFailed({ reason: failureReason(output.stderr) })),
            ),
          ),
      })
    }),
  )
}
