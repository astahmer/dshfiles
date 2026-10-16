import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-trajectory/client'
import { defineClient } from '@dshfiles/dshx/client'
import { ComposerAttachments } from './client/ComposerAttachments.js'
import type { ComposerAttachmentsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { MessageImages } from './client/MessageImages.js'
import type { MessageImagesProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { AttachmentGalleryLabelsModel } from './client/labels.js'
import { ATTACHMENT_GALLERY_LOCALE_NAMESPACE, attachmentGalleryLocale } from './locales.js'

export default defineClient({
  name: '@dshfiles/attachment-gallery',
  locales: [attachmentGalleryLocale],
  inject: ['slots'],
  setup(ctx, decorate) {
    const translate = ctx.locale.bind(ATTACHMENT_GALLERY_LOCALE_NAMESPACE)
    const ComposerSlot = (props: ComposerAttachmentsProps) => (
      <ComposerAttachments {...props} galleryLabels={AttachmentGalleryLabelsModel.imageLightboxLabels(translate)} />
    )
    const MessageSlot = (props: MessageImagesProps) => <MessageImages {...props} galleryLabels={AttachmentGalleryLabelsModel.imageLightboxLabels(translate)} />

    ctx.slots.inject('conversation.input.attachments', () =>
      ctx.slots.register(
        {
          name: 'conversation.input.attachments',
          locale: 'conversation',
        },
        decorate(ComposerSlot),
      ),
    )
    ctx.slots.inject('conversation.message.images', () =>
      ctx.slots.register(
        {
          name: 'conversation.message.images',
          locale: 'conversation',
        },
        decorate(MessageSlot),
      ),
    )
    ctx.slots.inject('conversation.trajectory.images', () =>
      ctx.slots.register(
        {
          name: 'conversation.trajectory.images',
          locale: 'conversation',
        },
        decorate(MessageSlot),
      ),
    )
    ctx.slots.inject('tool.call.images', () =>
      ctx.slots.register(
        {
          name: 'tool.call.images',
          locale: 'conversation',
        },
        decorate(MessageSlot),
      ),
    )
  },
})
