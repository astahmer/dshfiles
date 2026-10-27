import type { QueuedBlock, QueuedImageAttachment } from './queue-edit.js'

export const messageText = (content: readonly { readonly type: string; readonly text?: string | undefined }[]): string =>
  content
    .filter(block => block.type === 'text')
    .map(block => block.text ?? '')
    .join('')

export const messagePreview = (content: readonly { readonly type: string; readonly text?: string | undefined }[], limit: number): string => {
  const flat = content
    .filter(block => block.type !== 'image' && block.type !== 'file')
    .map(block => (block.type === 'text' ? (block.text ?? '') : `[${block.type}]`))
    .join(' ')
    .replace(/\s+/gu, ' ')
    .trim()
  const chars = Array.from(flat)
  return chars.length > limit ? `${chars.slice(0, limit).join('')}…` : flat
}

export type AttachmentPreview =
  | { readonly kind: 'image'; readonly key: string; readonly name: string; readonly attachment: QueuedImageAttachment }
  | { readonly kind: 'file'; readonly key: string; readonly name: string; readonly bytes: number }

/** One preview per attachment, in message order; the same attachment twice gets distinct keys. */
export const attachmentPreviews = (blocks: readonly QueuedBlock[]): readonly AttachmentPreview[] =>
  blocks.flatMap((block, index): AttachmentPreview[] => {
    if (block.type === 'image')
      return [{ kind: 'image', key: `${index}:${block.attachment.attachmentId}`, name: block.attachment.name ?? 'image', attachment: block.attachment }]
    if (block.type === 'file')
      return [{ kind: 'file', key: `${index}:${block.attachment.attachmentId}`, name: block.attachment.name, bytes: block.attachment.bytes }]
    return []
  })
