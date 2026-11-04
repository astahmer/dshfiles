import { randomUUID } from 'node:crypto'
import { Clock, Context, Effect, FileSystem, Layer, Option, Path, Ref, Schema } from 'effect'
import { ThreadBundles, type AttachmentReference, type BundleSummary } from './bundle.js'
import { type BundleUnreadable, decodeBundle, encodeBundle, MAX_BUNDLE_BYTES } from './bundle-codec.js'

export const PACKAGE_ID = '@dshfiles/thread-transfer'

/** Raw bytes per transfer chunk: its base64 stays well under the 1 MiB dshx API payload limit. */
export const CHUNK_BYTES = 512 * 1024
/** A staged transfer the browser stopped reading or writing is dropped after this long. */
const TRANSFER_TTL_MS = 15 * 60 * 1000
/** Staged transfers kept at once, so abandoned uploads cannot grow the Host's memory without bound. */
const MAX_TRANSFERS = 8
/** Attachments read or saved at once: the store hashes and writes each, so a few in parallel is enough. */
const ATTACHMENT_CONCURRENCY = 4

export class ThreadNotFound extends Schema.TaggedError<ThreadNotFound>()(
  'ThreadNotFound',
  { sessionId: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'thread-not-found' },
) {
  override get message(): string {
    return `Thread ${this.sessionId} is not stored on this machine. Pick a thread from the sidebar, then export again.`
  }
}

export class ThreadStoreFailed extends Schema.TaggedError<ThreadStoreFailed>()(
  'ThreadStoreFailed',
  { operation: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'thread-store-failed' },
) {
  override get message(): string {
    const detail = this.cause instanceof Error ? ` (${this.cause.message})` : ''
    return `DSH could not ${this.operation}${detail}. Retry; if it keeps failing, check the Host log and that the Session storage is writable.`
  }
}

export class TransferExpired extends Schema.TaggedError<TransferExpired>()(
  'TransferExpired',
  { transferId: Schema.String },
  { dshxWireCode: 'transfer-expired' },
) {
  override get message(): string {
    return 'This transfer expired or the Host restarted while it was in progress. Start the export or import again.'
  }
}

export class TransferInvalid extends Schema.TaggedError<TransferInvalid>()('TransferInvalid', { reason: Schema.String }, { dshxWireCode: 'transfer-invalid' }) {
  override get message(): string {
    return `${this.reason} Start the import again.`
  }
}

export class BundleIncompatible extends Schema.TaggedError<BundleIncompatible>()(
  'BundleIncompatible',
  { reason: Schema.String },
  { dshxWireCode: 'bundle-incompatible' },
) {
  override get message(): string {
    return this.reason
  }
}

export class DestinationInvalid extends Schema.TaggedError<DestinationInvalid>()(
  'DestinationInvalid',
  { reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'destination-invalid' },
) {
  override get message(): string {
    return `${this.reason} Pick a registered project or an existing folder on this machine.`
  }
}

export class ExportPathInvalid extends Schema.TaggedError<ExportPathInvalid>()(
  'ExportPathInvalid',
  { path: Schema.String, reason: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'export-path-invalid' },
) {
  override get message(): string {
    return `${this.reason}: ${this.path}. Pass an absolute path ending in .dshthread in an existing folder, one no file uses yet.`
  }
}

/** Header facts and events of one stored Session. */
export interface StoredThread {
  readonly createdAt: number
  readonly cwd: string | undefined
  readonly agentPreset: string | undefined
  readonly events: readonly unknown[]
}

export interface ImportDestination {
  readonly cwd: string
  readonly workspaceId: string | null
}

export interface DestinationProject {
  readonly workspaceId: string
  readonly title: string
  readonly path: string
}

/** The Host Session storage, attachment store and workspace registry this plugin reads and writes. */
export class ThreadStore extends Context.Service<
  ThreadStore,
  {
    /** The DSH Session log format this Host writes. */
    readonly sessionFormat: number
    readonly read: (sessionId: string) => Effect.Effect<StoredThread, ThreadNotFound | ThreadStoreFailed>
    /** None when the store no longer has the bytes. */
    readonly readAttachment: (reference: AttachmentReference) => Effect.Effect<Option.Option<Uint8Array>>
    readonly saveAttachment: (input: {
      readonly kind: 'image' | 'file'
      readonly data: Uint8Array
      readonly mediaType: string | undefined
      readonly name: string | undefined
    }) => Effect.Effect<AttachmentReference, ThreadStoreFailed>
    /** Store a new cold Session with exactly these events and return its id; it is resumed when first opened. */
    readonly create: (input: {
      readonly cwd: string
      readonly createdAt: number
      readonly isSeeded: boolean
      readonly events: readonly unknown[]
    }) => Effect.Effect<string, ThreadStoreFailed>
    readonly projects: Effect.Effect<readonly DestinationProject[]>
    readonly attach: (input: { readonly sessionId: string; readonly workspaceId: string }) => Effect.Effect<void, ThreadStoreFailed>
    /** Best effort: make the stored Session live so open thread lists show it. */
    readonly publish: (sessionId: string) => Effect.Effect<void>
    readonly home: string
  }
>()('@dshfiles/thread-transfer/ThreadStore') {}

type Staged =
  | { readonly kind: 'export'; readonly data: Uint8Array; readonly touchedAt: number }
  | { readonly kind: 'import'; readonly data: Uint8Array; readonly received: number; readonly touchedAt: number }

export interface ExportedBundle {
  readonly fileName: string
  readonly bytes: number
  readonly summary: BundleSummary
}

export interface ImportedThread {
  readonly sessionId: string
  readonly title: string | null
  readonly cwd: string
  readonly workspaceId: string | null
  readonly events: number
  readonly attachments: number
}

export type BundleSource = { readonly transferId: string } | { readonly path: string }

export interface BundlePreview {
  readonly summary: BundleSummary
  /** Why this machine cannot import it; null when it can. */
  readonly problem: string | null
}

/**
 * Export a thread to a `.dshthread` bundle and import one as a new thread. The browser moves bundles in chunks through
 * staged transfers (the API carries at most 1 MiB per call); the agent reads and writes bundle files on the Host.
 */
export class ThreadTransfer extends Context.Service<
  ThreadTransfer,
  {
    readonly exportStaged: (
      sessionId: string,
    ) => Effect.Effect<ExportedBundle & { readonly transferId: string }, ThreadNotFound | ThreadStoreFailed | BundleUnreadable>
    readonly exportFile: (input: {
      readonly sessionId: string
      readonly path: string
    }) => Effect.Effect<ExportedBundle & { readonly path: string }, ThreadNotFound | ThreadStoreFailed | BundleUnreadable | ExportPathInvalid>
    readonly readChunk: (input: {
      readonly transferId: string
      readonly offset: number
    }) => Effect.Effect<{ readonly data: string; readonly nextOffset: number; readonly done: boolean }, TransferExpired | TransferInvalid>
    readonly beginImport: (bytes: number) => Effect.Effect<{ readonly transferId: string; readonly chunkBytes: number }, TransferInvalid>
    readonly writeChunk: (input: {
      readonly transferId: string
      readonly offset: number
      readonly data: string
    }) => Effect.Effect<{ readonly received: number }, TransferExpired | TransferInvalid>
    readonly inspect: (source: BundleSource) => Effect.Effect<BundlePreview, TransferExpired | TransferInvalid | BundleUnreadable | ExportPathInvalid>
    readonly importThread: (input: {
      readonly source: BundleSource
      readonly workspaceId: string | undefined
      readonly cwd: string | undefined
    }) => Effect.Effect<
      ImportedThread,
      TransferExpired | TransferInvalid | BundleUnreadable | BundleIncompatible | DestinationInvalid | ThreadStoreFailed | ExportPathInvalid
    >
    readonly destinations: Effect.Effect<{ readonly home: string; readonly projects: readonly DestinationProject[] }>
  }
>()('@dshfiles/thread-transfer/ThreadTransfer') {
  static readonly layer = Layer.effect(
    ThreadTransfer,
    Effect.gen(function* () {
      const store = yield* ThreadStore
      const fs = yield* FileSystem.FileSystem
      const path = yield* Path.Path
      const transfers = yield* Ref.make<ReadonlyMap<string, Staged>>(new Map())

      /** Drop expired transfers, then the oldest ones beyond the cap. */
      const prune = (now: number) =>
        Ref.update(transfers, current => {
          const alive = [...current].filter(([, staged]) => now - staged.touchedAt < TRANSFER_TTL_MS)
          alive.sort(([, left], [, right]) => right.touchedAt - left.touchedAt)
          return new Map(alive.slice(0, MAX_TRANSFERS - 1))
        })

      const stage = (staged: Staged) =>
        Effect.gen(function* () {
          yield* prune(staged.touchedAt)
          const transferId = `transfer-${randomUUID()}`
          yield* Ref.update(transfers, current => new Map(current).set(transferId, staged))
          return transferId
        })

      const staged = (transferId: string) =>
        Effect.flatMap(Ref.get(transfers), current => {
          const found = current.get(transferId)
          return found === undefined ? Effect.fail(new TransferExpired({ transferId })) : Effect.succeed(found)
        })

      const build = Effect.fn('thread export build')(function* (sessionId: string) {
        const thread = yield* store.read(sessionId)
        const read = yield* Effect.forEach(
          ThreadBundles.references(thread.events),
          ([sourceId, reference]) =>
            Effect.map(store.readAttachment(reference), data => Option.map(data, bytes => [sourceId, { reference, data: bytes }] as const)),
          { concurrency: ATTACHMENT_CONCURRENCY },
        )
        const attachments = new Map(read.flatMap(entry => (Option.isSome(entry) ? [entry.value] : [])))
        const exportedAt = yield* Clock.currentTimeMillis
        const bundle = ThreadBundles.build({ ...thread, sessionFormat: store.sessionFormat, attachments, exportedAt })
        const data = yield* encodeBundle(bundle)
        yield* Effect.annotateCurrentSpan({ 'thread_transfer.events': bundle.events.length, 'thread_transfer.attachments': bundle.attachments.length })
        return { data, fileName: ThreadBundles.fileName(bundle), bytes: data.byteLength, summary: ThreadBundles.summary(bundle) }
      })

      const exportStaged = Effect.fn('thread export')(function* (sessionId: string) {
        const built = yield* build(sessionId)
        const touchedAt = yield* Clock.currentTimeMillis
        const transferId = yield* stage({ kind: 'export', data: built.data, touchedAt })
        return { transferId, fileName: built.fileName, bytes: built.bytes, summary: built.summary }
      })

      const checkedFilePath = (target: string, mustExist: boolean) =>
        Effect.gen(function* () {
          if (!path.isAbsolute(target)) return yield* new ExportPathInvalid({ path: target, reason: 'The path is not absolute' })
          const exists = yield* fs.exists(target).pipe(Effect.orElseSucceed(() => false))
          if (mustExist && !exists) return yield* new ExportPathInvalid({ path: target, reason: 'No file exists at this path' })
          if (!mustExist && exists) return yield* new ExportPathInvalid({ path: target, reason: 'A file already exists at this path' })
          return target
        })

      const exportFile = Effect.fn('thread export file')(function* (input: { readonly sessionId: string; readonly path: string }) {
        const target = yield* checkedFilePath(input.path, false)
        const built = yield* build(input.sessionId)
        yield* fs
          .writeFile(target, built.data, { flag: 'wx' })
          .pipe(Effect.mapError(cause => new ExportPathInvalid({ path: target, reason: 'The bundle could not be written', cause })))
        return { path: target, fileName: built.fileName, bytes: built.bytes, summary: built.summary }
      })

      const readChunk = Effect.fn('thread export chunk')(function* (input: { readonly transferId: string; readonly offset: number }) {
        const found = yield* staged(input.transferId)
        if (found.kind !== 'export') return yield* new TransferInvalid({ reason: 'This transfer is an upload, not a download.' })
        if (input.offset < 0 || input.offset > found.data.byteLength) return yield* new TransferInvalid({ reason: 'The download offset is out of range.' })
        const end = Math.min(found.data.byteLength, input.offset + CHUNK_BYTES)
        const done = end === found.data.byteLength
        const touchedAt = yield* Clock.currentTimeMillis
        yield* Ref.update(transfers, current => {
          const next = new Map(current)
          if (done) next.delete(input.transferId)
          else next.set(input.transferId, { ...found, touchedAt })
          return next
        })
        return { data: Buffer.from(found.data.subarray(input.offset, end)).toString('base64'), nextOffset: end, done }
      })

      const beginImport = Effect.fn('thread import begin')(function* (bytes: number) {
        if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_BUNDLE_BYTES)
          return yield* new TransferInvalid({ reason: `A bundle must be between 1 byte and ${String(MAX_BUNDLE_BYTES / 1024 / 1024)} MiB.` })
        const touchedAt = yield* Clock.currentTimeMillis
        const transferId = yield* stage({ kind: 'import', data: new Uint8Array(bytes), received: 0, touchedAt })
        return { transferId, chunkBytes: CHUNK_BYTES }
      })

      const writeChunk = Effect.fn('thread import chunk')(function* (input: { readonly transferId: string; readonly offset: number; readonly data: string }) {
        const found = yield* staged(input.transferId)
        if (found.kind !== 'import') return yield* new TransferInvalid({ reason: 'This transfer is a download, not an upload.' })
        if (input.offset !== found.received) return yield* new TransferInvalid({ reason: 'The upload chunks arrived out of order.' })
        const chunk = Buffer.from(input.data, 'base64')
        if (chunk.byteLength === 0 || input.offset + chunk.byteLength > found.data.byteLength)
          return yield* new TransferInvalid({ reason: 'The upload is larger than announced.' })
        found.data.set(chunk, input.offset)
        const received = input.offset + chunk.byteLength
        const touchedAt = yield* Clock.currentTimeMillis
        yield* Ref.update(transfers, current => new Map(current).set(input.transferId, { ...found, received, touchedAt }))
        return { received }
      })

      /** The bundle a source names: a complete upload, or a file on the Host. */
      const load = (source: BundleSource) =>
        Effect.gen(function* () {
          if ('path' in source) {
            const target = yield* checkedFilePath(source.path, true)
            const bytes = yield* fs
              .readFile(target)
              .pipe(Effect.mapError(cause => new ExportPathInvalid({ path: target, reason: 'The file could not be read', cause })))
            return yield* decodeBundle(bytes)
          }
          const found = yield* staged(source.transferId)
          if (found.kind !== 'import') return yield* new TransferInvalid({ reason: 'This transfer is a download, not an upload.' })
          if (found.received !== found.data.byteLength) return yield* new TransferInvalid({ reason: 'The upload is incomplete.' })
          return yield* decodeBundle(found.data)
        })

      const inspect = Effect.fn('thread bundle inspect')(function* (source: BundleSource) {
        const bundle = yield* load(source)
        return { summary: ThreadBundles.summary(bundle), problem: ThreadBundles.problem(bundle, store.sessionFormat) ?? null }
      })

      const destination = (input: { readonly workspaceId: string | undefined; readonly cwd: string | undefined }) =>
        Effect.gen(function* () {
          if (input.workspaceId !== undefined) {
            const project = (yield* store.projects).find(candidate => candidate.workspaceId === input.workspaceId)
            if (project === undefined) return yield* new DestinationInvalid({ reason: `No project ${input.workspaceId} is registered on this machine.` })
            return { cwd: project.path, workspaceId: project.workspaceId }
          }
          const cwd = input.cwd ?? store.home
          if (!path.isAbsolute(cwd)) return yield* new DestinationInvalid({ reason: `The folder ${cwd} is not an absolute path.` })
          const info = yield* fs.stat(cwd).pipe(Effect.mapError(cause => new DestinationInvalid({ reason: `The folder ${cwd} does not exist.`, cause })))
          if (info.type !== 'Directory') return yield* new DestinationInvalid({ reason: `${cwd} is not a folder.` })
          const project = (yield* store.projects).find(candidate => candidate.path === cwd)
          return { cwd, workspaceId: project?.workspaceId ?? null }
        })

      const importThread = Effect.fn('thread import')(function* (input: {
        readonly source: BundleSource
        readonly workspaceId: string | undefined
        readonly cwd: string | undefined
      }) {
        const bundle = yield* load(input.source)
        const problem = ThreadBundles.problem(bundle, store.sessionFormat)
        if (problem !== undefined) return yield* new BundleIncompatible({ reason: problem })
        const target = yield* destination(input)
        const saved = new Map(
          yield* Effect.forEach(
            bundle.attachments,
            attachment =>
              Effect.map(
                store.saveAttachment({
                  kind: attachment.kind,
                  data: Buffer.from(attachment.data, 'base64'),
                  mediaType: attachment.mediaType,
                  name: attachment.name,
                }),
                reference => [attachment.key, reference] as const,
              ),
            { concurrency: ATTACHMENT_CONCURRENCY },
          ),
        )
        const events = ThreadBundles.rebase(bundle, saved)
        const sessionId = yield* store.create({
          cwd: target.cwd,
          createdAt: bundle.thread.createdAt,
          isSeeded: ThreadBundles.isSeeded(events),
          events,
        })
        if (target.workspaceId !== null) yield* store.attach({ sessionId, workspaceId: target.workspaceId })
        yield* store.publish(sessionId)
        if ('transferId' in input.source) {
          const transferId = input.source.transferId
          yield* Ref.update(transfers, current => {
            const next = new Map(current)
            next.delete(transferId)
            return next
          })
        }
        yield* Effect.annotateCurrentSpan({ 'thread_transfer.events': events.length, 'thread_transfer.attachments': saved.size })
        return { sessionId, title: bundle.thread.title, cwd: target.cwd, workspaceId: target.workspaceId, events: events.length, attachments: saved.size }
      })

      return ThreadTransfer.of({
        exportStaged,
        exportFile,
        readChunk,
        beginImport,
        writeChunk,
        inspect,
        importThread,
        destinations: Effect.map(store.projects, projects => ({ home: store.home, projects })),
      })
    }),
  )
}
