import type { AttachmentStore, ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import { Effect } from 'effect'
import { AttachmentSaveFailed } from './errors.js'

/** The Host attachment store's Promise `saveImages` as an Effect; a rejection keeps its cause for the Host log. */
export const saveImagesWith =
  (store: Pick<AttachmentStore, 'saveImages'>) =>
  (images: ReadonlyArray<SaveImageAttachment>): Effect.Effect<ReadonlyArray<ImageAttachmentRef>, AttachmentSaveFailed> =>
    Effect.tryPromise({ try: () => store.saveImages(images), catch: cause => new AttachmentSaveFailed({ reason: 'rejected', cause }) })
