import type { ComposerAttachmentsProps, MessageImageLabels } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { AttachmentRailLabels } from '../AttachmentRail.js'
import type { DropOverlayLabels } from '../DropOverlay.js'
import type { FileCardLabels } from '../FileCard.js'
import type { ImageLightboxLabels } from '@dshfiles/plugin-ui/components/image-lightbox'
import type { GalleryTranslate } from '../locales.js'
import type { ImageLabels } from '../MessageImage.js'

export class AttachmentGalleryLabelsModel {
  static readonly imageLightboxLabels = (t: GalleryTranslate): ImageLightboxLabels => ({
    dialog: t('dialog'),
    close: t('close'),
    previous: t('previous'),
    next: t('next'),
    thumbnail: (position, total) => t('thumbnail', { position, total }),
    loading: t('loading'),
  })

  static readonly messageImageLabels = (t: TranslateNS<'conversation'>, lightbox: ImageLightboxLabels, override?: MessageImageLabels): ImageLabels => {
    if (override !== undefined) {
      return {
        image: override.image,
        open: override.open,
        openNamed: override.openNamed,
        loading: override.loading,
        loadFailed: override.loadFailed,
        lightbox,
      }
    }
    return {
      image: t('image.label'),
      open: t('image.openOriginal'),
      openNamed: label => t('image.openOriginalLabel', { label }),
      loading: t('image.loading'),
      loadFailed: t('image.loadFailed'),
      lightbox,
    }
  }

  static readonly dropOverlayLabels = (
    t: ComposerAttachmentsProps['t'],
    accepting: boolean,
    limits?: { readonly count: number; readonly size: string },
  ): DropOverlayLabels => {
    if (!accepting) return { title: t('attachment.dropBlocked') }
    return {
      title: t('attachment.dropTitle'),
      desc: limits === undefined ? undefined : t('attachment.dropDesc', limits),
    }
  }

  static readonly fileCardLabels = (t: ComposerAttachmentsProps['t'], name: string): FileCardLabels => ({
    label: t('file.pending'),
    remove: t('file.remove', { name }),
    uploading: t('file.uploading'),
    failed: t('file.uploadFailed'),
    retry: t('file.retry', { name }),
  })

  static readonly attachmentRailLabels = (t: ComposerAttachmentsProps['t']): AttachmentRailLabels => ({
    group: t('attachment.pending'),
    scrollLeft: t('attachment.scrollLeft'),
    scrollRight: t('attachment.scrollRight'),
  })
}
