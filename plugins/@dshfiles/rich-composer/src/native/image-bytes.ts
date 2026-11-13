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
 * Re-encode an image the browser can decode as a JPEG, upright per its EXIF orientation.
 * @param file - the picked image.
 * @returns the JPEG bytes, or undefined when this browser cannot decode the file.
 */
export const jpegCopy = async (file: Blob): Promise<Blob | undefined> => {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return undefined
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (context === null) return undefined
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    return await new Promise<Blob | undefined>((resolve) => {
      canvas.toBlob(blob => { resolve(blob ?? undefined) }, 'image/jpeg', JPEG_QUALITY)
    })
  } catch {
    return undefined
  }
}
