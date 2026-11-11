/** Which changed files preview as images, and the route serving their current bytes. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Authenticated GET route serving one listed image file's current bytes while its Session lives. */
export const CHANGES_IMAGE_PATH = '/api/changes.image'

/** Largest image the route serves; a larger one answers 413 and the card points to opening the file. */
export const MAX_CHANGED_IMAGE_BYTES = 8 * 1024 * 1024

const IMAGE_TYPES = new Map([
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['gif', 'image/gif'],
  ['webp', 'image/webp'],
  ['svg', 'image/svg+xml'],
  ['avif', 'image/avif'],
])

/**
 * The image media type a path's extension names.
 * @param path - workspace-relative or absolute path, either separator.
 * @returns the Content-Type to serve it with, or undefined for any other file.
 */
export const imageTypeOf = (path: string): string | undefined => {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return undefined
  return IMAGE_TYPES.get(name.slice(dot + 1).toLowerCase())
}

/**
 * Document-relative address of one listed file's current image bytes.
 * @param input - owning Session, announcing event sequence, and the file's index in the summary.
 * @returns the route with its query.
 */
export const changesImageUrl = (input: { readonly sessionId: SessionId; readonly seq: number; readonly index: number }): string =>
  `${CHANGES_IMAGE_PATH.slice(1)}?${new URLSearchParams({ sessionId: input.sessionId, seq: String(input.seq), index: String(input.index) })}`
