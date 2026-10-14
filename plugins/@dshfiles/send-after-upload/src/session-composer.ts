import type { Context } from '@deepseek-ai/cordis'
import type { ComposerAttachment, DraftAttachmentId, DraftFileUploads, SessionInput } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { z } from 'zod'
import { startPendingSend, type ComposerView, type PendingSendActor, type PendingSendPorts, type UploadStatus } from './pending-send-machine.js'

/**
 * The Conversation controller's draft-attachment registry. `IConversation` does not type it, so it is decoded once
 * here; a Conversation build without it leaves Enter to the native composer.
 */
interface DraftUploads {
  resolveDraftAttachments(ids: readonly DraftAttachmentId[]): readonly ComposerAttachment[]
  readonly fileUploads: { getSnapshot(): DraftFileUploads; subscribe(listener: () => void): () => void }
}

interface ConversationWithInput {
  readonly input: { for(ctx: Context): SessionInput }
}

const conversationSchema = z.object({
  resolveDraftAttachments: z.instanceof(Function),
  fileUploads: z.object({ getSnapshot: z.instanceof(Function), subscribe: z.instanceof(Function) }),
  input: z.object({ for: z.instanceof(Function) }),
})

// The schema only proves the shape; the guard hands back the live controller so its methods keep their `this`.
const isConversation = (value: unknown): value is DraftUploads & ConversationWithInput => conversationSchema.safeParse(value).success

const isDraftAttachmentId = (value: string): value is DraftAttachmentId => value.length > 0

export interface SessionComposer {
  readonly view: () => ComposerView & { readonly plain: boolean }
  readonly uploadStatus: (ids: readonly string[]) => UploadStatus
  readonly actor: PendingSendActor
}

const memoizedView = (input: SessionInput): (() => ComposerView & { readonly plain: boolean }) => {
  let cache: { readonly source: unknown; readonly view: ComposerView & { readonly plain: boolean } } | undefined
  return () => {
    const state = input.state.getSnapshot()
    if (cache?.source !== state) cache = { source: state, view: { draft: state.draft, attachmentIds: state.attachmentIds, plain: state.phase === 'plain' } }
    return cache.view
  }
}

const composers = new Map<SessionId, { readonly input: SessionInput; readonly composer: SessionComposer }>()

/** The pending-send actor of one session's composer, kept for the page's lifetime so a wait survives a thread switch. */
export const sessionComposer = (ctx: Context, sessionId: SessionId): SessionComposer | undefined => {
  const scoped = ctx.sessions.scope(sessionId)
  const conversation = scoped?.get('conversation')
  if (scoped === undefined || !isConversation(conversation)) return undefined
  const input = conversation.input.for(scoped)
  const existing = composers.get(sessionId)
  if (existing?.input === input) return existing.composer
  existing?.composer.actor.stop()

  const uploadStatus = (ids: readonly string[]): UploadStatus => {
    const uploads = conversation.fileUploads.getSnapshot()
    const files = conversation.resolveDraftAttachments(ids.filter(isDraftAttachmentId)).filter(attachment => attachment.kind === 'file')
    if (files.some(file => uploads[file.id]?.status === 'error')) return 'failed'
    return files.every(file => uploads[file.id]?.status === 'ready') ? 'ready' : 'uploading'
  }
  const view = memoizedView(input)
  const ports: PendingSendPorts = {
    composer: { getSnapshot: view, subscribe: listener => input.state.subscribe(listener) },
    uploads: { status: uploadStatus, subscribe: listener => conversation.fileUploads.subscribe(listener) },
    // A deferred send queues behind a running turn rather than steering it: the user asked to send, not to interrupt.
    submit: async () => input.submit('queue', 'enter'),
  }
  const composer: SessionComposer = { view, uploadStatus, actor: startPendingSend(ports) }
  composers.set(sessionId, { input, composer })
  return composer
}

export const disposeSessionComposers = (): void => {
  for (const entry of composers.values()) entry.composer.actor.stop()
  composers.clear()
}
