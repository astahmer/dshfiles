/** Which files preview as images, and the one guarded way a Host route answers with their bytes. */

/** Largest image a preview route serves; a larger one answers 413 and the viewer points to opening the file. */
const MAX_BYTES = 8 * 1024 * 1024

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
const typeOf = (path: string): string | undefined => {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
  const dot = name.lastIndexOf('.')
  if (dot <= 0) return undefined
  return IMAGE_TYPES.get(name.slice(dot + 1).toLowerCase())
}

/**
 * A plain-text refusal that no cache keeps.
 * @param input - the status and a reason the viewer may show.
 */
const refusal = (input: { readonly status: number; readonly reason: string }): Response =>
  new Response(input.reason, { status: input.status, headers: { 'cache-control': 'no-store' } })

/**
 * Image bytes under their own media type with sniffing off and a sandboxing policy, so an SVG opened directly runs no
 * script and nothing else is ever read as HTML.
 * @param input - the bytes and the media type {@link ImagePreview.typeOf} named.
 */
const response = (input: { readonly bytes: Uint8Array; readonly type: string }): Response =>
  new Response(new Uint8Array(input.bytes), {
    headers: {
      'content-type': input.type,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    },
  })

/** Why a preview route refused, by the status it answered; any other failure is an error worth a retry. */
export type ImagePreviewRefusal = 'missing' | 'too-large' | 'outside' | 'not-an-image'

/**
 * The refusal a preview route's status means.
 * @param status - the HTTP status.
 * @returns the refusal, or undefined for a success or a failure worth retrying.
 */
const refusalOf = (status: number): ImagePreviewRefusal | undefined => {
  if (status === 404) return 'missing'
  if (status === 413) return 'too-large'
  if (status === 403) return 'outside'
  if (status === 415) return 'not-an-image'
  return undefined
}

/** The image preview contract every route and viewer answers the same way. */
export class ImagePreview {
  static readonly maxBytes = MAX_BYTES
  static readonly typeOf = typeOf
  static readonly response = response
  static readonly refusal = refusal
  static readonly refusalOf = refusalOf
}
