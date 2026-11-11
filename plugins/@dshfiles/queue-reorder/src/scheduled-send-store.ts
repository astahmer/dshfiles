import { randomBytes } from 'node:crypto'
import { PluginStorage } from '@dshfiles/dshx/effect/plugin-storage'
import { Context, Effect, Layer, Option, Schema, Semaphore, Stream } from 'effect'
import { scheduledSendSchema, type ScheduledSend } from './scheduled-send-api.js'

const NAMESPACE = '@dshfiles/queue-reorder'
const SEND_PREFIX = 'scheduled-send/'

const decodeSend = Schema.decodeUnknownOption(scheduledSendSchema)
const encodeSend = Schema.encodeSync(Schema.toCodecJson(scheduledSendSchema))

/** The scheduled-send storage failed; nothing was changed by the failed call. */
export class ScheduledSendStorageFailure extends Schema.TaggedError<ScheduledSendStorageFailure>()(
  'ScheduledSendStorageFailure',
  { operation: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'scheduled-send-storage-failure' },
) {
  override get message(): string {
    return 'Scheduled messages could not be read or written. Check that the DSH storage-domain plugin is loaded, then try again.'
  }
}

export const newSendId = (): string => `send_${randomBytes(12).toString('base64url')}`

const make = Effect.gen(function* () {
  const storage = yield* PluginStorage
  const lock = yield* Semaphore.make(1)
  const failed = (operation: string) => (cause: unknown) => new ScheduledSendStorageFailure({ operation, cause })

  const all = storage.listAll({ prefix: SEND_PREFIX }).pipe(
    Effect.mapError(failed('list')),
    Effect.map(entries =>
      entries
        .flatMap(entry => Option.toArray(decodeSend(entry.value)))
        .toSorted((left, right) => left.sendAt - right.sendAt || left.createdAt - right.createdAt),
    ),
  )

  const get = (id: string) =>
    storage.get(`${SEND_PREFIX}${id}`).pipe(
      Effect.map(entry => Option.flatMap(entry, stored => decodeSend(stored.value))),
      Effect.mapError(failed('get')),
    )

  const put = (send: ScheduledSend) => storage.set(`${SEND_PREFIX}${send.id}`, encodeSend(send)).pipe(Effect.asVoid, Effect.mapError(failed('set')))

  const remove = (id: string) => storage.delete(`${SEND_PREFIX}${id}`).pipe(Effect.mapError(failed('delete')))

  return ScheduledSendStore.of({
    all,
    get,
    put,
    remove,
    exclusive: lock.withPermits(1),
    changes: storage.changes(SEND_PREFIX).pipe(Stream.as(undefined)),
  })
})

/** Scheduled sends in the plugin's storage namespace, which survives Host restarts. */
export class ScheduledSendStore extends Context.Service<
  ScheduledSendStore,
  {
    /** Every scheduled send, soonest first. */
    readonly all: Effect.Effect<readonly ScheduledSend[], ScheduledSendStorageFailure>
    readonly get: (id: string) => Effect.Effect<Option.Option<ScheduledSend>, ScheduledSendStorageFailure>
    readonly put: (send: ScheduledSend) => Effect.Effect<void, ScheduledSendStorageFailure>
    readonly remove: (id: string) => Effect.Effect<boolean, ScheduledSendStorageFailure>
    /** A read-modify-write without another writer in between: an edit never races the scheduler claiming the send. */
    readonly exclusive: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
    /** Fires after any scheduled send is written or deleted. */
    readonly changes: Stream.Stream<void>
  }
>()('@dshfiles/queue-reorder/ScheduledSendStore') {
  static readonly layerWithoutStorage = Layer.effect(ScheduledSendStore, make)
  static readonly layer = ScheduledSendStore.layerWithoutStorage.pipe(Layer.provide(PluginStorage.layerFor(NAMESPACE)))
}
