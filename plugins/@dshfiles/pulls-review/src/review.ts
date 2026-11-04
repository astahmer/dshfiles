import { Context, Effect, FileSystem, Layer, Schema } from 'effect'
import { MAX_PATCH_CHARS, type ReviewFailureReason, type ReviewResult } from './api.js'
import { ReviewJj } from './jj.js'
import { groupPatch } from './scopes.js'

/** Base bookmarks tried in order when the caller does not name one. */
const BASE_CANDIDATES = ['main', 'master', 'trunk', 'main@origin', 'master@origin', 'trunk@origin'] as const
const HEAD_REVISION = '@'
const REVISION_TEMPLATE = 'commit_id.short()'

/** The review could not run at all: jj stopped or could not be read, or the patch could not be grouped. */
export class PullsReviewOperationError extends Schema.TaggedError<PullsReviewOperationError>()(
  'PullsReviewOperationError',
  { operation: Schema.Literals(['review', 'summarize']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'pulls-review-operation-error' },
) {
  override get message(): string {
    return this.operation === 'review' ? 'Jujutsu could not read this workspace.' : 'The model call failed; the thread model may be unavailable.'
  }
}

export interface ReviewInput {
  readonly path: string
  readonly base?: string | undefined
  readonly fromChangeId?: string | undefined
  readonly toChangeId?: string | undefined
}

const failure = (path: string, reason: ReviewFailureReason, message: string): ReviewResult => ({ status: 'failed', path, reason, message })

/** The argv the Host builds for a review; exported so a test can drive the same one. */
const revisionArgs = (revision: string): readonly string[] => ['log', '-r', revision, '--no-graph', '-T', REVISION_TEMPLATE]

const changeIdRevset = (changeId: string): string => `change_id(${JSON.stringify(changeId)})`

const diffArgs = (base: string, head = HEAD_REVISION): readonly string[] => ['diff', '--git', '--from', base, '--to', head]

/** Read one thread workspace's changes since its base bookmark, or an exact saved range, and group them. */
export class ReviewWorkspace extends Context.Service<
  ReviewWorkspace,
  { readonly review: (input: ReviewInput) => Effect.Effect<ReviewResult, PullsReviewOperationError> }
>()('@dshfiles/pulls-review/ReviewWorkspace') {
  static readonly layer = Layer.effect(
    ReviewWorkspace,
    Effect.gen(function* () {
      const jj = yield* ReviewJj
      const fileSystem = yield* FileSystem.FileSystem

      const isDirectory = (path: string) =>
        fileSystem.stat(path).pipe(
          Effect.map(info => info.type === 'Directory'),
          Effect.orElseSucceed(() => false),
        )

      /** An unknown revision just means this candidate is absent; a workspace that is not a jj repository is not a missing base. */
      const resolves = (input: { readonly path: string; readonly revision: string }) =>
        jj.read({ path: input.path, args: revisionArgs(input.revision), outputLimit: 4_096 }).pipe(
          Effect.map(output => output.stdout.trim().length > 0),
          Effect.catchIf(
            error => error.reason === 'jj-failed',
            () => Effect.succeed(false),
          ),
        )

      const resolveBase = Effect.fn('review base resolve')(function* (input: { readonly path: string; readonly requested?: string | undefined }) {
        if (input.requested !== undefined && input.requested.length > 0) {
          return (yield* resolves({ path: input.path, revision: input.requested })) ? input.requested : undefined
        }
        for (const candidate of BASE_CANDIDATES) {
          if (yield* resolves({ path: input.path, revision: candidate })) return candidate
        }
        return undefined
      })

      const readRange = Effect.fn('review range read')(function* (input: ReviewInput & { readonly exactRange: boolean }) {
        const base = input.exactRange ? changeIdRevset(input.fromChangeId ?? '') : yield* resolveBase({ path: input.path, requested: input.base })
        if (base === undefined) return failure(input.path, 'no-base', `No base bookmark found; expected one of ${BASE_CANDIDATES.join(', ')}.`)
        if (input.exactRange && !(yield* resolves({ path: input.path, revision: base })))
          return failure(input.path, 'no-base', 'The saved base change ID no longer resolves in this repository.')
        const headRevision = input.exactRange ? changeIdRevset(input.toChangeId ?? '') : HEAD_REVISION
        const head = (yield* jj.read({ path: input.path, args: revisionArgs(headRevision), outputLimit: 4_096 })).stdout.trim()
        if (head.length === 0) return failure(input.path, 'jj-failed', 'The working-copy revision could not be read.')
        const diff = yield* jj.read({ path: input.path, args: diffArgs(base, headRevision), outputLimit: MAX_PATCH_CHARS })
        const baseLabel = input.exactRange ? (input.fromChangeId ?? '') : base
        const range = `${baseLabel}..${input.exactRange ? (input.toChangeId ?? '') : HEAD_REVISION}`
        const grouped = yield* groupPatch({ patch: diff.stdout, title: range })
        return {
          status: 'ok',
          path: input.path,
          base: baseLabel,
          head,
          range,
          patch: diff.stdout,
          truncated: diff.truncated || grouped.clipped,
          fileCount: grouped.fileCount,
          additions: grouped.additions,
          deletions: grouped.deletions,
          files: [...grouped.files],
          scopes: [...grouped.scopes],
        } satisfies ReviewResult
      })

      const review = Effect.fn('pulls-review review')(function* (input: ReviewInput) {
        const exactRange = input.fromChangeId !== undefined && input.toChangeId !== undefined
        if ((input.fromChangeId === undefined) !== (input.toChangeId === undefined)) {
          return failure(input.path, 'jj-failed', 'Both saved change IDs are required for an exact review range.')
        }
        if (!exactRange && !(yield* isDirectory(input.path))) return failure(input.path, 'workspace-missing', 'That thread workspace is no longer on disk.')
        return yield* readRange({ ...input, exactRange }).pipe(
          Effect.catchTags({
            JjReadFailed: error => {
              if (error.reason === 'jj-missing') return Effect.succeed(failure(input.path, 'jj-missing', 'Jujutsu (jj) is not available to the Host.'))
              if (error.reason === 'not-a-repository')
                return Effect.succeed(failure(input.path, 'not-a-repository', 'That thread workspace is not a Jujutsu repository.'))
              if (error.reason === 'jj-failed') return Effect.succeed(failure(input.path, 'jj-failed', 'Jujutsu could not read this workspace.'))
              return Effect.fail(new PullsReviewOperationError({ operation: 'review', cause: error }))
            },
            PatchGroupingFailed: error => Effect.fail(new PullsReviewOperationError({ operation: 'review', cause: error })),
          }),
        )
      })

      return ReviewWorkspace.of({ review })
    }),
  )
}

export class ReviewWorkspaceModel {
  static readonly revisionArgs = revisionArgs
  static readonly diffArgs = diffArgs
}
