/** Browser image MIME classification for composer intake. */

import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'

/**
 * Whether a browser-declared MIME selects the image draft path (all other files upload verbatim).
 * @param value - the browser's declared MIME type.
 * @returns whether the file is an accepted raster image.
 */
export function isImageMediaType(value: string): boolean {
  return value === 'image/png' || value === 'image/jpeg' || value === 'image/webp' || value === 'image/gif'
}

const IMAGE_TYPE_BY_EXTENSION: Readonly<Record<string, ImageMediaType>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jfif: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

/**
 * A picked file under its canonical image MIME. Phone pickers and some OS shares declare a JPEG as `image/jpg`,
 * `image/pjpeg` or nothing at all; such a file would otherwise skip the image path and the Host would refuse it.
 * @param file - a browser-picked, dropped or pasted file.
 * @returns the same file when its MIME is already canonical or names no image, else a relabelled copy.
 */
export function withCanonicalImageType(file: File): File {
  if (isImageMediaType(file.type)) return file
  if (file.type !== '' && file.type !== 'image/jpg' && file.type !== 'image/pjpeg' && file.type !== 'application/octet-stream') return file
  const extension = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase()
  const mediaType = file.name.includes('.') ? IMAGE_TYPE_BY_EXTENSION[extension] : undefined
  if (mediaType === undefined) return file
  return new File([file], file.name, { type: mediaType, lastModified: file.lastModified })
}
