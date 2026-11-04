import type { MessageImageSource } from '@deepseek-ai/dsh-client-ui-conversation/client'

/**
 * One position inside the images that belong to a single record: a user
 * message renders its attachment row and its inline `[Image N]` references as
 * separate slot calls, and every position opens the same preview group.
 */
export interface MessageImageGallery {
  readonly images: readonly MessageImageSource[]
  /** Position of the image this call renders inside `images`. */
  readonly index: number
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface MessageImagesOwnerProps {
    /** Whole group behind this position, when the caller renders one image of several. */
    readonly gallery?: MessageImageGallery
  }
}
