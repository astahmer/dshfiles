import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComposerAttachment, ComposerAttachmentsProps, ComposerImageAttachment } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { XIcon } from '@dshfiles/plugin-ui/icons'
import { AttachmentRail } from '../AttachmentRail.js'
import type { AttachmentRailItem } from '../AttachmentRail.js'
import { DropOverlay } from '../DropOverlay.js'
import { FileCard } from '../FileCard.js'
import { ImageLightbox, type ImageLightboxLabels } from '@dshfiles/plugin-ui/components/image-lightbox'
import { AttachmentGalleryLabelsModel } from './labels.js'
import { installDocumentDropEvents } from './drop-events.js'
import styles from './ComposerAttachments.module.css'

interface ComposerRailItem extends AttachmentRailItem {
  attachment: ComposerAttachment
}

interface ComposerAttachmentsOwnerProps extends ComposerAttachmentsProps {
  galleryLabels: ImageLightboxLabels
}

export function ComposerAttachments({
  attachments,
  canAcceptDrop,
  onAddFiles,
  onRemoveAttachment,
  uploads,
  onRetryFile,
  dropLimits,
  galleryLabels,
  t,
}: ComposerAttachmentsOwnerProps) {
  const [preview, setPreview] = useState<ComposerImageAttachment | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const dragDepth = useRef(0)
  const closePreview = useCallback(() => {
    setPreview(null)
  }, [])
  useEffect(() => {
    if (preview !== null && !attachments.some(attachment => attachment.id === preview.id)) setPreview(null)
  }, [attachments, preview])

  useEffect(() => installDocumentDropEvents(canAcceptDrop, onAddFiles, dragDepth, setDragActive), [canAcceptDrop, onAddFiles])

  const railItems = useMemo<ComposerRailItem[]>(
    () =>
      attachments.map(attachment => ({
        id: attachment.id,
        attachment,
      })),
    [attachments],
  )
  const previewImages = useMemo(
    () =>
      attachments.flatMap(attachment =>
        attachment.kind === 'image' ? [{ id: attachment.id, src: attachment.previewUrl, alt: attachment.file.name || t('image.original') }] : [],
      ),
    [attachments, t],
  )
  const previewIndex = preview === null ? -1 : previewImages.findIndex(image => image.id === preview.id)

  return (
    <>
      {dragActive && <DropOverlay disabled={!canAcceptDrop} labels={AttachmentGalleryLabelsModel.dropOverlayLabels(t, canAcceptDrop, dropLimits)} />}
      {railItems.length > 0 && (
        <div className={`${styles.rail} dshx-root`}>
          <AttachmentRail
            items={railItems}
            labels={AttachmentGalleryLabelsModel.attachmentRailLabels(t)}
            renderItem={item => {
              const attachment = item.attachment
              if (attachment.kind === 'file') {
                const upload = uploads[attachment.id]
                return (
                  <FileCard
                    name={attachment.file.name || t('file.label')}
                    bytes={attachment.file.size}
                    state={upload === undefined || upload.status === 'uploading' ? 'uploading' : upload.status === 'ready' ? 'ready' : 'error'}
                    {...(upload?.status === 'uploading' && upload.total !== undefined && upload.total > 0 ? { progress: upload.loaded / upload.total } : {})}
                    labels={AttachmentGalleryLabelsModel.fileCardLabels(t, attachment.file.name)}
                    onRemove={() => {
                      onRemoveAttachment(attachment.id)
                    }}
                    onRetry={() => {
                      onRetryFile(attachment.id)
                    }}
                  />
                )
              }
              return (
                <div className={styles.imageItem}>
                  <button
                    type="button"
                    className={styles.thumbnail}
                    title={t('image.openOriginal')}
                    aria-label={t('image.openOriginalLabel', { label: attachment.file.name || t('image.pending') })}
                    onClick={() => {
                      setPreview(attachment)
                    }}
                  >
                    <img src={attachment.previewUrl} alt={attachment.file.name || t('image.pending')} />
                  </button>
                  <button
                    type="button"
                    className={styles.remove}
                    aria-label={t('image.remove', { name: attachment.file.name })}
                    onClick={() => {
                      onRemoveAttachment(attachment.id)
                    }}
                  >
                    <XIcon size={12} />
                  </button>
                </div>
              )
            }}
          />
        </div>
      )}
      {preview !== null && previewIndex >= 0 && (
        <ImageLightbox images={previewImages} initialIndex={previewIndex} labels={galleryLabels} onClose={closePreview} />
      )}
    </>
  )
}
