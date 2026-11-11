import { ImagePreview } from '@dshfiles/image-preview'
import { Schema } from 'effect'

/** Authenticated GET route serving one changed image of a reviewed repository at a revision, or in the working copy. */
export const REVIEW_IMAGE_PATH = '/api/diffs-review.image'

/** The working copy as it is now: the live scopes' after side. */
export const WORKING_COPY = 'working-copy'

/** A commit or change id as jj and git print them, never a revset expression or an option. */
const REVISION = /^[0-9a-z]{1,128}$/u
// oxlint-disable-next-line no-control-regex -- control characters are exactly what a file path here may not hold.
const CONTROL = /[\u0000-\u001f\u007f\\]/u

/** Repository-relative, `/`-separated, with no empty, `.` or `..` segment: it cannot name anything outside the root. */
const isRepositoryRelative = (file: string): boolean =>
  !CONTROL.test(file) && file.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..')

export const reviewImageQuerySchema = Schema.Struct({
  path: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048)),
  file: Schema.String.check(
    Schema.isMinLength(1),
    Schema.isMaxLength(2048),
    Schema.makeFilter(file => (isRepositoryRelative(file) ? true : 'A repository-relative path without . or .. segments.')),
  ),
  revision: Schema.Union([Schema.Literal(WORKING_COPY), Schema.String.check(Schema.isPattern(REVISION))]),
  side: Schema.optional(Schema.Literal('parent')),
})
export type ReviewImageQuery = typeof reviewImageQuerySchema.Type

/** One side of a changed image: the route reading it and the version it shows. */
export interface ImageSide {
  readonly url: string
  readonly label: string
}

/** A changed image with the sides that exist: no before for an added or renamed file, no after for a removed one. */
export interface ChangedImageEntry {
  readonly path: string
  readonly before?: ImageSide | undefined
  readonly after?: ImageSide | undefined
}

/**
 * Document-relative address of one image side.
 * @param query - the repository, the file, and the revision (with `side: 'parent'` for its parent).
 */
const imageUrl = (query: ReviewImageQuery): string => {
  const params = new URLSearchParams({ path: query.path, file: query.file, revision: query.revision })
  if (query.side !== undefined) params.set('side', query.side)
  return `${REVIEW_IMAGE_PATH.slice(1)}?${params}`
}

const shortId = (revision: string): string => revision.slice(0, 8)

interface ReviewedFile {
  readonly path: string
  readonly status: string
}

/**
 * The changed images of a range between two known versions.
 * @param input - the repository, the range's files, its base commit (absent when unknown) and its head: a commit, or
 *   {@link WORKING_COPY} for a live scope.
 */
const rangeImages = (input: {
  readonly workspacePath: string
  readonly files: readonly ReviewedFile[]
  readonly base: string | undefined
  readonly head: string
}): readonly ChangedImageEntry[] =>
  input.files.flatMap(file => {
    if (ImagePreview.typeOf(file.path) === undefined) return []
    const hasBefore = input.base !== undefined && file.status !== 'added' && file.status !== 'renamed' && file.status !== 'copied'
    const before =
      hasBefore && input.base !== undefined
        ? { url: imageUrl({ path: input.workspacePath, file: file.path, revision: input.base }), label: `Before · ${shortId(input.base)}` }
        : undefined
    const after =
      file.status === 'removed'
        ? undefined
        : {
            url: imageUrl({ path: input.workspacePath, file: file.path, revision: input.head }),
            label: input.head === WORKING_COPY ? 'Current' : `After · ${shortId(input.head)}`,
          }
    return [{ path: file.path, before, after }]
  })

/**
 * The changed images of one revision against its parent.
 * @param input - the repository, the revision's commit id and its files.
 */
const revisionImages = (input: {
  readonly workspacePath: string
  readonly commitId: string
  readonly files: readonly ReviewedFile[]
}): readonly ChangedImageEntry[] =>
  input.files.flatMap(file => {
    if (ImagePreview.typeOf(file.path) === undefined) return []
    const before =
      file.status === 'added' || file.status === 'renamed' || file.status === 'copied'
        ? undefined
        : { url: imageUrl({ path: input.workspacePath, file: file.path, revision: input.commitId, side: 'parent' }), label: 'Before · parent' }
    const after =
      file.status === 'removed'
        ? undefined
        : { url: imageUrl({ path: input.workspacePath, file: file.path, revision: input.commitId }), label: `After · ${shortId(input.commitId)}` }
    return [{ path: file.path, before, after }]
  })

/**
 * A turn's changed images: DSH's turn snapshot keeps no image bytes, so only the current version shows.
 * @param input - the thread's folder and the turn's listed files.
 */
const turnImages = (input: { readonly workspacePath: string; readonly files: readonly { readonly path: string }[] }): readonly ChangedImageEntry[] =>
  input.files.flatMap(file => {
    const relative = file.path.startsWith(`${input.workspacePath}/`) ? file.path.slice(input.workspacePath.length + 1) : file.path
    if (ImagePreview.typeOf(relative) === undefined) return []
    return [{ path: file.path, after: { url: imageUrl({ path: input.workspacePath, file: relative, revision: WORKING_COPY }), label: 'Current' } }]
  })

export class ReviewImageModel {
  static readonly url = imageUrl
  static readonly rangeImages = rangeImages
  static readonly revisionImages = revisionImages
  static readonly turnImages = turnImages
}
