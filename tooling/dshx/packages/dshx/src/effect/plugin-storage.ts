import type {} from '@deepseek-ai/dsh-storage-domain'
import { Context, Effect, Layer, Option, Queue, Schema, Stream } from 'effect'
import { PluginStorageContract, type StorageListInput, type StoragePage, type StoredEntry } from '../api/storage.js'
import { PluginStorageModel } from '../host/plugin-storage.js'
import type { JsonValue } from '../json.js'
import { HostContext } from './host-context.js'

/** A key, value or list request the storage contract rejects; nothing was read or written. */
export class PluginStorageInvalidInput extends Schema.TaggedError<PluginStorageInvalidInput>()('PluginStorageInvalidInput', {
  namespace: Schema.String,
  operation: Schema.Literals(['get', 'set', 'delete', 'list']),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Plugin storage rejected the ${this.operation} request for "${this.namespace}".`
  }
}

/** The Host storage domain failed the request or is not loaded in this profile. */
export class PluginStorageFailed extends Schema.TaggedError<PluginStorageFailed>()('PluginStorageFailed', {
  namespace: Schema.String,
  operation: Schema.Literals(['get', 'set', 'delete', 'list']),
  cause: Schema.optional(Schema.Defect()),
}) {
  override get message(): string {
    return `Plugin storage ${this.operation} failed for "${this.namespace}". Check that the profile loads @deepseek-ai/dsh-storage-domain.`
  }
}

export type PluginStorageError = PluginStorageInvalidInput | PluginStorageFailed

/** One stored key changed (written or deleted) in this plugin's namespace. */
export interface PluginStorageChange {
  readonly key: string
  readonly deleted: boolean
}

/** Key-value storage of one plugin namespace, shared with its browser half through `hostStorage(api)`. */
export class PluginStorage extends Context.Service<
  PluginStorage,
  {
    readonly namespace: string
    readonly get: (key: string) => Effect.Effect<Option.Option<StoredEntry>, PluginStorageError>
    readonly set: (key: string, value: JsonValue) => Effect.Effect<StoredEntry, PluginStorageError>
    readonly delete: (key: string) => Effect.Effect<boolean, PluginStorageError>
    readonly list: (input?: StorageListInput) => Effect.Effect<StoragePage, PluginStorageError>
    /** Changes under `prefix` from any writer (Host or browser) as they become durable. */
    readonly changes: (prefix?: string) => Stream.Stream<PluginStorageChange>
  }
>()('@dshfiles/dshx/PluginStorage') {
  /** Storage of the activating plugin's own package namespace. */
  static readonly layer = Layer.effect(
    PluginStorage,
    Effect.gen(function* () {
      const host = yield* HostContext
      return yield* makePluginStorage(host.packageId)
    }),
  )

  /** Storage of an explicit namespace, for a plugin whose stored data predates its package name. */
  static readonly layerFor = (namespace: string) => Layer.effect(PluginStorage, makePluginStorage(namespace))
}

const makePluginStorage = Effect.fnUntraced(function* (namespace: string) {
  const host = yield* HostContext
  const checkedNamespace = yield* Schema.decodeUnknownEffect(PluginStorageContract.namespace)(namespace).pipe(
    Effect.mapError(cause => new PluginStorageInvalidInput({ namespace, operation: 'get', cause })),
  )
  const storage = PluginStorageModel.open(host.ctx, checkedNamespace)

  const checked = <S extends Schema.ConstraintDecoder<unknown>>(operation: PluginStorageInvalidInput['operation'], schema: S, input: S['Encoded']) =>
    Schema.decodeUnknownEffect(schema)(input).pipe(Effect.mapError(cause => new PluginStorageInvalidInput({ namespace: checkedNamespace, operation, cause })))
  const call = <A>(operation: PluginStorageFailed['operation'], run: () => Promise<A>) =>
    Effect.tryPromise({ try: run, catch: cause => new PluginStorageFailed({ namespace: checkedNamespace, operation, cause }) })

  return PluginStorage.of({
    namespace: checkedNamespace,
    get: Effect.fn('plugin-storage get')(function* (key) {
      const checkedKey = yield* checked('get', PluginStorageContract.key, key)
      return Option.fromUndefinedOr(yield* call('get', () => storage.get(checkedKey)))
    }),
    set: Effect.fn('plugin-storage set')(function* (key, value) {
      const checkedKey = yield* checked('set', PluginStorageContract.key, key)
      const checkedValue = yield* checked('set', PluginStorageContract.value, value)
      return yield* call('set', () => storage.set(checkedKey, checkedValue))
    }),
    delete: Effect.fn('plugin-storage delete')(function* (key) {
      const checkedKey = yield* checked('delete', PluginStorageContract.key, key)
      return yield* call('delete', () => storage.delete(checkedKey))
    }),
    list: Effect.fn('plugin-storage list')(function* (input = {}) {
      yield* checked('list', PluginStorageContract.listInput, { ...input, namespace: checkedNamespace })
      return yield* call('list', () => storage.list(input))
    }),
    changes: (prefix = '') =>
      Stream.callback<PluginStorageChange>(queue =>
        Effect.acquireRelease(
          Effect.sync(() =>
            host.ctx.on('domain/changed', domainChange => {
              const change = PluginStorageModel.changeOf(domainChange)
              if (change !== undefined && change.namespace === checkedNamespace && change.key.startsWith(prefix))
                Queue.offerUnsafe(queue, { key: change.key, deleted: change.deleted })
            }),
          ),
          dispose => Effect.sync(dispose),
        ),
      ),
  })
})
