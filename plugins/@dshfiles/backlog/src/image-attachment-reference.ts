import type { ComposerFile } from './composer-files.js'

export interface ImageReferenceInsert {
  readonly text: string
  readonly caret: number
}

export interface ImageReferenceSegment {
  readonly text: string
  readonly isReference: boolean
}

const markdownLabel = (name: string): string => name.replaceAll('\\', '\\\\').replaceAll(']', '\\]')

export class ImageAttachmentReferenceModel {
  static readonly imageReferenceLabels = (files: readonly ComposerFile[]): readonly string[] =>
    files.filter(file => file.kind === 'image').map((_, index) => `Image ${index + 1}`)

  static readonly highlightSegments = (text: string, files: readonly ComposerFile[]): readonly ImageReferenceSegment[] => {
    const imageCount = files.filter(file => file.kind === 'image').length
    const segments: ImageReferenceSegment[] = []
    const pattern = /(?<![\w@])@Image (\d+)(?!\w)/gu
    let cursor = 0

    for (const match of text.matchAll(pattern)) {
      const reference = match[0]
      const start = match.index
      const imageNumber = Number(match[1])
      if (reference === undefined || start === undefined || imageNumber < 1 || imageNumber > imageCount) continue
      if (start > cursor) segments.push({ text: text.slice(cursor, start), isReference: false })
      segments.push({ text: reference, isReference: true })
      cursor = start + reference.length
    }

    if (cursor < text.length) segments.push({ text: text.slice(cursor), isReference: false })
    return segments
  }

  /** Persist composer-only image mentions as links Markdown can render after the attachment is saved. */
  static readonly markdownImageReferences = (text: string, files: readonly ComposerFile[]): string => {
    const images = files.filter(file => file.kind === 'image')
    return text.replace(/(?<![\w@])@Image (\d+)(?!\w)/gu, (reference, number: string) => {
      const image = images[Number(number) - 1]
      if (image === undefined) return reference
      const id = image.id.startsWith('image_') ? image.id : `image_${image.id}`
      return `![${markdownLabel(image.name)}](dsh-context://v1/image/${id})`
    })
  }

  static readonly insertImageReferences = (input: {
    readonly text: string
    readonly start: number
    readonly end: number
    readonly files: readonly ComposerFile[]
    readonly firstImageNumber: number
  }): ImageReferenceInsert => {
    const labels = input.files.filter(file => file.kind === 'image').map((_, index) => `@Image ${input.firstImageNumber + index + 1}`)
    if (labels.length === 0) return { text: input.text, caret: input.start }

    const before = input.text.slice(0, input.start)
    const after = input.text.slice(input.end)
    const prefix = before !== '' && !/\s$/u.test(before) ? ' ' : ''
    const suffix = after !== '' && !/^\s/u.test(after) ? ' ' : ''
    const inserted = `${prefix}${labels.join(' ')}${suffix}`
    const text = `${before}${inserted}${after}`
    return { text, caret: before.length + inserted.length - suffix.length }
  }
}
