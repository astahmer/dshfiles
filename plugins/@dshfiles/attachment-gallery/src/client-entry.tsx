import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import type {} from '@deepseek-ai/dsh-client-ui-trajectory/client'
import type { ComposerAttachmentsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { MessageImagesProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { defineClient } from '@dshfiles/dshx/client'
import { ComposerAttachments } from './client/ComposerAttachments.js'
import { MessageImages, MessageImagesContent } from './client/MessageImages.js'
import { AttachmentGalleryLabelsModel } from './client/labels.js'
import { ATTACHMENT_GALLERY_LOCALE_NAMESPACE, attachmentGalleryLocale } from './locales.js'

export default defineClient({
  name: '@dshfiles/attachment-gallery',
  locales: [attachmentGalleryLocale],
  inject: ['slots'],
  setup(ctx, decorate) {
    const translate = ctx.locale.bind(ATTACHMENT_GALLERY_LOCALE_NAMESPACE)
    const galleryLabels = AttachmentGalleryLabelsModel.imageLightboxLabels(translate)
    const ComposerSlot = (props: ComposerAttachmentsProps) => <ComposerAttachments {...props} galleryLabels={galleryLabels} />
    const GallerySlot = (props: FactoryComponentPropsOf<'conversation.images.content'>) => <MessageImagesContent {...props} galleryLabels={galleryLabels} />
    const ImageSlot = (props: MessageImagesProps) => <MessageImages {...props} />

    ctx.slots.inject('conversation.input.attachments', () =>
      ctx.slots.register(
        {
          name: 'conversation.input.attachments',
          locale: 'conversation',
        },
        decorate(ComposerSlot),
      ),
    )
    ctx.slots.registerFactory(
      {
        name: 'conversation.images.content',
        scope: 'root',
        locale: 'conversation',
      },
      decorate(GallerySlot),
    )
    ctx.slots.inject('conversation.chat.message.images', () =>
      ctx.slots.register(
        {
          name: 'conversation.chat.message.images',
          priority: 100,
        },
        decorate(ImageSlot),
      ),
    )
    ctx.slots.inject('conversation.chat.user.images', () =>
      ctx.slots.register(
        {
          name: 'conversation.chat.user.images',
          priority: 100,
        },
        decorate(ImageSlot),
      ),
    )
    ctx.slots.inject('conversation.trajectory.images', () =>
      ctx.slots.register(
        {
          name: 'conversation.trajectory.images',
          priority: 100,
        },
        decorate(ImageSlot),
      ),
    )
    ctx.slots.inject('tool.call.images', () =>
      ctx.slots.register(
        {
          name: 'tool.call.images',
          priority: 100,
        },
        decorate(ImageSlot),
      ),
    )
  },
})
