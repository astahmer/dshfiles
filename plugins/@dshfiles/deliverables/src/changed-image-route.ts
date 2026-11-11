/** Serve one listed changed image's current bytes, confined to its Session's workspace and capped in size. */
import type { Context } from '@deepseek-ai/cordis'
import type { FileSystem } from '@deepseek-ai/dsh-fs'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceChanges } from '@deepseek-ai/dsh-workspace-changes/types'
import { ImagePreview } from '@dshfiles/image-preview'
import { CHANGES_IMAGE_PATH } from './changed-image.ts'

/** The filesystem calls the route needs: canonical resolution, containment, metadata and one bounded read. */
type ChangedImageFs = Pick<FileSystem, 'resolve' | 'contains' | 'stat' | 'readBytes'>

interface ChangedImageSources {
  readonly fs: ChangedImageFs
  readonly changes: Pick<WorkspaceChanges, 'summary'>
}

const COORDINATE = /^\d+$/

const coordinateOf = (value: string | null): number | undefined =>
  value !== null && COORDINATE.test(value) && Number.isSafeInteger(Number(value)) ? Number(value) : undefined

const refusal = (status: number, reason: string): Response => ImagePreview.refusal({ status, reason })

const isTooLarge = (error: unknown): boolean => typeof error === 'object' && error !== null && 'code' in error && error.code === 'FS_TOO_LARGE'

/**
 * Answer one `changes.image` request. The listed path resolves with symlinks followed, so a link or `..` leaving the
 * Session's working directory is refused; only an image extension is served, under its own media type and a sandboxing
 * policy, so an SVG opened directly runs no script.
 * @param sources - the Host filesystem and the change summaries.
 * @param request - the authenticated GET with `sessionId`, `seq` and `index`.
 * @returns the image bytes, or 400, 403, 404, 413 or 415 with a plain reason.
 */
export const serveChangedImage = async (sources: ChangedImageSources, request: Request): Promise<Response> => {
  const query = new URL(request.url).searchParams
  const sessionId = query.get('sessionId')
  const seq = coordinateOf(query.get('seq'))
  const index = coordinateOf(query.get('index'))
  if (!sessionId || seq === undefined || index === undefined) return refusal(400, 'Invalid changed file coordinates.')
  const summary = sources.changes.summary(SessionId(sessionId), seq)
  if (summary === undefined) return refusal(404, 'Change summary unavailable.')
  const file = summary.files[index]
  if (file === undefined) return refusal(404, 'Changed file not found in this summary.')
  const type = ImagePreview.typeOf(file.path)
  if (type === undefined) return refusal(415, 'Changed file is not an image.')
  const root = await sources.fs.resolve(summary.cwd, { signal: request.signal })
  const target = await sources.fs.resolve(file.path, { cwd: summary.cwd, signal: request.signal })
  if (!sources.fs.contains(root, target)) return refusal(403, 'Changed file is outside the workspace.')
  const info = await sources.fs.stat(target, request.signal)
  if (info?.type !== 'file') return refusal(404, 'Changed image no longer exists.')
  const data = await sources.fs.readBytes(target, request.signal, ImagePreview.maxBytes).catch((error: unknown) => {
    if (isTooLarge(error)) return undefined
    throw error
  })
  if (data === undefined) return refusal(413, 'Changed image exceeds the preview size cap.')
  return ImagePreview.response({ bytes: data, type })
}

/**
 * Register {@link CHANGES_IMAGE_PATH} inside Connection's authentication fence.
 * @param ctx - Host context carrying Connection, the filesystem and the change summaries.
 */
export const registerChangedImage = (ctx: Context): void => {
  ctx.connection.fetch.register({
    path: CHANGES_IMAGE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: request =>
      serveChangedImage({ fs: ctx.fs, changes: ctx.workspaceChanges }, request).catch((error: unknown) => {
        request.signal.throwIfAborted()
        return refusal(isNotFound(error) ? 404 : 500, 'Changed image unavailable.')
      }),
  })
}

const isNotFound = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'code' in error && (error.code === 'ENOENT' || error.code === 'ENOTDIR')
