/**
 * A page-wide keyed store of Host reads. It has no React and no Effect runtime so any view layer (React through
 * `useSyncExternalStore`, a TanStack bridge, a Foldkit Subscription) adapts it with a thin layer.
 *
 * Subscriptions are ref-counted requirements: the first visible subscriber of a stale key fetches it, and the key polls
 * on ONE timer while at least one subscriber is visible and the document is shown. Cadence and freshness live on the
 * key's definition; a subscriber may only ask for a shorter poll while it is open.
 */

export type ResourceStatus = 'idle' | 'pending' | 'success' | 'error'

export interface ResourceSnapshot<T = unknown> {
  readonly status: ResourceStatus
  readonly data: T | undefined
  readonly error: unknown
  /** When the data was last read or written; 0 before the first success. */
  readonly updatedAt: number
  readonly fetching: boolean
}

/**
 * The Connection a key's reads travel over. `generation()` is undefined while the Host is unreachable; a different
 * defined value is a new Host generation, which drops every unsubscribed key of this Connection and re-reads the rest.
 */
/** An opaque value a Host generation is told apart by; only compared by identity. */
export type HostGenerationToken = string | number | object

export interface ResourceConnection {
  readonly identity: object
  readonly generation: () => HostGenerationToken | undefined
  readonly subscribe: (listener: () => void) => () => void
}

/**
 * A push channel that names the tags it invalidates, such as a Host event. While every source of a key reports
 * `live`, the key polls at `livePollInterval` instead of `pollInterval`; a source turning live re-reads once, since
 * missed pushes are not replayed.
 */
export interface ResourceInvalidationSource {
  readonly id: string
  readonly tags: readonly string[]
  readonly subscribe: (handlers: { readonly onInvalidate: () => void; readonly onLive: (live: boolean) => void }) => () => void
}

export interface ResourceDefinition<T = unknown> {
  readonly key: string
  readonly fetch: (signal: AbortSignal) => Promise<T>
  readonly tags?: readonly string[]
  /** Reuse a read this long before a new subscriber or a shown document reads again. Defaults to 0. */
  readonly staleTime?: number
  /** Poll while a subscriber is visible; omit for no poll. */
  readonly pollInterval?: number
  /** Poll while every invalidation source is live; omit to rely on the pushes alone. */
  readonly livePollInterval?: number
  /** Return false to stop polling for this snapshot, such as after an owner-missing failure. */
  readonly shouldPoll?: (snapshot: ResourceSnapshot<T>) => boolean
  /** Keep polling while the document is hidden. Defaults to false. */
  readonly pollWhileHidden?: boolean
  readonly connection?: ResourceConnection
  readonly invalidatedBy?: readonly ResourceInvalidationSource[]
}

export interface ResourceSubscribeOptions {
  /** Whether the subscriber is on screen; a hidden subscriber keeps the data but never starts a read. Defaults to true. */
  readonly visible?: boolean
  /** A shorter poll this subscriber needs while it shows more, such as an open popover. */
  readonly pollInterval?: number | undefined
}

export type ResourceSubscription = (() => void) & { readonly update: (options: ResourceSubscribeOptions) => void }

export type ResourceInvalidation = { readonly key: string } | { readonly tags: readonly string[] }

export interface ResourceStore {
  /** Declare how a key is read; returns the key. The latest registration of a key replaces its definition. */
  readonly register: <T>(definition: ResourceDefinition<T>) => string
  readonly subscribe: (key: string, listener: () => void, options?: ResourceSubscribeOptions) => ResourceSubscription
  /** The same object until the key changes, so `useSyncExternalStore` renders only on change. */
  readonly getSnapshot: <T = unknown>(key: string) => ResourceSnapshot<T>
  /** The fresh data, reading it when it is stale or `force` is set; rejects with the read's failure. */
  readonly ensure: <T = unknown>(key: string, options?: { readonly signal?: AbortSignal; readonly force?: boolean }) => Promise<T>
  /** Mark keys stale; subscribed and visible ones read again now, the rest on their next subscriber. */
  readonly invalidate: (target: ResourceInvalidation) => void
  /** Write a key's data after a mutation; an older read still in flight no longer replaces it. */
  readonly mutate: <T = unknown>(key: string, update: (previous: T | undefined) => T) => void
  /** Drop every key; for tests. */
  readonly clear: () => void
}

interface Subscriber {
  readonly listener: () => void
  visible: boolean
  pollInterval: number | undefined
}

interface Entry {
  definition: ResourceDefinition<unknown>
  snapshot: ResourceSnapshot<unknown>
  readonly subscribers: Set<Subscriber>
  timer: ReturnType<typeof setTimeout> | undefined
  inflight: { readonly promise: Promise<unknown>; readonly controller: AbortController } | undefined
  invalidated: boolean
  lastAttemptAt: number
  /** Bumped by a write or a reset; a read that started under an older epoch is discarded. */
  epoch: number
  readonly attachedSources: Set<string>
}

interface ConnectionState {
  generation: HostGenerationToken | undefined
  readonly keys: Set<string>
}

interface SourceState {
  readonly keys: Set<string>
  live: boolean
  unsubscribe: () => void
}

const IDLE: ResourceSnapshot<never> = Object.freeze({ status: 'idle', data: undefined, error: undefined, updatedAt: 0, fetching: false })
const MAX_IDLE_ENTRIES = 500

interface DocumentLike {
  readonly visibilityState?: string
  addEventListener?: (type: 'visibilitychange', listener: () => void) => void
}

// SAFETY: the page's document is read structurally; a carrier without one never hides.
const pageDocument = (): DocumentLike | undefined => (globalThis as { document?: DocumentLike }).document

const createResourceStore = (): ResourceStore => {
  const entries = new Map<string, Entry>()
  const connections = new WeakMap<object, ConnectionState>()
  const sources = new Map<string, SourceState>()

  const documentShown = (): boolean => pageDocument()?.visibilityState !== 'hidden'

  const connectionUp = (entry: Entry): boolean => {
    const connection = entry.definition.connection
    return connection === undefined || connection.generation() !== undefined
  }

  const hasVisibleSubscriber = (entry: Entry): boolean => [...entry.subscribers].some(subscriber => subscriber.visible)

  const active = (entry: Entry): boolean => hasVisibleSubscriber(entry) && connectionUp(entry) && (entry.definition.pollWhileHidden === true || documentShown())

  const allSourcesLive = (entry: Entry): boolean => entry.attachedSources.size > 0 && [...entry.attachedSources].every(id => sources.get(id)?.live === true)

  const pollInterval = (entry: Entry): number | undefined => {
    if (allSourcesLive(entry)) return entry.definition.livePollInterval
    const requested = [...entry.subscribers]
      .filter(subscriber => subscriber.visible)
      .map(subscriber => subscriber.pollInterval ?? entry.definition.pollInterval)
      .filter((value): value is number => value !== undefined)
    return requested.length === 0 ? undefined : Math.min(...requested)
  }

  const stale = (entry: Entry, now: number): boolean =>
    entry.invalidated ||
    entry.snapshot.status === 'idle' ||
    entry.snapshot.status === 'error' ||
    now - entry.snapshot.updatedAt >= (entry.definition.staleTime ?? 0)

  const setSnapshot = (entry: Entry, next: ResourceSnapshot<unknown>): void => {
    const previous = entry.snapshot
    if (
      previous.status === next.status &&
      previous.data === next.data &&
      previous.error === next.error &&
      previous.updatedAt === next.updatedAt &&
      previous.fetching === next.fetching
    )
      return
    entry.snapshot = next
    for (const subscriber of [...entry.subscribers]) subscriber.listener()
  }

  const clearTimer = (entry: Entry): void => {
    if (entry.timer === undefined) return
    clearTimeout(entry.timer)
    entry.timer = undefined
  }

  const schedule = (entry: Entry): void => {
    clearTimer(entry)
    if (entry.inflight !== undefined || !active(entry)) return
    const interval = pollInterval(entry)
    if (interval === undefined) return
    if (entry.definition.shouldPoll?.(entry.snapshot) === false) return
    const delay = Math.max(0, entry.lastAttemptAt + interval - Date.now())
    entry.timer = setTimeout(() => {
      entry.timer = undefined
      void run(entry).catch(() => undefined)
    }, delay)
  }

  const run = (entry: Entry): Promise<Entry['snapshot']['data']> => {
    if (entry.inflight !== undefined) return entry.inflight.promise
    clearTimer(entry)
    const controller = new AbortController()
    const epoch = entry.epoch
    entry.lastAttemptAt = Date.now()
    setSnapshot(entry, { ...entry.snapshot, status: entry.snapshot.status === 'idle' ? 'pending' : entry.snapshot.status, fetching: true })
    const settle = (apply: () => void): void => {
      if (entry.inflight?.controller === controller) entry.inflight = undefined
      if (epoch === entry.epoch && !controller.signal.aborted) apply()
      else if (entry.snapshot.fetching && entry.inflight === undefined) setSnapshot(entry, { ...entry.snapshot, fetching: false })
      schedule(entry)
    }
    const started = (() => {
      try {
        return Promise.resolve(entry.definition.fetch(controller.signal))
      } catch (error) {
        return Promise.reject(error)
      }
    })()
    const promise = started.then(
      data => {
        settle(() => {
          entry.invalidated = false
          setSnapshot(entry, { status: 'success', data, error: undefined, updatedAt: Date.now(), fetching: false })
        })
        return data
      },
      (error: unknown) => {
        settle(() => setSnapshot(entry, { status: 'error', data: entry.snapshot.data, error, updatedAt: entry.snapshot.updatedAt, fetching: false }))
        throw error
      },
    )
    entry.inflight = { promise, controller }
    return promise
  }

  const abortInflight = (entry: Entry): void => {
    const inflight = entry.inflight
    if (inflight === undefined) return
    entry.inflight = undefined
    inflight.controller.abort()
  }

  /** A key became (or stayed) required: read it when stale, else keep its poll on time. */
  const reconcile = (entry: Entry): void => {
    if (active(entry) && stale(entry, Date.now())) {
      void run(entry).catch(() => undefined)
      return
    }
    schedule(entry)
  }

  const evictIdle = (): void => {
    if (entries.size <= MAX_IDLE_ENTRIES) return
    for (const [key, entry] of entries) {
      if (entries.size <= MAX_IDLE_ENTRIES) return
      if (entry.subscribers.size > 0 || entry.inflight !== undefined) continue
      forget(key, entry)
    }
  }

  const forget = (key: string, entry: Entry): void => {
    clearTimer(entry)
    abortInflight(entry)
    entries.delete(key)
    const connection = entry.definition.connection
    if (connection !== undefined) connections.get(connection.identity)?.keys.delete(key)
  }

  const watchConnection = (key: string, connection: ResourceConnection): void => {
    const existing = connections.get(connection.identity)
    if (existing !== undefined) {
      existing.keys.add(key)
      return
    }
    const state: ConnectionState = { generation: connection.generation(), keys: new Set([key]) }
    connections.set(connection.identity, state)
    connection.subscribe(() => {
      const next = connection.generation()
      const previous = state.generation
      if (next === undefined) {
        for (const owned of state.keys) {
          const entry = entries.get(owned)
          if (entry === undefined) continue
          clearTimer(entry)
          abortInflight(entry)
          if (entry.snapshot.fetching) setSnapshot(entry, { ...entry.snapshot, fetching: false })
        }
        return
      }
      if (next === previous) return
      state.generation = next
      for (const owned of [...state.keys]) {
        const entry = entries.get(owned)
        if (entry === undefined) continue
        if (previous !== undefined) {
          if (entry.subscribers.size === 0) {
            forget(owned, entry)
            continue
          }
          entry.epoch += 1
          entry.invalidated = true
          abortInflight(entry)
        }
        reconcile(entry)
      }
    })
  }

  const attachSources = (key: string, entry: Entry): void => {
    for (const source of entry.definition.invalidatedBy ?? []) {
      if (entry.attachedSources.has(source.id)) continue
      entry.attachedSources.add(source.id)
      const existing = sources.get(source.id)
      if (existing !== undefined) {
        existing.keys.add(key)
        continue
      }
      const state: SourceState = { keys: new Set([key]), live: false, unsubscribe: () => undefined }
      sources.set(source.id, state)
      state.unsubscribe = source.subscribe({
        onInvalidate: () => invalidate({ tags: source.tags }),
        onLive: live => {
          if (state.live === live) return
          state.live = live
          for (const attached of state.keys) {
            const target = entries.get(attached)
            if (target === undefined) continue
            if (!live) {
              schedule(target)
              continue
            }
            target.invalidated = true
            reconcile(target)
          }
        },
      })
    }
  }

  const detachSources = (key: string, entry: Entry): void => {
    for (const id of entry.attachedSources) {
      const state = sources.get(id)
      if (state === undefined) continue
      state.keys.delete(key)
      if (state.keys.size > 0) continue
      sources.delete(id)
      state.unsubscribe()
    }
    entry.attachedSources.clear()
  }

  const invalidate = (target: ResourceInvalidation): void => {
    const matched =
      'key' in target
        ? [entries.get(target.key)].filter((entry): entry is Entry => entry !== undefined)
        : [...entries.values()].filter(entry => entry.definition.tags?.some(tag => target.tags.includes(tag)) === true)
    for (const entry of matched) {
      entry.invalidated = true
      if (entry.subscribers.size > 0) reconcile(entry)
    }
  }

  const register = <T>(definition: ResourceDefinition<T>): string => {
    // SAFETY: an entry stores its definition untyped; `getSnapshot<T>` and `ensure<T>` restate T at the read.
    const untyped = definition as ResourceDefinition<unknown>
    const existing = entries.get(definition.key)
    if (existing !== undefined) {
      existing.definition = untyped
      return definition.key
    }
    entries.set(definition.key, {
      definition: untyped,
      snapshot: IDLE,
      subscribers: new Set(),
      timer: undefined,
      inflight: undefined,
      invalidated: false,
      lastAttemptAt: 0,
      epoch: 0,
      attachedSources: new Set(),
    })
    if (definition.connection !== undefined) watchConnection(definition.key, definition.connection)
    evictIdle()
    return definition.key
  }

  const subscribe = (key: string, listener: () => void, options: ResourceSubscribeOptions = {}): ResourceSubscription => {
    const entry = entries.get(key)
    if (entry === undefined) throw new TypeError(`Resource ${JSON.stringify(key)} is not registered; register its definition first.`)
    const subscriber: Subscriber = { listener, visible: options.visible !== false, pollInterval: options.pollInterval }
    entry.subscribers.add(subscriber)
    attachSources(key, entry)
    reconcile(entry)
    let open = true
    const unsubscribe = (): void => {
      if (!open) return
      open = false
      entry.subscribers.delete(subscriber)
      if (entry.subscribers.size > 0) {
        schedule(entry)
        return
      }
      clearTimer(entry)
      detachSources(key, entry)
    }
    const update = (next: ResourceSubscribeOptions): void => {
      if (!open) return
      const visible = next.visible !== false
      const previousInterval = subscriber.pollInterval
      if (subscriber.visible === visible && previousInterval === next.pollInterval) return
      const revealed = visible && !subscriber.visible
      subscriber.visible = visible
      subscriber.pollInterval = next.pollInterval
      const shortened = next.pollInterval !== undefined && (previousInterval === undefined || next.pollInterval < previousInterval)
      if (active(entry) && (revealed || shortened) && Date.now() - entry.lastAttemptAt >= (pollInterval(entry) ?? Number.POSITIVE_INFINITY)) {
        void run(entry).catch(() => undefined)
        return
      }
      reconcile(entry)
    }
    return Object.assign(unsubscribe, { update })
  }

  const getSnapshot = <T>(key: string): ResourceSnapshot<T> => {
    // SAFETY: the caller names the type the key's registered definition reads.
    return (entries.get(key)?.snapshot ?? IDLE) as ResourceSnapshot<T>
  }

  const ensure = <T>(key: string, options: { readonly signal?: AbortSignal; readonly force?: boolean } = {}): Promise<T> => {
    const entry = entries.get(key)
    if (entry === undefined) return Promise.reject(new TypeError(`Resource ${JSON.stringify(key)} is not registered; register its definition first.`))
    // SAFETY: as in getSnapshot, the caller names the type its registered definition reads.
    if (options.force !== true && entry.snapshot.status === 'success' && !stale(entry, Date.now())) return Promise.resolve(entry.snapshot.data as T)
    // SAFETY: as above; `run` resolves with the definition's read.
    const shared = run(entry) as Promise<T>
    const signal = options.signal
    if (signal === undefined) return shared
    return new Promise<T>((resolve, reject) => {
      const abort = (): void => reject(signal.reason)
      if (signal.aborted) {
        abort()
        return
      }
      signal.addEventListener('abort', abort, { once: true })
      shared.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
    })
  }

  const mutate = <T>(key: string, update: (previous: T | undefined) => T): void => {
    const entry = entries.get(key)
    if (entry === undefined) return
    entry.epoch += 1
    abortInflight(entry)
    entry.invalidated = false
    // SAFETY: as in getSnapshot, the caller names the type its registered definition reads.
    const data = update(entry.snapshot.data as T | undefined)
    setSnapshot(entry, { status: 'success', data, error: undefined, updatedAt: Date.now(), fetching: false })
    schedule(entry)
  }

  const clear = (): void => {
    for (const [key, entry] of [...entries]) {
      detachSources(key, entry)
      forget(key, entry)
    }
  }

  pageDocument()?.addEventListener?.('visibilitychange', () => {
    for (const entry of entries.values()) if (entry.subscribers.size > 0) reconcile(entry)
  })

  return { register, subscribe, getSnapshot, ensure, invalidate, mutate, clear }
}

const STORE_KEY = Symbol.for('@dshfiles/dshx.resource-store.v1')

/** Every plugin bundles its own dshx copy, so the page keeps one store for all of them. */
const pageResourceStore = (): ResourceStore => {
  // SAFETY: only this module writes the versioned symbol, and always a ResourceStore.
  const holder = globalThis as { [STORE_KEY]?: ResourceStore }
  holder[STORE_KEY] ??= createResourceStore()
  return holder[STORE_KEY]
}

export class ResourceStoreModel {
  static readonly create = createResourceStore
  static readonly page = pageResourceStore
}
