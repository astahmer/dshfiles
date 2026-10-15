import { useSyncExternalStore } from 'react'
import type { output, ZodType } from 'zod'

type ValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface StoredValue<Value, Fallback> {
  readonly get: () => Value | Fallback
  /** False when the value fails the schema or the browser refuses the write (quota, privacy mode). */
  readonly set: (next: Value) => boolean
  readonly remove: () => void
  /** Re-read storage, e.g. after another window changed it through a channel other than the storage event. */
  readonly reload: () => void
  readonly subscribe: (listener: () => void) => () => void
  readonly useValue: () => Value | Fallback
}

const browserStorage = (): ValueStorage | null => {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

/**
 * One localStorage key behind a zod schema, shared by every reader in the bundle and kept in step across tabs through
 * the storage event. Missing, unreadable, non-JSON or invalid values read as `fallback`; a bare legacy string is still
 * accepted when the schema takes it.
 */
export const createStoredValue = <Schema extends ZodType, Fallback = output<Schema>>(options: {
  readonly key: string
  readonly schema: Schema
  readonly fallback: Fallback
  readonly storage?: (() => ValueStorage | null) | undefined
}): StoredValue<output<Schema>, Fallback> => {
  const storage = options.storage ?? browserStorage
  const listeners = new Set<() => void>()
  let cached: { readonly value: output<Schema> | Fallback } | null = null

  const decode = (raw: string): output<Schema> | Fallback => {
    let parsed: unknown = raw
    try {
      parsed = JSON.parse(raw)
    } catch {
      // A value written before the key held JSON: let the schema decide whether the raw text is acceptable.
    }
    const checked = options.schema.safeParse(parsed)
    return checked.success ? checked.data : options.fallback
  }

  const read = (): output<Schema> | Fallback => {
    try {
      const raw = storage()?.getItem(options.key) ?? null
      return raw === null ? options.fallback : decode(raw)
    } catch {
      return options.fallback
    }
  }

  const get = (): output<Schema> | Fallback => {
    cached ??= { value: read() }
    return cached.value
  }

  const publish = (value: output<Schema> | Fallback): void => {
    cached = { value }
    for (const listener of listeners) listener()
  }

  const reload = (): void => publish(read())

  const onStorage = (event: StorageEvent): void => {
    if (event.key === options.key || event.key === null) reload()
  }

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener)
    if (listeners.size === 1) globalThis.addEventListener?.('storage', onStorage)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) globalThis.removeEventListener?.('storage', onStorage)
    }
  }

  const set = (next: output<Schema>): boolean => {
    const checked = options.schema.safeParse(next)
    if (!checked.success) return false
    publish(checked.data)
    try {
      const target = storage()
      if (target === null) return false
      target.setItem(options.key, JSON.stringify(checked.data))
      return true
    } catch {
      return false
    }
  }

  const remove = (): void => {
    try {
      storage()?.removeItem(options.key)
    } catch {
      // Nothing to clean up when storage is unavailable.
    }
    publish(options.fallback)
  }

  return { get, set, remove, reload, subscribe, useValue: () => useSyncExternalStore(subscribe, get, get) }
}
