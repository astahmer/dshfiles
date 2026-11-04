import { PluginStorage } from '@dshfiles/dshx/effect/plugin-storage'
import { Clock, Context, Effect, Layer, Option, Schema } from 'effect'
import type { ShareRow } from './share-api.js'
import { SharePolicy, passphraseHashSchema } from './share-policy.js'

export const NAMESPACE = '@dshfiles/thread-share'
const SHARE_PREFIX = 'share/'
const TOKEN_PREFIX = 'token/'
const SNAPSHOT_PREFIX = 'snapshot/'

const shareRecordSchema = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  title: Schema.String,
  kind: Schema.Literals(['live', 'snapshot']),
  access: Schema.Literals(['link', 'protected']),
  passphrase: Schema.NullOr(passphraseHashSchema),
  tokenSha256: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/)),
  createdAt: Schema.Number,
  expiresAt: Schema.NullOr(Schema.Number),
  revokedAt: Schema.NullOr(Schema.Number),
  views: Schema.Number.check(Schema.isInt()),
  lastViewedAt: Schema.NullOr(Schema.Number),
})
export type ShareRecord = typeof shareRecordSchema.Type

const tokenIndexSchema = Schema.Struct({ id: Schema.String })

export const snapshotEntrySchema = Schema.Struct({ role: Schema.Literals(['user', 'assistant']), text: Schema.String })
export interface StoredSnapshot {
  readonly capturedAt: number
  readonly truncated: boolean
  readonly entries: ReadonlyArray<typeof snapshotEntrySchema.Type>
}
/** A stored value holds at most 256 KiB of JSON, so a snapshot is a header plus chunks of entries. */
const snapshotHeaderSchema = Schema.Struct({ capturedAt: Schema.Number, truncated: Schema.Boolean, chunks: Schema.Number.check(Schema.isInt()) })
const snapshotChunkSchema = Schema.Array(snapshotEntrySchema)
const CHUNK_BYTES = 192 * 1024

/** Split entries so that each chunk's JSON stays well under the storage value limit. */
export const chunkEntries = <Entry>(entries: ReadonlyArray<Entry>, maxBytes = CHUNK_BYTES): Entry[][] => {
  const chunks: Entry[][] = []
  let current: Entry[] = []
  let size = 2
  for (const entry of entries) {
    const bytes = Buffer.byteLength(JSON.stringify(entry), 'utf8') + 1
    if (current.length > 0 && size + bytes > maxBytes) {
      chunks.push(current)
      current = []
      size = 2
    }
    current.push(entry)
    size += bytes
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

const decodeRecord = Schema.decodeUnknownOption(shareRecordSchema)
const decodeTokenIndex = Schema.decodeUnknownOption(tokenIndexSchema)
const decodeSnapshotHeader = Schema.decodeUnknownOption(snapshotHeaderSchema)
const decodeSnapshotChunk = Schema.decodeUnknownOption(snapshotChunkSchema)
const encodeRecord = Schema.encodeSync(shareRecordSchema)

/** The plugin's own storage namespace failed; no share changed. */
export class ShareStorageFailure extends Schema.TaggedError<ShareStorageFailure>()(
  'ShareStorageFailure',
  { operation: Schema.Literals(['read', 'write', 'list', 'delete']), cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'thread-share-storage-failure' },
) {
  override get message(): string {
    return `Thread sharing could not ${this.operation} its storage. Retry; if it keeps failing, restart DSH and check the disk.`
  }
}

/** No share with that id exists. */
export class ShareNotFound extends Schema.TaggedError<ShareNotFound>()('ShareNotFound', { id: Schema.String }, { dshxWireCode: 'thread-share-not-found' }) {
  override get message(): string {
    return `No share ${this.id} exists. List shares (Settings › Thread sharing or thread_share_list) and use one of their ids.`
  }
}

export const rowOf = (record: ShareRecord, now: number): ShareRow => ({
  id: record.id,
  sessionId: record.sessionId,
  title: record.title,
  kind: record.kind,
  access: record.access,
  status: SharePolicy.status({ revokedAt: record.revokedAt, expiresAt: record.expiresAt, now }),
  createdAt: record.createdAt,
  expiresAt: record.expiresAt,
  revokedAt: record.revokedAt,
  views: record.views,
  lastViewedAt: record.lastViewedAt,
})

const make = Effect.gen(function* () {
  const storage = yield* PluginStorage
  const failed = (operation: ShareStorageFailure['operation']) => (cause: unknown) => new ShareStorageFailure({ operation, cause })

  const read = (id: string) =>
    storage.get(`${SHARE_PREFIX}${id}`).pipe(
      Effect.map(stored => Option.flatMap(stored, entry => decodeRecord(entry.value))),
      Effect.mapError(failed('read')),
    )

  const write = (record: ShareRecord) => storage.set(`${SHARE_PREFIX}${record.id}`, encodeRecord(record)).pipe(Effect.mapError(failed('write')), Effect.asVoid)

  const list = Effect.fn('thread share list')(function* () {
    const records: ShareRecord[] = []
    let cursor: string | undefined
    do {
      const page = yield* storage.list(cursor === undefined ? { prefix: SHARE_PREFIX } : { prefix: SHARE_PREFIX, cursor }).pipe(Effect.mapError(failed('list')))
      for (const entry of page.entries) Option.map(decodeRecord(entry.value), record => records.push(record))
      cursor = page.cursor ?? undefined
    } while (cursor !== undefined)
    yield* Effect.annotateCurrentSpan('dshx.thread_share.count', records.length)
    return records.toSorted((left, right) => right.createdAt - left.createdAt)
  })

  const create = Effect.fn('thread share store create')(function* (
    input: Omit<ShareRecord, 'id' | 'tokenSha256' | 'views' | 'lastViewedAt' | 'revokedAt'> & {
      readonly token: string
      readonly snapshot: StoredSnapshot | null
    },
  ) {
    const id = SharePolicy.generateShareId()
    const record: ShareRecord = {
      id,
      sessionId: input.sessionId,
      title: input.title,
      kind: input.kind,
      access: input.access,
      passphrase: input.passphrase,
      tokenSha256: SharePolicy.tokenDigest(input.token),
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      revokedAt: null,
      views: 0,
      lastViewedAt: null,
    }
    if (input.snapshot !== null) {
      const chunks = chunkEntries(input.snapshot.entries)
      for (const [index, chunk] of chunks.entries()) {
        yield* storage
          .set(
            `${SNAPSHOT_PREFIX}${id}/${String(index)}`,
            chunk.map(entry => ({ role: entry.role, text: entry.text })),
          )
          .pipe(Effect.mapError(failed('write')))
      }
      yield* storage
        .set(`${SNAPSHOT_PREFIX}${id}`, { capturedAt: input.snapshot.capturedAt, truncated: input.snapshot.truncated, chunks: chunks.length })
        .pipe(Effect.mapError(failed('write')))
    }
    yield* write(record)
    // The index is written last: a share is reachable only once its record and snapshot exist.
    yield* storage.set(`${TOKEN_PREFIX}${record.tokenSha256}`, { id }).pipe(Effect.mapError(failed('write')))
    return record
  })

  /** Resolve a presented link token; an unknown token and a malformed one are the same `None`. */
  const byToken = Effect.fn('thread share resolve')(function* (token: string) {
    const index = yield* storage.get(`${TOKEN_PREFIX}${SharePolicy.tokenDigest(token)}`).pipe(Effect.mapError(failed('read')))
    const id = Option.flatMap(index, entry => decodeTokenIndex(entry.value))
    if (Option.isNone(id)) return Option.none<ShareRecord>()
    return yield* read(id.value.id)
  })

  const snapshot = Effect.fn('thread share snapshot read')(function* (id: string) {
    const stored = yield* storage.get(`${SNAPSHOT_PREFIX}${id}`).pipe(Effect.mapError(failed('read')))
    const header = Option.flatMap(stored, entry => decodeSnapshotHeader(entry.value))
    if (Option.isNone(header)) return Option.none<StoredSnapshot>()
    const entries: Array<typeof snapshotEntrySchema.Type> = []
    for (let index = 0; index < header.value.chunks; index += 1) {
      const chunk = yield* storage.get(`${SNAPSHOT_PREFIX}${id}/${String(index)}`).pipe(Effect.mapError(failed('read')))
      const decoded = Option.flatMap(chunk, entry => decodeSnapshotChunk(entry.value))
      if (Option.isNone(decoded)) return Option.none<StoredSnapshot>()
      entries.push(...decoded.value)
    }
    const result: StoredSnapshot = { capturedAt: header.value.capturedAt, truncated: header.value.truncated, entries }
    return Option.some(result)
  })

  const recordView = Effect.fn('thread share view record')(function* (id: string) {
    const current = yield* read(id)
    if (Option.isNone(current)) return
    const now = yield* Clock.currentTimeMillis
    yield* write({ ...current.value, views: current.value.views + 1, lastViewedAt: now })
  })

  /** Revoking drops the token index and the snapshot; the record stays so the list can show the revoked share. */
  const revoke = Effect.fn('thread share store revoke')(function* (id: string) {
    const current = yield* read(id)
    if (Option.isNone(current)) return yield* new ShareNotFound({ id })
    const now = yield* Clock.currentTimeMillis
    const record = current.value.revokedAt === null ? { ...current.value, revokedAt: now } : current.value
    yield* write(record)
    yield* storage.delete(`${TOKEN_PREFIX}${record.tokenSha256}`).pipe(Effect.mapError(failed('delete')))
    const header = yield* storage.get(`${SNAPSHOT_PREFIX}${id}`).pipe(Effect.mapError(failed('read')))
    const chunks = Option.match(
      Option.flatMap(header, entry => decodeSnapshotHeader(entry.value)),
      { onNone: () => 0, onSome: value => value.chunks },
    )
    yield* storage.delete(`${SNAPSHOT_PREFIX}${id}`).pipe(Effect.mapError(failed('delete')))
    for (let index = 0; index < chunks; index += 1) yield* storage.delete(`${SNAPSHOT_PREFIX}${id}/${String(index)}`).pipe(Effect.mapError(failed('delete')))
    return record
  })

  return ShareStore.of({ list: list(), create, byToken, snapshot, recordView, revoke })
})

/** Shares, their token index and their frozen snapshots, in the plugin's storage namespace. */
export class ShareStore extends Context.Service<
  ShareStore,
  {
    readonly list: Effect.Effect<ReadonlyArray<ShareRecord>, ShareStorageFailure>
    readonly create: (
      input: Omit<ShareRecord, 'id' | 'tokenSha256' | 'views' | 'lastViewedAt' | 'revokedAt'> & {
        readonly token: string
        readonly snapshot: StoredSnapshot | null
      },
    ) => Effect.Effect<ShareRecord, ShareStorageFailure>
    readonly byToken: (token: string) => Effect.Effect<Option.Option<ShareRecord>, ShareStorageFailure>
    readonly snapshot: (id: string) => Effect.Effect<Option.Option<StoredSnapshot>, ShareStorageFailure>
    readonly recordView: (id: string) => Effect.Effect<void, ShareStorageFailure>
    readonly revoke: (id: string) => Effect.Effect<ShareRecord, ShareStorageFailure | ShareNotFound>
  }
>()('@dshfiles/thread-share/ShareStore') {
  static readonly layer = Layer.effect(ShareStore, make).pipe(Layer.provide(PluginStorage.layerFor(NAMESPACE)))
}
