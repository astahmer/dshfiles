import type { StandardSchemaV1 } from '@standard-schema/spec'
import { ApiClientEventsModel } from '../api/client-events.js'
import { ApiRuntimeModel, type ContextLike } from '../api/runtime.js'
import { PluginStorageContract, type StorageListInput, type StoragePage, type StoredEntry } from '../api/storage.js'
import type { ApiEventStatus } from '../api/types.js'
import type { PersistedStore, StoreScope } from './store.js'

/** A Host store definition: the browser `defineStore` fields without `storage`, `from` (no browser values to import). */
export interface HostStoreDefinition<T, Scope extends StoreScope = StoreScope> {
  readonly key: string
  readonly scope: Scope
  readonly schema: StandardSchemaV1<unknown, T>
  readonly initial: T
}

/** A value kept on the Host and shared by every browser connected to it; it reads `initial` until `ready` resolves. */
export interface HostStore<T> extends PersistedStore<T> {
  /** Resolves once the Host value was read, or rejects when the Host has no plugin storage. */
  readonly ready: Promise<void>
}

export type DefinedHostStore<T, Scope extends StoreScope> = Scope extends 'global' ? HostStore<T> : (scopeId: string) => HostStore<T>

/** Host-backed key-value storage for this plugin, and stores built on it. */
export interface StorageService {
  get(key: string): Promise<StoredEntry | undefined>
  set(key: string, value: unknown): Promise<StoredEntry>
  delete(key: string): Promise<boolean>
  list(input?: StorageListInput): Promise<StoragePage>
  /** Like `defineStore`, but the value lives on the Host: other browsers and the plugin's Host half see it. */
  store<T, const Scope extends StoreScope>(definition: HostStoreDefinition<T, Scope>): DefinedHostStore<T, Scope>
}

interface CachedValue {
  /** Undefined until the Host answered; `null` once it answered that nothing is stored. */
  raw: unknown
  readonly listeners: Set<() => void>
  loaded: Promise<void> | undefined
}

const CACHE_KEY = Symbol.for('@dshfiles/dshx.host-store.v1')

/** Every plugin bundles its own dshx copy; one page-wide cache keeps the copies of one key in step. */
const pageCache = (): Map<string, CachedValue> => {
  // SAFETY: only this module writes the versioned symbol, and always this Map shape.
  const holder = globalThis as { [CACHE_KEY]?: Map<string, CachedValue> }
  holder[CACHE_KEY] ??= new Map()
  return holder[CACHE_KEY]
}

const decode = <T>(schema: StandardSchemaV1<unknown, T>, raw: unknown, initial: T): T => {
  if (raw === undefined || raw === null) return initial
  const result = schema['~standard'].validate(raw)
  if (result instanceof Promise) throw new TypeError('dshx stores need a synchronous schema.')
  return result.issues === undefined ? result.value : initial
}

const storeKey = (key: string, scope: StoreScope, scopeId: string | undefined): string =>
  scopeId === undefined ? `store/${key}` : `store/${key}/${scope}/${scopeId}`

const createStorageService = (input: { readonly ctx: ContextLike; readonly namespace: string; readonly signal: AbortSignal }): StorageService => {
  let client: ReturnType<typeof createClient> | undefined
  const createClient = () => ApiRuntimeModel.createClient(input.ctx, PluginStorageContract.api, input.namespace)
  const api = () => (client ??= createClient())
  const namespace = input.namespace
  const cache = pageCache()
  const cacheKey = (key: string): string => `${namespace}\u0000${key}`

  const notify = (cached: CachedValue): void => {
    for (const listener of [...cached.listeners]) listener()
  }

  const load = (key: string, cached: CachedValue): Promise<void> => {
    const loading = api()
      .get({ namespace, key })
      .then(result => {
        cached.raw = result.entry?.value ?? null
        notify(cached)
      })
    cached.loaded = loading
    loading.catch(() => {
      if (cached.loaded === loading) cached.loaded = undefined
    })
    return loading
  }

  const cachedFor = (key: string): CachedValue => {
    const existing = cache.get(cacheKey(key))
    if (existing !== undefined) return existing
    const created: CachedValue = { raw: undefined, listeners: new Set(), loaded: undefined }
    cache.set(cacheKey(key), created)
    return created
  }

  let unsubscribeEvents: (() => void) | undefined
  const followHost = (): void => {
    if (unsubscribeEvents !== undefined) return
    let previous: ApiEventStatus | undefined
    unsubscribeEvents = ApiClientEventsModel.subscribe(api(), 'changed', {
      onEvent: change => {
        if (change.namespace !== namespace) return
        const cached = cache.get(cacheKey(change.key))
        if (cached === undefined) return
        if (change.deleted) {
          cached.raw = null
          notify(cached)
          return
        }
        void load(change.key, cached).catch(() => undefined)
      },
      onStatus: status => {
        // Writes made while this page was disconnected are not replayed: read every known key again.
        if (status === 'live' && previous !== undefined && previous !== 'live') {
          for (const [stored, cached] of cache) {
            if (stored.startsWith(`${namespace}\u0000`)) void load(stored.slice(namespace.length + 1), cached).catch(() => undefined)
          }
        }
        previous = status
      },
    })
    input.signal.addEventListener('abort', () => unsubscribeEvents?.(), { once: true })
  }

  const createHostStore = <T>(definition: HostStoreDefinition<T>, scopeId: string | undefined): HostStore<T> => {
    const key = storeKey(definition.key, definition.scope, scopeId)
    const cached = cachedFor(key)
    followHost()
    let decoded: { readonly raw: unknown; readonly value: T } | undefined
    const read = (): T => {
      if (decoded !== undefined && decoded.raw === cached.raw) return decoded.value
      decoded = { raw: cached.raw, value: decode(definition.schema, cached.raw, definition.initial) }
      return decoded.value
    }
    const write = (next: T): void => {
      const value = PluginStorageContract.value.parse(next)
      const previous = cached.raw
      cached.raw = next
      notify(cached)
      void api()
        .set({ namespace, key, value })
        .catch((error: unknown) => {
          console.warn(`dshx: the Host store ${definition.key} kept its previous value because the write failed.`, error)
          cached.raw = previous
          notify(cached)
        })
    }
    const ready = cached.loaded ?? load(key, cached)
    // Callers that never await `ready` still read `initial`; the failure is theirs to observe, not an unhandled rejection.
    ready.catch(() => undefined)
    return {
      ready,
      get: read,
      subscribe: listener => {
        cached.listeners.add(listener)
        return () => cached.listeners.delete(listener)
      },
      set: write,
      update: change => write(change(read())),
      remove: () => {
        cached.raw = null
        notify(cached)
        void api()
          .delete({ namespace, key })
          .catch((error: unknown) => console.warn(`dshx: the Host store ${definition.key} could not be removed.`, error))
      },
    }
  }

  return {
    get: async key => (await api().get({ namespace, key })).entry ?? undefined,
    set: (key, value) => api().set({ namespace, key, value: PluginStorageContract.value.parse(value) }),
    delete: async key => (await api().delete({ namespace, key })).deleted,
    list: (page = {}) => api().list({ ...page, namespace }),
    store: <T, const Scope extends StoreScope>(definition: HostStoreDefinition<T, Scope>): DefinedHostStore<T, Scope> => {
      if (definition.key.trim() === '') throw new TypeError('dshx store key must be non-empty.')
      if (definition.scope === 'global') {
        // The conditional return type resolves to HostStore<T> for the global scope.
        return createHostStore(definition, undefined) as DefinedHostStore<T, Scope>
      }
      const byScopeId = new Map<string, HostStore<T>>()
      const forScope = (scopeId: string): HostStore<T> => {
        const existing = byScopeId.get(scopeId)
        if (existing !== undefined) return existing
        const created = createHostStore(definition, scopeId)
        byScopeId.set(scopeId, created)
        return created
      }
      // The conditional return type resolves to the per-id factory for session and project scopes.
      return forScope as DefinedHostStore<T, Scope>
    },
  }
}

export class HostStorageModel {
  static readonly create = createStorageService
}
