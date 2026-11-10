import type { QueuedBlock, QueuedImageAttachment } from './queue-edit-model.js'

export type AttachmentPreview =
  | { readonly kind: 'image'; readonly key: string; readonly name: string; readonly attachment: QueuedImageAttachment }
  | { readonly kind: 'file'; readonly key: string; readonly name: string; readonly bytes: number }

export class MessagePreviewModel {
  static readonly messageText = (content: readonly { readonly type: string; readonly text?: string | undefined }[]): string =>
    content
      .filter(block => block.type === 'text')
      .map(block => block.text ?? '')
      .join('')

  static readonly messagePreview = (content: readonly { readonly type: string; readonly text?: string | undefined }[], limit: number): string => {
    const text = content
      .filter(block => block.type !== 'image' && block.type !== 'file')
      .map(block => (block.type === 'text' ? (block.text ?? '') : `[${block.type}]`))
      .join(' ')
    // A preview never shows more than `limit` code points, and a code point costs at most two UTF-16 units: the head
    // below already holds every code point the preview can show, so a long queued body is not scanned in full.
    const coversText = text.length <= limit * 2 + 2
    const head = coversText ? text : text.slice(0, limit * 2 + 2)
    const chars = Array.from(head.replace(/\s+/gu, ' ').trimStart())
    if (chars.length > limit) return `${chars.slice(0, limit).join('')}…`
    if (coversText) return chars.join('').trimEnd()
    // The head held only whitespace, which collapses to fewer characters than the message actually shows.
    const flat = text.replace(/\s+/gu, ' ').trim()
    const all = Array.from(flat)
    return all.length > limit ? `${all.slice(0, limit).join('')}…` : flat
  }

  /** One preview per attachment, in message order; the same attachment twice gets distinct keys. */
  static readonly attachmentPreviews = (blocks: readonly QueuedBlock[]): readonly AttachmentPreview[] =>
    blocks.flatMap((block, index): AttachmentPreview[] => {
      if (block.type === 'image')
        return [{ kind: 'image', key: `${index}:${block.attachment.attachmentId}`, name: block.attachment.name ?? 'image', attachment: block.attachment }]
      if (block.type === 'file')
        return [{ kind: 'file', key: `${index}:${block.attachment.attachmentId}`, name: block.attachment.name, bytes: block.attachment.bytes }]
      return []
    })
}
