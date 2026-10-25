import type { Context } from '@deepseek-ai/cordis'
import type { SessionFace } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PromptContentPart } from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { ComposerAttachment, DraftAttachmentId, DraftFileUploads, SessionInput, SubmitAttachment } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { MessageId } from '@deepseek-ai/dsh-llm/brand'
import type { ApiClient } from '@dshfiles/dshx/api'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import { z } from 'zod'
import type { queueApi } from './api.js'
import {
  createQueueEditor,
  QueueEditModel,
  queueEditRecordsSchema,
  type PromptPart,
  type QueuedFileAttachment,
  type QueuedImageAttachment,
  type QueueEditor,
  type QueueEditRecord,
  type QueuedRow,
} from './queue-edit.js'
import { startQueueTransfer, type QueueTransferActor } from './queue-transfer.js'

/**
 * Binds the queue editor to one live DSH session: its inbox projection, its pending submissions, its composer
 * input, the Conversation's draft-attachment registry, and this plugin's Host API.
 *
 * Every Host or Client service is reached through a decoded boundary. When a piece is missing — an older Host
 * without `readFile`, or a Conversation build without draft attachments — editing degrades instead of throwing.
 */

type QueueApiClient = ApiClient<(typeof queueApi)['methods']>
type AttachmentIdType = Parameters<SessionFace['readAttachment']>[0]
type ReceiptId = Extract<PromptContentPart, { readonly type: 'file' }>['receiptId']

interface DraftAttachmentApi {
  createDrafts(sessionId: SessionFace['sessionId'], files: readonly File[]): readonly ComposerAttachment[]
  releaseDraftAttachment(id: DraftAttachmentId): void
  resolveDraftAttachments(ids: readonly DraftAttachmentId[]): readonly ComposerAttachment[]
  serializeDraftAttachments(ids: readonly DraftAttachmentId[]): Promise<{ readonly attachments: readonly SubmitAttachment[] }>
  readonly fileUploads: { getSnapshot(): DraftFileUploads; subscribe(listener: () => void): () => void }
}

interface ConversationWithInput {
  readonly input: { for(ctx: Context): SessionInput }
}

const draftAttachmentApiShape = z.object({
  createDrafts: z.function(),
  releaseDraftAttachment: z.function(),
  resolveDraftAttachments: z.function(),
  serializeDraftAttachments: z.function(),
  fileUploads: z.object({ subscribe: z.function() }),
})

const sessionInputShape = z.object({ input: z.object({ for: z.function() }) })

// Only the shape is checked; callers keep the original object, whose methods rely on their own `this`.
const hasDraftAttachmentApi = (value: unknown): value is DraftAttachmentApi => draftAttachmentApiShape.safeParse(value).success

const hasSessionInput = (value: unknown): value is ConversationWithInput => sessionInputShape.safeParse(value).success

const isAttachmentId = (value: string): value is AttachmentIdType => value.length > 0
const isReceiptId = (value: string): value is ReceiptId => value.length > 0

/** One upload wait never outlives a stuck network: Cancel reports the failure and stays retryable. */
const UPLOAD_TIMEOUT_MS = 5 * 60_000

const bytesFromBase64 = (data: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

const memoized = <Source, Value>(read: () => Source, derive: (source: Source) => Value): (() => Value) => {
  let cache: { readonly source: Source; readonly value: Value } | undefined
  return () => {
    const source = read()
    if (cache?.source !== source) cache = { source, value: derive(source) }
    return cache.value
  }
}

const noEdits: Record<string, QueueEditRecord> = {}
const storedEdits = createStoredValue({ key: 'dshfiles.queue-reorder.edits.v1', schema: queueEditRecordsSchema, fallback: noEdits })

/** The Host API client, set by the dock: dshx hands it out only inside a Client Slot component. */
let queueClient: QueueApiClient | undefined

export const useQueueClientForEditing = (client: QueueApiClient): void => {
  queueClient = client
}

const requireQueueClient = (): QueueApiClient => {
  if (queueClient === undefined) throw new Error('queue dock is not mounted')
  return queueClient
}

const waitForUploads = (drafts: DraftAttachmentApi, ids: readonly DraftAttachmentId[]): Promise<void> => {
  const fileIds = drafts.resolveDraftAttachments(ids).flatMap(draft => (draft.kind === 'file' ? [draft.id] : []))
  return new Promise((resolve, reject) => {
    let unsubscribe = (): void => {}
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error('a file upload did not finish'))
    }, UPLOAD_TIMEOUT_MS)
    const check = (): boolean => {
      const uploads = drafts.fileUploads.getSnapshot()
      const failed = fileIds.find(id => uploads[id]?.status === 'error')
      if (failed !== undefined) {
        clearTimeout(timer)
        reject(new Error('a file upload failed'))
        return true
      }
      if (!fileIds.every(id => uploads[id]?.status === 'ready')) return false
      clearTimeout(timer)
      resolve()
      return true
    }
    if (check()) return
    unsubscribe = drafts.fileUploads.subscribe(() => {
      if (check()) unsubscribe()
    })
  })
}

const toPromptPart = (part: { readonly type: 'text'; readonly text: string } | SubmitAttachment): PromptContentPart => {
  if (part.type !== 'file') return part
  if (!isReceiptId(part.receiptId)) throw new Error('a file upload has no receipt')
  return { type: 'file', receiptId: part.receiptId }
}

/** Reads a session's queued attachments back as files, and queues or removes its messages. */
const sessionQueueIo = (input: { readonly sessionId: SessionFace['sessionId']; readonly session: SessionFace }) => ({
  readImage: async (attachment: QueuedImageAttachment): Promise<File> => {
    if (!isAttachmentId(attachment.attachmentId)) throw new Error('image has no id')
    const result = await input.session.readAttachment(attachment.attachmentId)
    if (!result.ok) throw new Error(result.error.message)
    const name = attachment.name ?? result.value.attachment.name ?? 'image'
    return new File([new Uint8Array(result.value.data)], name, { type: result.value.attachment.mediaType })
  },
  readFile: async (attachment: QueuedFileAttachment): Promise<File> => {
    const file = await requireQueueClient().readFile({ sessionId: input.sessionId, attachment })
    return new File([bytesFromBase64(file.data)], file.name)
  },
  remove: async (itemId: string): Promise<void> => {
    const result = await input.session.updateQueue(MessageId(itemId), { kind: 'remove' })
    if (!result.ok) throw new Error(result.error.message)
  },
  enqueue: async (parts: readonly PromptPart<SubmitAttachment>[]): Promise<string> => {
    const text = parts.flatMap(part => (part.type === 'text' ? [part.text] : [])).join('')
    const handle = input.session.beginSubmission({ mode: 'queue', text, attachments: [] })
    let content: PromptContentPart[]
    try {
      content = parts.map(toPromptPart)
    } catch (error) {
      handle.abandon()
      throw error
    }
    const result = await input.session.prompt(content, 'queue', undefined, handle.requestId)
    if (!result.ok) throw new Error(result.error.message)
    return handle.requestId
  },
})

/** Upload `files` as draft attachments of one session and answer with their wire payloads, releasing the drafts. */
const serializeFiles = async (
  drafts: DraftAttachmentApi,
  sessionId: SessionFace['sessionId'],
  files: readonly File[],
): Promise<readonly SubmitAttachment[]> => {
  const ids = drafts.createDrafts(sessionId, files).map(draft => draft.id)
  try {
    await waitForUploads(drafts, ids)
    return (await drafts.serializeDraftAttachments(ids)).attachments
  } finally {
    for (const id of ids) drafts.releaseDraftAttachment(id)
  }
}

const createEditor = (input: {
  readonly sessionId: SessionFace['sessionId']
  readonly session: SessionFace
  readonly composer: SessionInput
  readonly drafts: DraftAttachmentApi
}): QueueEditor => {
  const inbox = input.session.projections.faceOf('inbox')
  const key: string = input.sessionId
  const io = sessionQueueIo(input)
  const records = {
    load: (): QueueEditRecord | null => storedEdits.get()[key] ?? null,
    save: (record: QueueEditRecord | null): void => {
      const { [key]: _previous, ...others } = storedEdits.get()
      storedEdits.set(record === null ? others : { ...others, [key]: record })
    },
  }
  return createQueueEditor<DraftAttachmentId, SubmitAttachment>({
    queue: { getSnapshot: memoized(() => inbox.getSnapshot(), QueueEditModel.decodeQueuedRows), subscribe: listener => inbox.subscribe(listener) },
    pendingRequestIds: {
      getSnapshot: memoized(
        () => input.session.getSnapshot(),
        snapshot => snapshot.pendingSubmissions.map(submission => submission.requestId),
      ),
      subscribe: listener => input.session.subscribe(listener),
    },
    composer: {
      getSnapshot: memoized(
        () => input.composer.state.getSnapshot(),
        state => ({ draft: state.draft, attachmentIds: state.attachmentIds, idle: state.phase === 'plain' }),
      ),
      subscribe: listener => input.composer.state.subscribe(listener),
      setDraft: text => input.composer.setDraft(text),
      addAttachments: ids => input.composer.addAttachments(ids),
      removeAttachment: id => {
        input.composer.removeAttachment(id)
      },
      submit: () => input.composer.submit('queue', 'click'),
      focus: () => input.composer.focus(),
    },
    drafts: {
      create: files => input.drafts.createDrafts(input.sessionId, files).map(draft => draft.id),
      release: ids => {
        for (const id of ids) input.drafts.releaseDraftAttachment(id)
      },
      live: ids => input.drafts.resolveDraftAttachments(ids).map(draft => draft.id),
      serialize: async ids => {
        await waitForUploads(input.drafts, ids)
        return (await input.drafts.serializeDraftAttachments(ids)).attachments
      },
    },
    host: {
      readImage: io.readImage,
      readFile: io.readFile,
      remove: io.remove,
      enqueue: io.enqueue,
      move: async (itemId, direction) => (await requireQueueClient().move({ sessionId: input.sessionId, itemId, direction })).index,
    },
    records,
  })
}

const editors = new Map<string, { readonly session: SessionFace; readonly editor: QueueEditor; readonly release: () => void }>()

/**
 * The editor for one session, kept for the page's lifetime so an edit survives switching threads. During attachment
 * loading and while a record is open, the session stays retained so the async edit can finish against its owner.
 */
const sessionQueueEditor = (ctx: Context, sessionId: SessionFace['sessionId']): QueueEditor | undefined => {
  const binding = ctx.sessions.binding(sessionId)
  const scoped = ctx.sessions.scope(sessionId)
  if (binding === undefined || scoped === undefined) return undefined
  const existing = editors.get(sessionId)
  if (existing?.session === binding.session) return existing.editor
  existing?.release()
  existing?.editor.dispose()
  const conversation = scoped.get('conversation')
  if (!hasDraftAttachmentApi(conversation) || !hasSessionInput(conversation)) return undefined
  const editor = createEditor({ sessionId, session: binding.session, composer: conversation.input.for(scoped), drafts: conversation })
  let reference: { release(): void } | undefined
  const retainWhileEditing = (): void => {
    const editing = QueueEditModel.retainsSession(editor.getSnapshot())
    if (editing && reference === undefined) reference = ctx.sessions.retain(sessionId, { source: 'controllerOperation' })
    if (!editing && reference !== undefined) {
      reference.release()
      reference = undefined
    }
  }
  const stopRetaining = editor.subscribe(retainWhileEditing)
  retainWhileEditing()
  editors.set(sessionId, {
    session: binding.session,
    editor,
    release: () => {
      stopRetaining()
      reference?.release()
    },
  })
  return editor
}

/** Reads one queued image of a session, for the dock's thumbnails. */
const sessionImageReader = (ctx: Context, sessionId: SessionFace['sessionId']): ((attachment: QueuedImageAttachment) => Promise<Blob>) | undefined => {
  const binding = ctx.sessions.binding(sessionId)
  return binding === undefined ? undefined : sessionQueueIo({ sessionId, session: binding.session }).readImage
}

const transfers = new Map<string, { readonly session: SessionFace; readonly actor: QueueTransferActor }>()

/** Main view retention a just-opened thread takes before this plugin lets go of its own reference. */
const OPEN_TIMEOUT_MS = 5_000

const openedInMainView = (ctx: Context, sessionId: SessionFace['sessionId']): Promise<void> =>
  new Promise(resolve => {
    const info = ctx.sessions.retainInfo(sessionId)
    const opened = (): boolean => (info.getSnapshot().retainedBy.mainView ?? 0) > 0
    if (opened()) return resolve()
    const timer = setTimeout(() => {
      unsubscribe()
      resolve()
    }, OPEN_TIMEOUT_MS)
    const unsubscribe = info.subscribe(() => {
      if (!opened()) return
      clearTimeout(timer)
      unsubscribe()
      resolve()
    })
  })

const conversationOf = (ctx: Context, sessionId: SessionFace['sessionId']) => {
  const scoped = ctx.sessions.scope(sessionId)
  const conversation = scoped?.get('conversation')
  if (scoped === undefined || !hasDraftAttachmentApi(conversation) || !hasSessionInput(conversation)) return undefined
  return { drafts: conversation, composer: conversation.input.for(scoped) }
}

/**
 * The "Move to thread" flow for one session's queue, kept for the page's lifetime like the editor: opening the
 * target thread unmounts this dock, and the move must still finish.
 */
const sessionQueueTransfer = (ctx: Context, sessionId: SessionFace['sessionId']): QueueTransferActor | undefined => {
  const binding = ctx.sessions.binding(sessionId)
  const source = conversationOf(ctx, sessionId)
  if (binding === undefined || source === undefined) return undefined
  const existing = transfers.get(sessionId)
  if (existing?.session === binding.session) return existing.actor
  const io = sessionQueueIo({ sessionId, session: binding.session })
  const actor = startQueueTransfer({
    load: async blocks =>
      Promise.all(
        blocks.flatMap(block => (block.type === 'image' ? [io.readImage(block.attachment)] : block.type === 'file' ? [io.readFile(block.attachment)] : [])),
      ),
    remove: io.remove,
    restore: async input => {
      await io.enqueue(QueueEditModel.promptPartsFor(input.blocks, await serializeFiles(source.drafts, sessionId, input.files)))
    },
    deliver: async input => {
      const targetId = ctx.sessions.list.getSnapshot().ids.find(id => id === input.target.id)
      if (targetId === undefined) throw new Error(`${input.target.title} is no longer listed`)
      const reference = ctx.sessions.retain(targetId, { source: 'controllerOperation' })
      try {
        const target = await reference.ready
        const conversation = conversationOf(ctx, targetId)
        if (conversation === undefined) throw new Error('that thread has no composer')
        if (target.session.getSnapshot().running) {
          await sessionQueueIo({ sessionId: targetId, session: target.session }).enqueue(
            QueueEditModel.promptPartsFor(input.blocks, await serializeFiles(conversation.drafts, targetId, input.files)),
          )
          return 'queue'
        }
        const text = input.blocks.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')
        const draft = conversation.composer.state.getSnapshot().draft
        const ids = conversation.drafts.createDrafts(targetId, input.files).map(created => created.id)
        if (ids.length > 0 && !conversation.composer.addAttachments(ids)) {
          for (const id of ids) conversation.drafts.releaseDraftAttachment(id)
          throw new Error(`${input.target.title}'s composer is busy`)
        }
        conversation.composer.setDraft(draft.trim().length === 0 ? text : `${draft}\n\n${text}`)
        ctx.uiWorkspace.openSession(targetId)
        await openedInMainView(ctx, targetId)
        return 'composer'
      } finally {
        reference.release()
      }
    },
  })
  existing?.actor.stop()
  transfers.set(sessionId, { session: binding.session, actor })
  return actor
}

export type { QueuedRow }

export class SessionQueueEditorModel {
  static readonly editor = sessionQueueEditor
  static readonly imageReader = sessionImageReader
  static readonly transfer = sessionQueueTransfer
}
