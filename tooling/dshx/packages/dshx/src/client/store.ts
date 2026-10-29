import type { StandardSchemaV1 } from '@standard-schema/spec'
import type { Subscribable } from './broker.js'

/** `global` keeps one value; `session` and `project` keep one per session or project id. */
export type StoreScope = 'global' | 'session' | 'project'

export interface StoreDefinition<T, Scope extends StoreScope = StoreScope> {
  /** Unique per plugin, e.g. `@dshfiles/backlog.filters`. */
  readonly key: string
  readonly scope: Scope
  /** Every read is decoded with it; a stored value that fails falls back to `initial`. */
  readonly schema: StandardSchemaV1<unknown, T>
  readonly initial: T
  /** Earlier keys to import the value from once while this store holds none, newest first. */
  readonly from?: string | readonly string[]
  /**
   * `local` (default) keeps the value in browser storage. `memory` keeps it on the page: it survives a plugin reload
   * or HMR, but not a page reload, and other tabs do not see it.
   */
  readonly storage?: 'local' | 'memory'
}

/** One stored value: read it, observe it, write it. */
export interface PersistedStore<T> extends Subscribable<T> {
  set(next: T): void
  /** Write a value derived from the current one. */
  update(change: (current: T) => T): void
  /** Delete the stored value, so it reads as `initial` again. */
  remove(): void
}

export type DefinedStore<T, Scope extends StoreScope> = Scope extends 'global' ? PersistedStore<T> : (scopeId: string) => PersistedStore<T>

interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const STORAGE_PREFIX = 'dshx:'

declare global {
  // Every plugin bundles its own dshx copy, so memory values live on the page to outlive one copy's reload.
  var __dshxMemoryStoreV1: Map<string, string> | undefined
}

const localStorageOf = (): StorageLike | undefined => {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

const memoryStorage = (): StorageLike => {
  globalThis.__dshxMemoryStoreV1 ??= new Map()
  const values = globalThis.__dshxMemoryStoreV1
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
    removeItem: key => void values.delete(key),
  }
}

const storageKey = (key: string, scope: StoreScope, scopeId: string | undefined): string =>
  scopeId === undefined ? `${STORAGE_PREFIX}${key}` : `${STORAGE_PREFIX}${key}:${scope}:${scopeId}`

const decode = <T>(schema: StandardSchemaV1<unknown, T>, raw: string | null): { readonly ok: true; readonly value: T } | { readonly ok: false } => {
  if (raw === null) return { ok: false }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false }
  }
  const result = schema['~standard'].validate(parsed)
  if (result instanceof Promise) throw new TypeError('dshx stores need a synchronous schema.')
  if (result.issues !== undefined) return { ok: false }
  return { ok: true, value: result.value }
}

const listenersByKey = new Map<string, Set<() => void>>()

const notify = (key: string): void => {
  for (const listener of [...(listenersByKey.get(key) ?? [])]) listener()
}

let crossTabBound = false

const bindCrossTab = (): void => {
  if (crossTabBound || typeof window === 'undefined') return
  crossTabBound = true
  window.addEventListener('storage', event => {
    if (event.key?.startsWith(STORAGE_PREFIX) === true) notify(event.key)
  })
}

const createPersisted = <T>(definition: StoreDefinition<T>, scopeId: string | undefined): PersistedStore<T> => {
  const key = storageKey(definition.key, definition.scope, scopeId)
  const legacyKeys = definition.from === undefined ? [] : typeof definition.from === 'string' ? [definition.from] : definition.from
  let cached: { readonly raw: string | null; readonly value: T } | undefined
  const storage = definition.storage === 'memory' ? memoryStorage : localStorageOf

  const migrate = (): void => {
    const target = storage()
    if (target === undefined || target.getItem(key) !== null) return
    for (const legacyKey of legacyKeys) {
      const legacy = target.getItem(scopeId === undefined ? legacyKey : `${legacyKey}:${definition.scope}:${scopeId}`)
      if (legacy === null || !decode(definition.schema, legacy).ok) continue
      target.setItem(key, legacy)
      return
    }
  }

  const read = (): T => {
    const raw = storage()?.getItem(key) ?? null
    if (cached !== undefined && cached.raw === raw) return cached.value
    const decoded = decode(definition.schema, raw)
    const value = decoded.ok ? decoded.value : definition.initial
    cached = { raw, value }
    return value
  }

  const write = (next: T): void => {
    const target = storage()
    if (target === undefined) return
    target.setItem(key, JSON.stringify(next))
    notify(key)
  }

  migrate()
  bindCrossTab()
  return {
    get: read,
    subscribe: listener => {
      const listeners = listenersByKey.get(key) ?? new Set()
      listeners.add(listener)
      listenersByKey.set(key, listeners)
      return () => listeners.delete(listener)
    },
    set: write,
    update: change => write(change(read())),
    remove: () => {
      storage()?.removeItem(key)
      notify(key)
    },
  }
}

/**
 * Declare one schema-typed value kept in browser storage.
 *
 * A `global` store returns the store itself; `session` and `project` stores
 * return a function of the session or project id. Reads are synchronous, so a
 * store is ready before setup runs and writes never queue.
 */
const defineStore = <T, const Scope extends StoreScope>(definition: StoreDefinition<T, Scope>): DefinedStore<T, Scope> => {
  if (definition.key.trim() === '') throw new TypeError('dshx store key must be non-empty.')
  if (definition.scope === 'global') {
    // The conditional return type resolves to PersistedStore<T> for the global scope.
    return createPersisted(definition, undefined) as DefinedStore<T, Scope>
  }
  const byScopeId = new Map<string, PersistedStore<T>>()
  const forScope = (scopeId: string): PersistedStore<T> => {
    const existing = byScopeId.get(scopeId)
    if (existing !== undefined) return existing
    const created = createPersisted(definition, scopeId)
    byScopeId.set(scopeId, created)
    return created
  }
  // The conditional return type resolves to the per-id factory for session and project scopes.
  return forScope as DefinedStore<T, Scope>
}

export class StoreModel {
  static readonly define = defineStore
}
