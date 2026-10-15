import type { MessageImagesProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { ImageGallery } from '../MessageImage.js'
import type { ImageLightboxLabels } from '../ImageLightbox.js'
import { messageImageLabels } from './labels.js'

export function MessageImages({
  images,
  loadImage,
  align,
  compact = false,
  thumbnail = false,
  t,
  galleryLabels,
}: MessageImagesProps & {
  galleryLabels: ImageLightboxLabels
}) {
  return <ImageGallery images={images} load={loadImage} align={align} compact={compact} thumbnail={thumbnail} labels={messageImageLabels(t, galleryLabels)} />
}
