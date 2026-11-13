/** What a picked image really is, judged by its bytes, and a JPEG copy for formats the Host cannot admit. */

import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  signature.every((byte, index) => bytes[offset + index] === byte)

const ascii = (text: string): readonly number[] => [...text].map(character => character.charCodeAt(0))

/**
 * The raster format named by a file's leading bytes.
 * @param bytes - at least the first 12 bytes of the file.
 * @returns the format the Host admits, or undefined for anything else (HEIF, AVIF, BMP, truncated data).
 */
export const sniffImageType = (bytes: Uint8Array): ImageMediaType | undefined => {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'image/gif'
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp'
  return undefined
}

const JPEG_QUALITY = 0.9

/**
 * Whether JPEG bytes end with the end-of-image marker; a JPEG without it was cut short while it was read.
 * @param bytes - the complete file bytes.
 * @returns true when the last two bytes are FF D9.
 */
export const jpegComplete = (bytes: Uint8Array): boolean => bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9

type Drawable = { readonly source: CanvasImageSource; readonly width: number; readonly height: number; readonly release: () => void }

const bitmapOf = async (file: Blob): Promise<Drawable> => {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => { bitmap.close() } }
}

/** The thumbnail's own decode: an <img> renders a JPEG createImageBitmap and the Host's strict decoder refuse. */
const imageOf = async (url: string): Promise<Drawable> => {
  const image = new Image()
  image.src = url
  await image.decode()
  return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => undefined }
}

const encodeJpeg = async (drawable: Drawable): Promise<Blob> => {
  const canvas = document.createElement('canvas')
  canvas.width = drawable.width
  canvas.height = drawable.height
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('no 2d canvas')
  context.drawImage(drawable.source, 0, 0)
  drawable.release()
  const blob = await new Promise<Blob | null>((resolve) => { canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY) })
  if (blob === null) throw new Error('canvas encode failed')
  return blob
}

const failureName = (error: unknown): string => (error instanceof Error ? error.name : 'Error')

/**
 * Re-encode an image the browser can show as a JPEG, upright per its EXIF orientation. The file's bitmap decode comes
 * first; the thumbnail's <img> decode is the fallback, since it tolerates bytes the stricter decoders refuse.
 * @param request.file - the picked image.
 * @param request.previewUrl - the object URL the composer thumbnail renders, when there is one.
 * @returns the JPEG, or why neither decode produced one.
 */
export const jpegCopy = async (request: { readonly file: Blob; readonly previewUrl?: string }): Promise<
  { readonly ok: true; readonly blob: Blob; readonly via: 'bitmap' | 'image' } | { readonly ok: false; readonly failure: string }
> => {
  if (typeof document === 'undefined') return { ok: false, failure: 'no document' }
  const failures: string[] = []
  if (typeof createImageBitmap === 'function') {
    try {
      return { ok: true, blob: await encodeJpeg(await bitmapOf(request.file)), via: 'bitmap' }
    } catch (error) {
      failures.push(`bitmap:${failureName(error)}`)
    }
  }
  if (request.previewUrl !== undefined && typeof Image === 'function') {
    try {
      return { ok: true, blob: await encodeJpeg(await imageOf(request.previewUrl)), via: 'image' }
    } catch (error) {
      failures.push(`image:${failureName(error)}`)
    }
  }
  return { ok: false, failure: failures.join(',') || 'no decoder' }
}
