import type { FileBlock, ImageBlock } from '@deepseek-ai/dsh-llm'
import { hostService } from '@dshfiles/dshx/effect'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { Context, Effect, Layer, Ref, Schema, Stream } from 'effect'
import { MAX_QUEUE_FILE_BYTES } from './api.js'
import { QueuedFiles, type QueuedFileUnreadable } from './queued-files-promise.js'
import { QueueOrderModel, type QueueMoveRequest, type QueuePosition } from './queue-order.js'
import '@deepseek-ai/dsh-agent'

type AttachmentBlock = FileBlock | ImageBlock

export class QueueSessionNotLive extends Schema.TaggedError<QueueSessionNotLive>()(
  'QueueSessionNotLive',
  { sessionId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'queue-session-not-live' },
) {
  override get message(): string {
    return `Session ${this.sessionId} has no live agent, so nothing is waiting to be reordered.`
  }
}

export class QueueItemNotPending extends Schema.TaggedError<QueueItemNotPending>()(
  'QueueItemNotPending',
  { itemId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'queue-item-not-pending' },
) {
  override get message(): string {
    return `Queued item ${this.itemId} is no longer pending.`
  }
}

export class QueuedFileMissing extends Schema.TaggedError<QueuedFileMissing>()(
  'QueuedFileMissing',
  { attachmentId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'queued-file-missing' },
) {
  override get message(): string {
    return 'That file is not attached to a message queued in this session.'
  }
}

export class QueuedFileTooLarge extends Schema.TaggedError<QueuedFileTooLarge>()(
  'QueuedFileTooLarge',
  { attachmentId: Schema.String, limitBytes: Schema.Number, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'queued-file-too-large' },
) {
  override get message(): string {
    return 'That file is too large to edit in the composer.'
  }
}

/**
 * Queue reordering on a live Agent inbox. `updateQueue` cannot express a reorder, so a move is a durable inbox
 * splice: the message keeps its identity and replay, fork and resume reconstruct the order the user saw.
 */
export class QueueOrder extends Context.Service<
  QueueOrder,
  {
    readonly move: (request: QueueMoveRequest) => Effect.Effect<QueuePosition, QueueSessionNotLive | QueueItemNotPending>
    readonly describe: (sessionId: string) => Effect.Effect<ReturnType<typeof QueueOrderModel.describeInbox>>
    readonly readFile: (request: {
      readonly sessionId: string
      readonly attachmentId: string
    }) => Effect.Effect<{ readonly name: string; readonly data: string }, QueuedFileMissing | QueuedFileTooLarge | QueuedFileUnreadable>
    readonly readImage: (request: {
      readonly sessionId: string
      readonly attachmentId: string
    }) => Effect.Effect<
      { readonly name: string; readonly mediaType: string; readonly data: string },
      QueuedFileMissing | QueuedFileTooLarge | QueuedFileUnreadable
    >
  }
>()('@dshfiles/queue-reorder/QueueOrder') {
  static readonly layer = Layer.effect(
    QueueOrder,
    Effect.gen(function* () {
      const agents = yield* hostService('agents')
      const files = yield* QueuedFiles
      // Editing removes a message from the queue while Cancel and a reloaded edit still need its attachments, so a
      // reference read while queued stays readable for that session.
      const confirmedBlocks = yield* Ref.make(new Map<string, ReadonlyMap<string, AttachmentBlock>>())

      const liveInbox = (sessionId: string) => agents.get(SessionId(sessionId))?.inbox

      const move = Effect.fn('queue move')(function* (request: QueueMoveRequest) {
        const inbox = liveInbox(request.sessionId)
        if (inbox === undefined) return yield* new QueueSessionNotLive({ sessionId: request.sessionId })
        const position = QueueOrderModel.moveWithinInbox(inbox, request)
        if (position === undefined) return yield* new QueueItemNotPending({ itemId: request.itemId })
        return position
      })

      const describe = (sessionId: string) =>
        Effect.sync(() => {
          const inbox = liveInbox(sessionId)
          return inbox === undefined ? [] : QueueOrderModel.describeInbox(inbox)
        }).pipe(Effect.withSpan('queue describe'))

      const queuedBlock = Effect.fnUntraced(function* (sessionId: string, attachmentId: string) {
        const confirmed = (yield* Ref.get(confirmedBlocks)).get(sessionId)?.get(attachmentId)
        if (confirmed !== undefined) return confirmed
        const inbox = liveInbox(sessionId)
        if (inbox === undefined) return undefined
        const found = [...inbox.nextTurn, ...inbox.nextStep]
          .flatMap(message => message.content)
          .find((block): block is AttachmentBlock => (block.type === 'file' || block.type === 'image') && block.attachment.attachmentId === attachmentId)
        if (found === undefined) return undefined
        yield* Ref.update(confirmedBlocks, current => new Map(current).set(sessionId, new Map(current.get(sessionId)).set(attachmentId, found)))
        return found
      })

      const readFile = Effect.fn('queue read file')(function* (request: { readonly sessionId: string; readonly attachmentId: string }) {
        const block = yield* queuedBlock(request.sessionId, request.attachmentId)
        if (block?.type !== 'file') return yield* new QueuedFileMissing({ attachmentId: request.attachmentId })
        const ref = block.attachment
        const tooLarge = new QueuedFileTooLarge({ attachmentId: request.attachmentId, limitBytes: MAX_QUEUE_FILE_BYTES })
        if (ref.bytes > MAX_QUEUE_FILE_BYTES) return yield* tooLarge
        const read = yield* files.read(ref).pipe(
          Stream.runFoldEffect(
            () => ({ total: 0, chunks: new Array<Uint8Array>() }),
            (accumulated, chunk) => {
              const total = accumulated.total + chunk.byteLength
              if (total > MAX_QUEUE_FILE_BYTES) return Effect.fail(tooLarge)
              accumulated.chunks.push(chunk)
              return Effect.succeed({ total, chunks: accumulated.chunks })
            },
          ),
        )
        return { name: ref.name, data: Buffer.concat(read.chunks).toString('base64') }
      })

      const readImage = Effect.fn('queue read image')(function* (request: { readonly sessionId: string; readonly attachmentId: string }) {
        const block = yield* queuedBlock(request.sessionId, request.attachmentId)
        if (block?.type !== 'image') return yield* new QueuedFileMissing({ attachmentId: request.attachmentId })
        const ref = block.attachment
        const tooLarge = new QueuedFileTooLarge({ attachmentId: request.attachmentId, limitBytes: MAX_QUEUE_FILE_BYTES })
        if (ref.bytes > MAX_QUEUE_FILE_BYTES) return yield* tooLarge
        const data = yield* files.readImage(ref)
        if (data.byteLength > MAX_QUEUE_FILE_BYTES) return yield* tooLarge
        return { name: ref.name ?? 'image', mediaType: ref.mediaType, data: Buffer.from(data).toString('base64') }
      })

      return QueueOrder.of({ move, describe, readFile, readImage })
    }),
  )
}
