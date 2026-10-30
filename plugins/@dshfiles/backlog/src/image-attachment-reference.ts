import type { ComposerFile } from './composer-files.js'

export interface ImageReferenceOccurrence {
  readonly start: number
  readonly end: number
  readonly attachmentId: string
}

const markdownLabel = (name: string): string => name.replaceAll('\\', '\\\\').replaceAll(']', '\\]')

export class ImageAttachmentReferenceModel {
  static readonly imageReferenceLabels = (files: readonly ComposerFile[]): readonly string[] =>
    files.filter(file => file.kind === 'image').map((_, index) => `Image ${index + 1}`)

  static readonly markdownImageReference = (image: ComposerFile): string => {
    const id = image.id.startsWith('image_') ? image.id : `image_${image.id}`
    return `![${markdownLabel(image.name)}](dsh-context://v1/image/${id})`
  }

  /** Persist composer-only image mentions as links Markdown can render after the attachment is saved. */
  static readonly markdownImageReferences = (text: string, files: readonly ComposerFile[]): string => {
    const images = files.filter(file => file.kind === 'image')
    return text.replace(/(?<![\w@])@Image (\d+)(?!\w)/gu, (reference, number: string) => {
      const image = images[Number(number) - 1]
      if (image === undefined) return reference
      return ImageAttachmentReferenceModel.markdownImageReference(image)
    })
  }

  static readonly markdownImageReferencesFromEditor = (
    text: string,
    occurrences: readonly ImageReferenceOccurrence[],
    files: readonly ComposerFile[],
  ): string => {
    const byId = new Map<string, ComposerFile>()
    for (const file of files) {
      if (file.kind === 'image') byId.set(file.id, file)
    }
    let cursor = 0
    let output = ''
    for (const occurrence of occurrences) {
      if (occurrence.start < cursor || occurrence.end > text.length) continue
      output += text.slice(cursor, occurrence.start)
      const image = byId.get(occurrence.attachmentId)
      output += image === undefined ? text.slice(occurrence.start, occurrence.end) : ImageAttachmentReferenceModel.markdownImageReference(image)
      cursor = occurrence.end
    }
    return `${output}${text.slice(cursor)}`
  }
}
