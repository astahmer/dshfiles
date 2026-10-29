/** Reusable user contents inside a caller-owned message row. */
import { Fragment } from 'react'
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import { fileExtension, FileTypeIcon, fileSizeText, JsonBlock } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './MessageItem.module.css'
import { userImageReferenceParts } from './user-image-references.js'
import type { UserContentAttachment } from '../contract/slots.ts'

const EMPTY_LABELS: readonly string[] = []

/**
 * Render prepared text, ordered attachments, and references without message chrome.
 * The caller owns row identity, pending/echo state, time, and message actions.
 * @param props - prepared content, facts, authorized image loader, and framework Factory/locale seats.
 * @returns the content stack using the existing user-message layout.
 */
export function UserContent({ content, loadImage, facts, interactive = false, ellipsis = false, renderSlot, renderFactorySlot, t }:
FactoryComponentPropsOf<'conversation.chat.user.content'>) {
  const { text, attachments, extraBlocks, referenceLabels = EMPTY_LABELS } = content
  const imageAttachments = attachments.filter((attachment): attachment is Extract<UserContentAttachment, { readonly type: 'image' }> => attachment.type === 'image')
  const imageParts = userImageReferenceParts(text, imageAttachments.length)
  let imageIndex = 0
  const remainingAttachments = attachments.filter(attachment => {
    if (attachment.type !== 'image') return true
    const currentImageIndex = imageIndex
    imageIndex += 1
    return !imageParts.referencedIndexes.has(currentImageIndex)
  })
  const compactImages = remainingAttachments.filter(attachment => attachment.type === 'image').length > 1
  const truncated = (total: number): string => t('json.truncated', { total })
  const showBubble = text !== '' || extraBlocks.length > 0
  return (
    <div className={css.userStack}>
      {remainingAttachments.length > 0 && (
        <div className={css.attachmentRow} data-message-attachments>
          {remainingAttachments.map((attachment, index) => attachment.type === 'image'
            ? (
              <Fragment key={`image:${index}`}>
                {renderSlot('conversation.chat.user.images', {
                  images: [attachment.image], loadImage, align: 'end', compact: compactImages,
                })}
              </Fragment>
            )
            : (
              <span key={`file:${index}`} className={css.fileCard} title={attachment.file.name}>
                <FileTypeIcon path={attachment.file.name} className={css.fileIcon} />
                <span className={css.fileContent}>
                  <span className={css.fileName}>{attachment.file.name}</span>
                  <span className={css.fileMeta}>
                    {[fileExtension(attachment.file.name).toUpperCase().slice(0, 8), fileSizeText(attachment.file.bytes)]
                      .filter(Boolean).join(' ')}
                  </span>
                </span>
              </span>
            ))}
        </div>
      )}
      {showBubble && <div className={css.bubble}>
        {imageParts.parts.map((part, index) => {
          if (part.type === 'text') {
            return (
              <Fragment key={`text:${index}`}>
                {renderFactorySlot('conversation.user.text', { text: part.text, facts, interactive, ellipsis })}
              </Fragment>
            )
          }
          const image = imageAttachments[part.index]
          if (image === undefined) return null
          return (
            <span key={`image:${index}`} className={css.inlineImageReference}>
              {renderSlot('conversation.chat.user.images', {
                images: [image.image], loadImage, align: 'start', thumbnail: true,
              })}
            </span>
          )
        })}
        {extraBlocks.map((block, index) => (
          <JsonBlock key={index} label={t('message.extraBlock')} payload={block} truncatedLabel={truncated} />
        ))}
      </div>}
      {referenceLabels.length > 0 && (
        <div className={css.referenceSummary}>
          {t('message.referenceSummary', { labels: referenceLabels.join(t('message.referenceSeparator')) })}
        </div>
      )}
    </div>
  )
}
