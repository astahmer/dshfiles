import type { FileBlock } from '@deepseek-ai/dsh-llm'
import { HostContext, hostService } from '@dshfiles/dshx/effect'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { Context, Effect, Layer, Ref, Schema, Stream } from 'effect'
import { MAX_QUEUE_FILE_BYTES } from './api.js'
import { QueueOrderModel, type QueueMoveRequest, type QueuePosition } from './queue-order.js'
import '@deepseek-ai/dsh-agent'

type FileAttachmentRef = FileBlock['attachment']

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

export class QueuedFileUnreadable extends Schema.TaggedError<QueuedFileUnreadable>()(
  'QueuedFileUnreadable',
  { attachmentId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'queued-file-unreadable' },
) {
  override get message(): string {
    return 'That queued file could not be read. Remove it from the message or queue it again.'
  }
}

interface FileReader {
  readFileStream(ref: FileAttachmentRef): AsyncIterable<Uint8Array>
}

const isFileReader = (value: unknown): value is FileReader =>
  typeof value === 'object' && value !== null && 'readFileStream' in value && typeof value.readFileStream === 'function'

/** The Host attachment store, read lazily: it is not injected, and an older Host may lack it. */
export class QueuedFiles extends Context.Service<QueuedFiles, { readonly read: (ref: FileAttachmentRef) => Stream.Stream<Uint8Array, QueuedFileUnreadable> }>()(
  '@dshfiles/queue-reorder/QueuedFiles',
) {
  static readonly layer = Layer.effect(
    QueuedFiles,
    Effect.gen(function* () {
      const host = yield* HostContext
      return QueuedFiles.of({
        read: ref =>
          Stream.unwrap(
            Effect.gen(function* () {
              const store: unknown = host.ctx.get('attachments')
              if (!isFileReader(store)) return yield* new QueuedFileUnreadable({ attachmentId: ref.attachmentId })
              return Stream.fromAsyncIterable(store.readFileStream(ref), cause => new QueuedFileUnreadable({ attachmentId: ref.attachmentId, cause }))
            }),
          ),
      })
    }),
  )
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
  }
>()('@dshfiles/queue-reorder/QueueOrder') {
  static readonly layer = Layer.effect(
    QueueOrder,
    Effect.gen(function* () {
      const agents = yield* hostService('agents')
      const files = yield* QueuedFiles
      // Editing removes a message from the queue while Cancel still needs its files, so a seen reference stays readable.
      const confirmedFiles = yield* Ref.make(new Map<string, ReadonlyMap<string, FileAttachmentRef>>())

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

      const queuedFileRef = Effect.fnUntraced(function* (sessionId: string, attachmentId: string) {
        const confirmed = (yield* Ref.get(confirmedFiles)).get(sessionId)?.get(attachmentId)
        if (confirmed !== undefined) return confirmed
        const inbox = liveInbox(sessionId)
        if (inbox === undefined) return undefined
        const found = [...inbox.nextTurn, ...inbox.nextStep]
          .flatMap(message => message.content)
          .find((block): block is FileBlock => block.type === 'file' && block.attachment.attachmentId === attachmentId)
        if (found === undefined) return undefined
        yield* Ref.update(confirmedFiles, current => new Map(current).set(sessionId, new Map(current.get(sessionId)).set(attachmentId, found.attachment)))
        return found.attachment
      })

      const readFile = Effect.fn('queue read file')(function* (request: { readonly sessionId: string; readonly attachmentId: string }) {
        const ref = yield* queuedFileRef(request.sessionId, request.attachmentId)
        if (ref === undefined) return yield* new QueuedFileMissing({ attachmentId: request.attachmentId })
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

      return QueueOrder.of({ move, describe, readFile })
    }),
  )
}
