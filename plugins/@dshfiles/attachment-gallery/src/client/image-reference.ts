export interface ImageReferenceTarget {
  readonly id: string
  readonly kind: string
}

export const imageForReference = <Attachment extends ImageReferenceTarget>(attachments: readonly Attachment[], detail: unknown): Attachment | undefined => {
  if (typeof detail !== 'object' || detail === null || !('id' in detail) || typeof detail.id !== 'string') return undefined
  return attachments.find(attachment => attachment.kind === 'image' && attachment.id === detail.id)
}
