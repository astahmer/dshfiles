import { VcsDetector } from '@dshfiles/vcs-provider-port/detect'
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from 'effect'
import {
  MAX_PATCH_CHARS,
  type ReviewFailureReason,
  type ReviewResult,
  type RevisionReview,
  type RevisionsReviewInput,
  type RevisionsReviewResult,
} from './api.js'
import { ReviewGit } from './git.js'
import { type JjReadFailed, ReviewJj } from './jj.js'
import type { ReviewBackend } from './review-backend.js'
import { RevisionReviewModel, type ResolvedRevision } from './revision-review.js'
import { groupPatch } from './scopes.js'

/** Base bookmarks tried in order when the caller does not name one. */
const BASE_CANDIDATES = ['main', 'master', 'trunk', 'main@origin', 'master@origin', 'trunk@origin'] as const
const HEAD_REVISION = '@'
const REVISION_TEMPLATE = 'commit_id.short()'

/** The review could not run at all: the VCS stopped or could not be read, or the patch could not be grouped. */
export class PullsReviewOperationError extends Schema.TaggedError<PullsReviewOperationError>()(
  'PullsReviewOperationError',
  { operation: Schema.Literals(['review', 'summarize']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'pulls-review-operation-error' },
) {
  override get message(): string {
    return this.operation === 'review'
      ? 'The version-control system could not read this workspace.'
      : 'The model call failed; the thread model may be unavailable.'
  }
}

export interface ReviewInput {
  readonly path: string
  readonly base?: string | undefined
  readonly fromChangeId?: string | undefined
  readonly toChangeId?: string | undefined
}

type UnresolvedRevision = Extract<RevisionsReviewResult, { readonly status: 'ok' }>['unresolved'][number]

const failure = (path: string, reason: ReviewFailureReason, message: string): ReviewResult => ({ status: 'failed', path, reason, message })

/** The argv the Host builds for a review; exported so a test can drive the same one. */
const revisionArgs = (revision: string): readonly string[] => ['log', '-r', revision, '--no-graph', '-T', REVISION_TEMPLATE]

const changeIdRevset = (changeId: string): string => `change_id(${JSON.stringify(changeId)})`

const diffArgs = (base: string, head = HEAD_REVISION): readonly string[] => ['diff', '--git', '--from', base, '--to', head]

/** The jj adapter of the review port, over the bounded `ReviewJj` reads. */
const jjBackend = (jj: ReviewJj['Service']): ReviewBackend => ({
  vcs: 'jj',
  baseCandidates: BASE_CANDIDATES,
  liveHead: HEAD_REVISION,
  savedRevision: changeIdRevset,
  // An unknown revision just means this candidate is absent; a workspace that is not a jj repository is not a missing base.
  resolves: input =>
    jj.read({ path: input.path, args: revisionArgs(input.revision), outputLimit: 4_096 }).pipe(
      Effect.map(output => output.stdout.trim().length > 0),
      Effect.catchIf(
        error => error.reason === 'jj-failed' || error.reason === 'ambiguous-revision',
        () => Effect.succeed(false),
      ),
    ),
  commit: input => Effect.map(jj.read({ path: input.path, args: revisionArgs(input.revision), outputLimit: 4_096 }), output => output.stdout.trim()),
  diff: input => jj.read({ path: input.path, args: diffArgs(input.base, input.head), outputLimit: input.limit }),
  messages: {
    missing: 'Jujutsu (jj) is not available to the Host.',
    notARepository: 'That thread workspace is not a Jujutsu repository.',
    failed: 'Jujutsu could not read this workspace.',
  },
})

/**
 * Read one thread workspace's changes since its base bookmark, or an exact saved range, and group them. A path in a
 * git-only repository goes to the `ReviewGit` adapter when it is provided; every other path to jj.
 */
export class ReviewWorkspace extends Context.Service<
  ReviewWorkspace,
  {
    readonly review: (input: ReviewInput) => Effect.Effect<ReviewResult, PullsReviewOperationError>
    readonly reviewRevisions: (input: RevisionsReviewInput) => Effect.Effect<RevisionsReviewResult, PullsReviewOperationError>
  }
>()('@dshfiles/pulls-review/ReviewWorkspace') {
  static readonly layer = Layer.effect(
    ReviewWorkspace,
    Effect.gen(function* () {
      const jjReads = yield* ReviewJj
      const jj = jjBackend(jjReads)
      const git = yield* Effect.serviceOption(ReviewGit)
      const detector = yield* VcsDetector
      const fileSystem = yield* FileSystem.FileSystem

      const backendFor = (path: string) => Effect.map(detector.detect(path), kind => (kind === 'git' && Option.isSome(git) ? git.value : jj))

      const isDirectory = (path: string) =>
        fileSystem.stat(path).pipe(
          Effect.map(info => info.type === 'Directory'),
          Effect.orElseSucceed(() => false),
        )

      const resolveBase = Effect.fn('review base resolve')(function* (input: {
        readonly backend: ReviewBackend
        readonly path: string
        readonly requested?: string | undefined
      }) {
        if (input.requested !== undefined && input.requested.length > 0) {
          return (yield* input.backend.resolves({ path: input.path, revision: input.requested })) ? input.requested : undefined
        }
        for (const candidate of input.backend.baseCandidates) {
          if (yield* input.backend.resolves({ path: input.path, revision: candidate })) return candidate
        }
        return undefined
      })

      const readRange = Effect.fn('review range read')(function* (input: ReviewInput & { readonly exactRange: boolean; readonly backend: ReviewBackend }) {
        const backend = input.backend
        const base = input.exactRange
          ? backend.savedRevision(input.fromChangeId ?? '')
          : yield* resolveBase({ backend, path: input.path, requested: input.base })
        if (base === undefined) return failure(input.path, 'no-base', `No base bookmark found; expected one of ${backend.baseCandidates.join(', ')}.`)
        if (input.exactRange && !(yield* backend.resolves({ path: input.path, revision: base })))
          return failure(input.path, 'no-base', 'The saved base change ID no longer resolves in this repository.')
        const headRevision = input.exactRange ? backend.savedRevision(input.toChangeId ?? '') : backend.liveHead
        const head = yield* backend.commit({ path: input.path, revision: headRevision })
        if (head.length === 0) return failure(input.path, 'jj-failed', 'The working-copy revision could not be read.')
        const diff = yield* backend.diff({ path: input.path, base, head: headRevision, limit: MAX_PATCH_CHARS })
        const baseLabel = input.exactRange ? (input.fromChangeId ?? '') : base
        const range = `${baseLabel}..${input.exactRange ? (input.toChangeId ?? '') : backend.liveHead}`
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
        const backend = yield* backendFor(input.path)
        return yield* readRange({ ...input, exactRange, backend }).pipe(
          Effect.catchTags({
            JjReadFailed: error => {
              if (error.reason === 'jj-missing') return Effect.succeed(failure(input.path, 'jj-missing', backend.messages.missing))
              if (error.reason === 'not-a-repository') return Effect.succeed(failure(input.path, 'not-a-repository', backend.messages.notARepository))
              if (error.reason === 'jj-failed' || error.reason === 'ambiguous-revision') {
                return Effect.succeed(failure(input.path, 'jj-failed', backend.messages.failed))
              }
              return Effect.fail(new PullsReviewOperationError({ operation: 'review', cause: error }))
            },
            PatchGroupingFailed: error => Effect.fail(new PullsReviewOperationError({ operation: 'review', cause: error })),
          }),
        )
      })

      /** One requested id: the revision it names now, or why the selection has to go on without it. */
      const resolveRevision = (input: { readonly path: string; readonly revision: string }) =>
        jjReads.read({ path: input.path, args: RevisionReviewModel.describeArgs(input.revision), outputLimit: 8_192 }).pipe(
          Effect.map((output): UnresolvedRevision | ResolvedRevision => {
            const resolved = RevisionReviewModel.decodeResolved(input.revision, output.stdout)
            return (
              resolved ?? {
                revision: input.revision,
                reason: 'missing',
                message: 'jj returned no single revision for this id. Refresh the graph and select it again.',
              }
            )
          }),
          Effect.catchIf(
            error => error.reason === 'jj-failed' || error.reason === 'ambiguous-revision',
            (error): Effect.Effect<UnresolvedRevision> =>
              Effect.succeed(
                error.reason === 'ambiguous-revision'
                  ? {
                      revision: input.revision,
                      reason: 'divergent',
                      message: 'Several commits share this change id. Select one commit from the graph instead.',
                    }
                  : { revision: input.revision, reason: 'missing', message: 'This revision no longer exists. Refresh the graph and select it again.' },
              ),
          ),
        )

      /** One revision's change, within what is left of the review's one patch budget. */
      const readRevision = Effect.fn('review revision read')(function* (input: {
        readonly path: string
        readonly revision: ResolvedRevision
        readonly budget: number
      }) {
        // An exhausted budget still lists the revision, flagged, instead of dropping it from the review.
        const diff =
          input.budget <= 0
            ? { stdout: '', truncated: true }
            : yield* jjReads.read({ path: input.path, args: RevisionReviewModel.diffArgs(input.revision.commitId), outputLimit: input.budget })
        const patch = diff.stdout
        const grouped = yield* groupPatch({ patch, title: input.revision.shortChangeId })
        return {
          changeId: input.revision.changeId,
          shortChangeId: input.revision.shortChangeId,
          commitId: input.revision.commitId,
          description: input.revision.description,
          patch,
          truncated: diff.truncated || grouped.clipped,
          fileCount: grouped.fileCount,
          additions: grouped.additions,
          deletions: grouped.deletions,
          files: [...grouped.files],
        } satisfies RevisionReview
      })

      const readRevisions = Effect.fn('review revisions read')(function* (input: RevisionsReviewInput) {
        const requested = [...new Set(input.revisions)]
        const outcomes = yield* Effect.forEach(requested, revision => resolveRevision({ path: input.path, revision }), { concurrency: 4 })
        const found = new Map<string, ResolvedRevision>()
        for (const outcome of outcomes) if ('commitId' in outcome && !found.has(outcome.commitId)) found.set(outcome.commitId, outcome)
        const resolved = [...found.values()]
        const ordering =
          resolved.length < 2
            ? ''
            : (yield* jjReads.read({ path: input.path, args: RevisionReviewModel.orderArgs(resolved.map(revision => revision.commitId)), outputLimit: 16_384 }))
                .stdout
        const ordered = RevisionReviewModel.inOrder(resolved, ordering)
        const revisions: RevisionReview[] = []
        let budget = MAX_PATCH_CHARS
        // oxlint-disable-next-line effect-antislop/no-sequential-effect-yield-in-loop -- oldest first, each read takes what the earlier ones left of one patch budget.
        for (const revision of ordered) {
          const read = yield* readRevision({ path: input.path, revision, budget })
          revisions.push(read)
          budget -= read.patch.length
        }
        return {
          status: 'ok',
          path: input.path,
          revisions,
          unresolved: outcomes.filter((outcome): outcome is UnresolvedRevision => !('commitId' in outcome)),
          segments: RevisionReviewModel.segments(ordered),
          truncated: revisions.some(revision => revision.truncated),
          fileCount: revisions.reduce((total, revision) => total + revision.fileCount, 0),
          additions: revisions.reduce((total, revision) => total + revision.additions, 0),
          deletions: revisions.reduce((total, revision) => total + revision.deletions, 0),
        } satisfies RevisionsReviewResult
      })

      const revisionsFailure = (path: string, error: JjReadFailed): Effect.Effect<RevisionsReviewResult, PullsReviewOperationError> => {
        if (error.reason === 'jj-missing') return Effect.succeed(RevisionReviewModel.failure(path, 'jj-missing', jj.messages.missing))
        if (error.reason === 'not-a-repository') return Effect.succeed(RevisionReviewModel.failure(path, 'not-a-repository', jj.messages.notARepository))
        if (error.reason === 'jj-failed' || error.reason === 'ambiguous-revision') {
          return Effect.succeed(RevisionReviewModel.failure(path, 'jj-failed', jj.messages.failed))
        }
        return Effect.fail(new PullsReviewOperationError({ operation: 'review', cause: error }))
      }

      const reviewRevisions = Effect.fn('pulls-review revisions review')(function* (input: RevisionsReviewInput) {
        if (!(yield* isDirectory(input.path))) {
          return RevisionReviewModel.failure(
            input.path,
            'workspace-missing',
            'That workspace is no longer on disk. Open the graph from a workspace that still exists.',
          )
        }
        if ((yield* detector.detect(input.path)) === 'git') {
          return RevisionReviewModel.failure(
            input.path,
            'not-a-repository',
            'Reviewing selected revisions needs a Jujutsu repository, and this one is git-only.',
          )
        }
        return yield* readRevisions(input).pipe(
          Effect.catchTags({
            JjReadFailed: error => revisionsFailure(input.path, error),
            PatchGroupingFailed: error => Effect.fail(new PullsReviewOperationError({ operation: 'review', cause: error })),
          }),
        )
      })

      return ReviewWorkspace.of({ review, reviewRevisions })
    }),
  ).pipe(Layer.provide(VcsDetector.layer), Layer.provide(Path.layer))
}

export class ReviewWorkspaceModel {
  static readonly revisionArgs = revisionArgs
  static readonly diffArgs = diffArgs
}
