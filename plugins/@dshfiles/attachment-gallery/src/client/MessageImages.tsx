import type { FactoryComponentPropsOf } from '@deepseek-ai/dsh-client-ui-slots'
import type { MessageImagesProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@dshfiles/chat/message-images'
import { ImageGallery } from '../MessageImage.js'
import type { ImageLightboxLabels } from '@dshfiles/plugin-ui/components/image-lightbox'
import { AttachmentGalleryLabelsModel } from './labels.js'

/** Shared gallery definition: one registration fills every image position. */
export function MessageImagesContent({
  images,
  loadImage,
  align,
  compact = false,
  thumbnail = false,
  labels,
  t,
  galleryLabels,
  gallery,
}: FactoryComponentPropsOf<'conversation.images.content'> & {
  galleryLabels: ImageLightboxLabels
}) {
  return (
    <ImageGallery
      images={images}
      load={loadImage}
      align={align}
      compact={compact}
      thumbnail={thumbnail}
      labels={AttachmentGalleryLabelsModel.messageImageLabels(t, galleryLabels, labels)}
      {...(gallery !== undefined && { gallery })}
    />
  )
}

/** Fill a message, trajectory, or tool image position through the shared gallery. */
export function MessageImages({ images, loadImage, align, compact, thumbnail, gallery, renderFactorySlot }: MessageImagesProps) {
  return renderFactorySlot('conversation.images.content', {
    images,
    loadImage,
    align,
    ...(compact !== undefined && { compact }),
    ...(thumbnail !== undefined && { thumbnail }),
    ...(gallery !== undefined && { gallery }),
  })
}
