import type { ReferenceInsert } from './contract/draft-editor.ts'

export interface ImageAttachmentIdentity {
  readonly id: string
}

export const imageAttachmentReferences = (
  attachments: readonly ImageAttachmentIdentity[],
  firstImageNumber: number,
): readonly ReferenceInsert[] => attachments.map((attachment, index) => {
  const label = `Image ${firstImageNumber + index + 1}`
  return {
    source: 'image-attachment',
    ref: attachment.id,
    label,
    clipboardText: `[${label}]`,
  }
})
