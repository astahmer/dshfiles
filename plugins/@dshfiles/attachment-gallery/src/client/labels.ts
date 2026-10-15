import type { ComposerAttachmentsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { MessageImagesProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { AttachmentRailLabels } from '../AttachmentRail.js'
import type { DropOverlayLabels } from '../DropOverlay.js'
import type { FileCardLabels } from '../FileCard.js'
import type { ImageLightboxLabels } from '../ImageLightbox.js'
import type { GalleryTranslate } from '../locales.js'
import type { ImageLabels } from '../MessageImage.js'

export function imageLightboxLabels(t: GalleryTranslate): ImageLightboxLabels {
  return {
    dialog: t('dialog'),
    close: t('close'),
    previous: t('previous'),
    next: t('next'),
    thumbnail: (position, total) => t('thumbnail', { position, total }),
    loading: t('loading'),
  }
}

export function messageImageLabels(t: MessageImagesProps['t'], lightbox: ImageLightboxLabels): ImageLabels {
  return {
    image: t('image.label'),
    open: t('image.openOriginal'),
    openNamed: label => t('image.openOriginalLabel', { label }),
    loading: t('image.loading'),
    loadFailed: t('image.loadFailed'),
    lightbox,
  }
}

export function dropOverlayLabels(
  t: ComposerAttachmentsProps['t'],
  accepting: boolean,
  limits?: { readonly count: number; readonly size: string },
): DropOverlayLabels {
  if (!accepting) return { title: t('attachment.dropBlocked') }
  return {
    title: t('attachment.dropTitle'),
    desc: limits === undefined ? undefined : t('attachment.dropDesc', limits),
  }
}

export function fileCardLabels(t: ComposerAttachmentsProps['t'], name: string): FileCardLabels {
  return {
    label: t('file.pending'),
    remove: t('file.remove', { name }),
    uploading: t('file.uploading'),
    failed: t('file.uploadFailed'),
    retry: t('file.retry', { name }),
  }
}

export function attachmentRailLabels(t: ComposerAttachmentsProps['t']): AttachmentRailLabels {
  return {
    group: t('attachment.pending'),
    scrollLeft: t('attachment.scrollLeft'),
    scrollRight: t('attachment.scrollRight'),
  }
}
