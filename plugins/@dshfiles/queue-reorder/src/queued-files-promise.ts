import type { FileBlock, ImageBlock } from '@deepseek-ai/dsh-llm'
import { HostContext } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, Schema, Stream } from 'effect'

type FileAttachmentRef = FileBlock['attachment']
type ImageAttachmentRef = ImageBlock['attachment']

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

interface ImageReader {
  readImage(ref: ImageAttachmentRef): Promise<{ readonly data: Uint8Array }>
}

const isFileReader = (value: unknown): value is FileReader =>
  typeof value === 'object' && value !== null && 'readFileStream' in value && typeof value.readFileStream === 'function'

const isImageReader = (value: unknown): value is ImageReader =>
  typeof value === 'object' && value !== null && 'readImage' in value && typeof value.readImage === 'function'

/** The Host attachment store, read lazily: it is not injected, and an older Host may lack it. */
export class QueuedFiles extends Context.Service<
  QueuedFiles,
  {
    readonly read: (ref: FileAttachmentRef) => Stream.Stream<Uint8Array, QueuedFileUnreadable>
    readonly readImage: (ref: ImageAttachmentRef) => Effect.Effect<Uint8Array, QueuedFileUnreadable>
  }
>()('@dshfiles/queue-reorder/QueuedFiles') {
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
        readImage: ref =>
          Effect.gen(function* () {
            const store: unknown = host.ctx.get('attachments')
            if (!isImageReader(store)) return yield* new QueuedFileUnreadable({ attachmentId: ref.attachmentId })
            const stored = yield* Effect.tryPromise({
              try: () => store.readImage(ref),
              catch: cause => new QueuedFileUnreadable({ attachmentId: ref.attachmentId, cause }),
            })
            return stored.data
          }),
      })
    }),
  )
}
