import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { AttachmentId, type ImageAttachmentRef, type ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { SESSION_FORMAT_VERSION, SessionId, type SessionEvent, type SessionHeader } from '@deepseek-ai/dsh-session/types'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { HostContext, hostService } from '@dshfiles/dshx/effect'
import { Effect, Layer, Option, Schema } from 'effect'
import type { AttachmentReference } from './bundle.js'
import { ThreadNotFound, ThreadStore, ThreadStoreFailed } from './transfer-service.js'

const IMAGE_MEDIA_TYPES: readonly ImageMediaType[] = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const isImageMediaType = (value: string | undefined): value is ImageMediaType => IMAGE_MEDIA_TYPES.some(type => type === value)

const envelope = Schema.Struct({ seq: Schema.Number, type: Schema.String, time: Schema.Number, data: Schema.Unknown })
/** Shape check only: the persistence backend validates every event's vocabulary and payload when it appends them. */
const isSessionEvent = (value: unknown): value is SessionEvent => Schema.is(envelope)(value)

const failed = (operation: string) => (cause: unknown) => new ThreadStoreFailed({ operation, cause })

const imageRefOf = (reference: Extract<AttachmentReference, { readonly kind: 'image' }>): ImageAttachmentRef | undefined => {
  if (!isImageMediaType(reference.mediaType)) return undefined
  const ref: ImageAttachmentRef = {
    attachmentId: AttachmentId(reference.attachmentId),
    mediaType: reference.mediaType,
    bytes: reference.bytes,
    width: reference.width,
    height: reference.height,
  }
  return reference.name === undefined ? ref : { ...ref, name: reference.name }
}

const collect = async (chunks: AsyncIterable<Uint8Array>): Promise<Uint8Array> => {
  const parts: Uint8Array[] = []
  for await (const chunk of chunks) parts.push(chunk)
  return new Uint8Array(Buffer.concat(parts))
}

/**
 * The Host services a transfer reads and writes, each looked up at its call because any of them may load after this
 * plugin: Session persistence (the log itself), the attachment store, and the workspace registry.
 */
export const threadStoreLayer = Layer.effect(
  ThreadStore,
  Effect.gen(function* () {
    const host = yield* HostContext
    const service = <K extends 'sessionPersistence' | 'attachments' | 'workspaceRegistry' | 'sessionController'>(name: K, operation: string) =>
      Effect.provideService(hostService(name), HostContext, host).pipe(Effect.mapError(failed(operation)))

    const read = Effect.fn('thread store read')(function* (sessionId: string) {
      const persistence = yield* service('sessionPersistence', 'read the thread')
      const id = SessionId(sessionId)
      // The durability barrier: a live thread's newest events reach storage before they are read.
      yield* Effect.tryPromise(() => persistence.flush()).pipe(Effect.ignore)
      const stat = yield* Effect.tryPromise({ try: signal => persistence.stat(id, { signal }), catch: failed('read the thread') })
      if (stat === undefined) return yield* new ThreadNotFound({ sessionId })
      const events = yield* Effect.acquireUseRelease(
        Effect.tryPromise({ try: () => persistence.open(id, 'read'), catch: failed('open the thread log') }),
        handle => Effect.tryPromise({ try: () => handle.read(), catch: failed('read the thread log') }),
        handle => Effect.promise(() => handle.close()),
      )
      return { createdAt: stat.header.createdAt, cwd: stat.header.cwd, agentPreset: stat.header.agentPreset, events: events.events }
    })

    const readAttachment = (reference: AttachmentReference) =>
      Effect.gen(function* () {
        const store = yield* service('attachments', 'read an attachment')
        if (reference.kind === 'image') {
          const ref = imageRefOf(reference)
          if (ref === undefined) return Option.none<Uint8Array>()
          const stored = yield* Effect.tryPromise(signal => store.readImage(ref, signal))
          return Option.some(stored.data)
        }
        const ref = { attachmentId: AttachmentId(reference.attachmentId), name: reference.name, bytes: reference.bytes }
        return Option.some(yield* Effect.tryPromise(signal => collect(store.readFileStream(ref, signal))))
      }).pipe(
        Effect.catchCause(cause =>
          Effect.as(Effect.logWarning(`thread-transfer: attachment ${reference.attachmentId} is unreadable; the bundle omits it`, cause), Option.none()),
        ),
        Effect.withSpan('thread store attachment read'),
      )

    const saveAttachment = Effect.fn('thread store attachment save')(function* (input: {
      readonly kind: 'image' | 'file'
      readonly data: Uint8Array
      readonly mediaType: string | undefined
      readonly name: string | undefined
    }) {
      const store = yield* service('attachments', 'save an attachment')
      const name = input.name === undefined ? {} : { name: input.name }
      const mediaType = input.mediaType
      if (input.kind === 'image' && isImageMediaType(mediaType)) {
        const ref = yield* Effect.tryPromise({ try: () => store.saveImage({ data: input.data, mediaType, ...name }), catch: failed('save an image') })
        return {
          kind: 'image' as const,
          attachmentId: String(ref.attachmentId),
          mediaType: ref.mediaType,
          bytes: ref.bytes,
          width: ref.width,
          height: ref.height,
        }
      }
      const ref = yield* Effect.tryPromise({ try: () => store.saveFile({ data: input.data, ...name }), catch: failed('save a file') })
      return { kind: 'file' as const, attachmentId: String(ref.attachmentId), name: ref.name, bytes: ref.bytes }
    })

    const create = Effect.fn('thread store create')(function* (input: {
      readonly cwd: string
      readonly createdAt: number
      readonly isSeeded: boolean
      readonly events: readonly unknown[]
    }) {
      const persistence = yield* service('sessionPersistence', 'store the imported thread')
      const events = input.events.filter(isSessionEvent)
      if (events.length !== input.events.length) return yield* new ThreadStoreFailed({ operation: 'store the imported thread (an event is malformed)' })
      const id = SessionId(`session-${randomUUID()}`)
      const header: SessionHeader = { version: SESSION_FORMAT_VERSION, id, createdAt: input.createdAt, cwd: input.cwd, isSeeded: input.isSeeded }
      yield* Effect.acquireUseRelease(
        Effect.tryPromise({ try: () => persistence.create(header), catch: failed('store the imported thread') }),
        handle =>
          Effect.tryPromise({
            try: async () => {
              if (events.length > 0) await handle.append(events)
              await handle.flush()
            },
            catch: failed('store the imported thread'),
          }),
        handle => Effect.promise(() => handle.close()),
      )
      yield* Effect.annotateCurrentSpan({ 'dsh.session.id': String(id) })
      // The backend checks cross-event relationships when it reads a log, not when it appends one: read it back now,
      // so a log this DSH cannot replay is archived and reported instead of appearing as a thread that fails to open.
      const refusedBy = failed('replay the imported log here, so it was archived')
      const refused = yield* Effect.acquireUseRelease(
        Effect.tryPromise({ try: () => persistence.open(id, 'read'), catch: refusedBy }),
        handle => Effect.tryPromise({ try: () => handle.read(), catch: refusedBy }),
        handle => Effect.promise(() => handle.close()),
      ).pipe(
        Effect.as(Option.none<ThreadStoreFailed>()),
        Effect.catch(error => Effect.succeed(Option.some(error))),
      )
      if (Option.isSome(refused)) {
        yield* service('workspaceRegistry', 'archive the refused thread').pipe(
          Effect.flatMap(registry => Effect.tryPromise({ try: () => registry.archiveSession(id), catch: failed('archive the refused thread') })),
          Effect.ignore,
        )
        return yield* refused.value
      }
      return String(id)
    })

    const projects = service('workspaceRegistry', 'list projects').pipe(
      Effect.map(registry => registry.list().map(workspace => ({ workspaceId: String(workspace.id), title: workspace.title, path: workspace.path }))),
      Effect.orElseSucceed(() => []),
    )

    const attach = Effect.fn('thread store attach')(function* (input: { readonly sessionId: string; readonly workspaceId: string }) {
      const registry = yield* service('workspaceRegistry', 'add the thread to its project')
      const workspace = registry.get(WorkspaceId(input.workspaceId))
      if (workspace === undefined) return yield* new ThreadStoreFailed({ operation: 'add the thread to its project (the project is gone)' })
      yield* Effect.tryPromise({ try: () => workspace.attachSession(SessionId(input.sessionId)), catch: failed('add the thread to its project') })
    })

    // Resuming the stored Session attaches it like any thread the user reopens, so every browser's thread list learns
    // it exists; one that fails to resume now still resumes when it is first opened.
    const publish = (sessionId: string) =>
      service('sessionController', 'open the imported thread').pipe(
        Effect.flatMap(controller =>
          Effect.tryPromise({ try: () => controller.resolveAgent(SessionId(sessionId)), catch: failed('open the imported thread') }),
        ),
        Effect.flatMap(found =>
          'error' in found ? Effect.fail(new ThreadStoreFailed({ operation: 'open the imported thread', cause: found.error })) : Effect.void,
        ),
        Effect.catch(error => Effect.logWarning('thread-transfer: the imported thread was stored but not resumed yet', error)),
        Effect.withSpan('thread store publish'),
      )

    return ThreadStore.of({ sessionFormat: SESSION_FORMAT_VERSION, read, readAttachment, saveAttachment, create, projects, attach, publish, home: homedir() })
  }),
)
