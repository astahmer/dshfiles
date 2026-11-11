import { ImagePreview } from '@dshfiles/image-preview'
import { Git } from '@dshfiles/git-cli'
import { Jj } from '@dshfiles/jj-cli'
import { VcsDetector, type VcsKind } from '@dshfiles/vcs-provider-port/detect'
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from 'effect'
import { reviewImageQuerySchema, type ReviewImageQuery } from './review-image-query.js'

export type ReviewImageOutcome =
  | { readonly _tag: 'image'; readonly bytes: Uint8Array; readonly type: string }
  | { readonly _tag: 'refused'; readonly status: 400 | 403 | 404 | 413 | 415; readonly reason: string }

const refused = (status: 400 | 403 | 404 | 413 | 415, reason: string): ReviewImageOutcome => ({ _tag: 'refused', status, reason })

const TOO_LARGE = refused(413, 'This image is larger than the 8 MB preview cap. Open the file to see it.')
const MISSING = refused(404, 'This image is not in that version of the repository.')

/**
 * Read one changed image of a reviewed repository: at a jj or git revision (or its parent) through the VCS, or as the
 * working copy holds it now. Only a previewable image extension is read, at most {@link ImagePreview.maxBytes}; a
 * revision is a plain id (never a revset or an option) and a file is repository-relative without `.` or `..`
 * segments, so neither reaches outside the repository; a working-copy file must resolve, symlinks followed, inside it.
 */
export class ReviewImages extends Context.Service<ReviewImages, { readonly read: (query: ReviewImageQuery) => Effect.Effect<ReviewImageOutcome> }>()(
  '@dshfiles/diffs-review/ReviewImages',
) {
  static readonly layer = Layer.effect(
    ReviewImages,
    Effect.gen(function* () {
      const jj = yield* Jj
      const git = yield* Effect.serviceOption(Git)
      const detector = yield* VcsDetector
      const fileSystem = yield* FileSystem.FileSystem
      const path = yield* Path.Path

      const repositoryRoot = (input: { readonly vcs: VcsKind; readonly cwd: string }) => {
        if (input.vcs === 'jj')
          return jj
            .run({ args: ['root'], cwd: input.cwd, maxStdoutBytes: 8_192 })
            .pipe(Effect.map(output => (output.exitCode === 0 ? output.stdout.trim() : '')))
        if (Option.isNone(git)) return Effect.succeed('')
        return git.value
          .run({ args: ['rev-parse', '--show-toplevel'], cwd: input.cwd, maxStdoutBytes: 8_192 })
          .pipe(Effect.map(output => (output.exitCode === 0 ? output.stdout.trim() : '')))
      }

      const readWorkingCopy = Effect.fnUntraced(function* (input: { readonly root: string; readonly file: string; readonly type: string }) {
        const root = yield* fileSystem.realPath(input.root)
        const target = yield* fileSystem.realPath(path.join(root, input.file))
        if (!target.startsWith(`${root}${path.sep}`)) return refused(403, 'This image resolves outside the reviewed repository, so it is not shown.')
        const info = yield* fileSystem.stat(target)
        if (info.type !== 'File') return refused(404, 'This image is no longer in the working copy.')
        if (Number(info.size) > ImagePreview.maxBytes) return TOO_LARGE
        const bytes = yield* fileSystem.readFile(target)
        if (bytes.byteLength > ImagePreview.maxBytes) return TOO_LARGE
        return { _tag: 'image', bytes, type: input.type } satisfies ReviewImageOutcome
      })

      const fromVcs = (
        output: { readonly exitCode: number; readonly stdout: Uint8Array; readonly stdoutTruncated: boolean },
        type: string,
      ): ReviewImageOutcome => {
        if (output.exitCode !== 0) return MISSING
        if (output.stdoutTruncated) return TOO_LARGE
        return { _tag: 'image', bytes: output.stdout, type }
      }

      const readRevision = (input: { readonly vcs: VcsKind; readonly query: ReviewImageQuery; readonly type: string }) => {
        const parent = input.query.side === 'parent'
        const limit = { cwd: input.query.path, maxStdoutBytes: ImagePreview.maxBytes, onStdoutLimit: 'truncate' as const }
        if (input.vcs === 'jj') {
          const revset = parent ? `${input.query.revision}-` : input.query.revision
          return jj
            .runBytes({ ...limit, args: ['file', 'show', '-r', revset, `root-file:${JSON.stringify(input.query.file)}`] })
            .pipe(Effect.map(output => fromVcs(output, input.type)))
        }
        if (Option.isNone(git)) return Effect.succeed(MISSING)
        const revision = parent ? `${input.query.revision}^` : input.query.revision
        return git.value
          .runBytes({ ...limit, args: ['cat-file', 'blob', `${revision}:${input.query.file}`] })
          .pipe(Effect.map(output => fromVcs(output, input.type)))
      }

      const readImage = Effect.fnUntraced(function* (query: ReviewImageQuery) {
        const type = ImagePreview.typeOf(query.file)
        if (type === undefined) return refused(415, 'Only image files are previewed.')
        if (!path.isAbsolute(query.path)) return refused(400, 'The repository path must be absolute.')
        if (query.revision === 'working-copy' && query.side !== undefined) return refused(400, 'The working copy has no parent side.')
        const vcs = yield* detector.detect(query.path)
        if (vcs === undefined) return refused(404, 'This folder is not in a jj or git repository, so its images cannot be previewed.')
        yield* Effect.annotateCurrentSpan({
          'diffs_review.vcs': vcs,
          'diffs_review.image_source': query.revision === 'working-copy' ? 'working-copy' : (query.side ?? 'revision'),
        })
        if (query.revision !== 'working-copy') return yield* readRevision({ vcs, query, type })
        const root = yield* repositoryRoot({ vcs, cwd: query.path })
        if (root.length === 0) return refused(404, 'This folder is not in a jj or git repository, so its images cannot be previewed.')
        return yield* readWorkingCopy({ root, file: query.file, type })
      })

      const read = Effect.fn('diffs-review image read')(function* (query: ReviewImageQuery) {
        const outcome = yield* readImage(query).pipe(
          Effect.catchTag('PlatformError', error =>
            Effect.succeed(
              error.reason._tag === 'NotFound' ? refused(404, 'This image is no longer in the working copy.') : refused(404, 'This image could not be read.'),
            ),
          ),
          Effect.catchTags({
            JjSpawnFailed: () => Effect.succeed(refused(404, 'Jujutsu (jj) is not available to the Host, so this image cannot be read.')),
            JjTimedOut: () => Effect.succeed(refused(404, 'Reading this image timed out. Refresh to try again.')),
            JjOutputTruncated: () => Effect.succeed(TOO_LARGE),
            GitRunFailed: () => Effect.succeed(refused(404, 'git could not read this image. Refresh to try again.')),
          }),
        )
        yield* Effect.annotateCurrentSpan({ 'diffs_review.image_status': outcome._tag === 'image' ? 200 : outcome.status })
        return outcome
      })

      return ReviewImages.of({ read })
    }),
  ).pipe(Layer.provide(VcsDetector.layer))
}

const decodeQuery = Schema.decodeUnknownOption(reviewImageQuerySchema)

/**
 * Answer one `GET /api/diffs-review.image` request.
 * @param request - the authenticated GET with `path`, `file`, `revision` and an optional `side=parent`.
 * @returns the image under its own media type with nosniff and a sandboxing policy, or a plain-text refusal.
 */
export const serveReviewImage = (request: Request): Effect.Effect<Response, never, ReviewImages> =>
  Effect.gen(function* () {
    const query = decodeQuery(Object.fromEntries(new URL(request.url).searchParams))
    if (Option.isNone(query))
      return ImagePreview.refusal({
        status: 400,
        reason: 'Invalid image request: a repository path, a repository-relative file and a plain revision id are required.',
      })
    const outcome = yield* ReviewImages.use(images => images.read(query.value))
    return outcome._tag === 'image'
      ? ImagePreview.response({ bytes: outcome.bytes, type: outcome.type })
      : ImagePreview.refusal({ status: outcome.status, reason: outcome.reason })
  })
