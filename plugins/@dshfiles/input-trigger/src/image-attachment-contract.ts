import type { SessionId } from '@deepseek-ai/dsh-session/types'

export interface ImageAttachmentReference {
  readonly id: string
  readonly label: string
}

export interface ImageAttachmentSourceRegistration {
  readonly imagesFor: (sessionId: SessionId) => readonly ImageAttachmentReference[]
  readonly open: (sessionId: SessionId, id: string) => boolean
}

export interface ImageAttachmentSourceRegistry {
  /** Register the composer image-reference source and return its disposer. */
  registerImageAttachmentSource(source: ImageAttachmentSourceRegistration): () => void
}
