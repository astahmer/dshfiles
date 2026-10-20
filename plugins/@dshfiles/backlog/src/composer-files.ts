import { BacklogItems, type BacklogFileInput } from './item.js'

export type ComposerFileKind = 'image' | 'file'

export interface ComposerFile {
  readonly id: string
  readonly kind: ComposerFileKind
  readonly name: string
  readonly mediaType: string
  readonly bytes: number
  readonly width?: number
  readonly height?: number
  readonly dataUrl: string
}

const MAX_EDGE = 1_600
const MAX_INPUT_BYTES = 20 * 1024 * 1024

const isImage = (file: File): boolean => BacklogItems.imageMediaTypes.some(mediaType => mediaType === file.type)

const bytesOfDataUrl = (dataUrl: string): number => {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding)
}

const scaledCanvas = (bitmap: ImageBitmap): HTMLCanvasElement => {
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('The browser could not prepare the image.')
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas
}

const readImage = async (file: File): Promise<ComposerFile> => {
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = scaledCanvas(bitmap)
    const encoded = canvas.toDataURL('image/webp', 0.82)
    const dataUrl = encoded.startsWith('data:image/webp') ? encoded : canvas.toDataURL('image/png')
    const bytes = bytesOfDataUrl(dataUrl)
    if (bytes > BacklogItems.maxFileBytes) throw new Error('That image is still larger than 16 MB after shrinking.')
    return {
      id: crypto.randomUUID(),
      kind: 'image',
      name: file.name === '' ? `Screenshot ${new Date().toLocaleTimeString()}` : file.name.slice(0, 200),
      mediaType: dataUrl.startsWith('data:image/webp') ? 'image/webp' : 'image/png',
      bytes,
      width: canvas.width,
      height: canvas.height,
      dataUrl,
    }
  } finally {
    bitmap.close()
  }
}

const readFile = async (file: File): Promise<ComposerFile> => {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => (reader.result === null ? reject(new Error('That file could not be read.')) : resolve(String(reader.result)))
    reader.onerror = () => reject(new Error('That file could not be read.'))
    reader.readAsDataURL(file)
  })
  return {
    id: crypto.randomUUID(),
    kind: 'file',
    name: file.name === '' ? 'Dropped file' : file.name.slice(0, 200),
    mediaType: file.type === '' ? 'application/octet-stream' : file.type,
    bytes: file.size,
    dataUrl,
  }
}

/** Reads any dropped or pasted file; images are scaled and re-encoded, other files keep their bytes. */
export const readComposerFile = async (file: File): Promise<ComposerFile> => {
  if (file.size > MAX_INPUT_BYTES) throw new Error(`${file.name || 'That file'} is larger than 20 MB.`)
  if (isImage(file)) return readImage(file)
  if (file.size > BacklogItems.maxFileBytes) throw new Error(`${file.name || 'That file'} is larger than 16 MB.`)
  return readFile(file)
}

/** The API payload keeps only the base64 half; the data-URL prefix is rebuilt from the media type when read. */
export const fileInput = (file: ComposerFile): BacklogFileInput => {
  const base = {
    id: file.id,
    kind: file.kind,
    name: file.name,
    mediaType: file.mediaType,
    bytes: file.bytes,
    data: file.dataUrl.slice(file.dataUrl.indexOf(',') + 1),
  }
  if (file.width === undefined || file.height === undefined) return base
  return { ...base, width: file.width, height: file.height }
}
