import type { ComposerAttachment, DraftAttachmentId, DraftFileUploads, IConversation } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { z } from 'zod'

/**
 * The conversation service's draft attachment registry. Draft attachments belong to one Session, so a draft moved to
 * another Session needs its files registered there again; `IConversation` does not declare these methods, though
 * the controller behind it implements them.
 */
interface DraftAttachments {
  createDrafts(sessionId: SessionId, files: readonly File[]): readonly ComposerAttachment[]
  resolveDraftAttachments(ids: readonly DraftAttachmentId[]): readonly ComposerAttachment[]
  releaseDraftAttachment(id: DraftAttachmentId): void
  readonly fileUploads: { getSnapshot(): DraftFileUploads; subscribe(listener: () => void): () => void }
}

const draftAttachmentsShape = z.object({
  createDrafts: z.function(),
  resolveDraftAttachments: z.function(),
  releaseDraftAttachment: z.function(),
  fileUploads: z.object({ getSnapshot: z.function(), subscribe: z.function() }),
})

// Only the shape is checked; callers keep the original object, whose methods rely on their own `this`.
const isDraftAttachments = (value: IConversation): value is IConversation & DraftAttachments => draftAttachmentsShape.safeParse(value).success

/** A carried file uploads again for its new Session; the prompt cites the receipt, so the send waits for it. */
const UPLOAD_TIMEOUT_MS = 5 * 60_000

const uploaded = (drafts: DraftAttachments, ids: readonly DraftAttachmentId[], signal: AbortSignal): Promise<boolean> => {
  const fileIds = drafts.resolveDraftAttachments(ids).flatMap(draft => (draft.kind === 'file' ? [draft.id] : []))
  return new Promise(resolve => {
    let unsubscribe = (): void => undefined
    const lifetime = AbortSignal.any([signal, AbortSignal.timeout(UPLOAD_TIMEOUT_MS)])
    const finish = (ready: boolean): void => {
      unsubscribe()
      lifetime.removeEventListener('abort', abandon)
      resolve(ready)
    }
    const abandon = (): void => finish(false)
    const check = (): void => {
      const uploads = drafts.fileUploads.getSnapshot()
      if (fileIds.some(id => uploads[id]?.status === 'error')) finish(false)
      else if (fileIds.every(id => uploads[id]?.status === 'ready')) finish(true)
    }
    unsubscribe = drafts.fileUploads.subscribe(check)
    lifetime.addEventListener('abort', abandon, { once: true })
    check()
  })
}

export class DraftAttachmentCarry {
  /**
   * The files behind a draft's attachments, read when it is sent: leaving the Session releases its image drafts.
   * @returns the files in draft order, or undefined when one is no longer registered.
   */
  static filesOf(conversation: IConversation, ids: readonly DraftAttachmentId[]): readonly File[] | undefined {
    if (ids.length === 0) return []
    if (!isDraftAttachments(conversation)) return undefined
    const drafts = conversation.resolveDraftAttachments(ids)
    return drafts.length === ids.length ? drafts.map(draft => draft.file) : undefined
  }

  /**
   * Register files as draft attachments of `sessionId` and wait until they can be sent.
   * @returns the new ids in file order, or undefined when they could not be registered or uploaded.
   */
  static async carry(input: {
    readonly conversation: IConversation
    readonly files: readonly File[]
    readonly sessionId: SessionId
    readonly signal: AbortSignal
  }): Promise<readonly DraftAttachmentId[] | undefined> {
    if (input.files.length === 0) return []
    const drafts = input.conversation
    if (!isDraftAttachments(drafts)) return undefined
    const created = drafts.createDrafts(input.sessionId, input.files).map(draft => draft.id)
    if (created.length === input.files.length && (await uploaded(drafts, created, input.signal))) return created
    for (const id of created) drafts.releaseDraftAttachment(id)
    return undefined
  }
}
