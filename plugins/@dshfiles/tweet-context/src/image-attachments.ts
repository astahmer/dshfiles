import type { AttachmentStore, ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { hostService } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer } from 'effect'
import { saveImagesWith } from './attachment-store-promise.js'
import { AttachmentSaveFailed } from './errors.js'
import type { TweetAttachment } from './tweet-model.js'

const toAttachment = (reference: ImageAttachmentRef): TweetAttachment => ({
  attachmentId: reference.attachmentId,
  mediaType: reference.mediaType,
  bytes: reference.bytes,
  width: reference.width,
  height: reference.height,
  ...(reference.name !== undefined && { name: reference.name }),
  ...(reference.originalDimensions !== undefined && { originalDimensions: reference.originalDimensions }),
})

/** The Host attachment store, saving photos and sampled frames as image attachments for vision-capable models. */
export class ImageAttachments extends Context.Service<
  ImageAttachments,
  { readonly save: (images: ReadonlyArray<SaveImageAttachment>) => Effect.Effect<ReadonlyArray<TweetAttachment>, AttachmentSaveFailed> }
>()('@dshfiles/tweet-context/ImageAttachments') {
  static readonly fromStore = (store: Pick<AttachmentStore, 'saveImages'>) =>
    ImageAttachments.of({
      save: images =>
        saveImagesWith(store)(images).pipe(
          Effect.flatMap(saved =>
            saved.length === images.length ? Effect.succeed(saved.map(toAttachment)) : Effect.fail(new AttachmentSaveFailed({ reason: 'incomplete' })),
          ),
        ),
    })

  static readonly layer = Layer.effect(ImageAttachments, Effect.map(hostService('attachments'), ImageAttachments.fromStore))
}
