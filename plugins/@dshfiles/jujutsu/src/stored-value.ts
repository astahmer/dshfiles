import * as Schema from 'effect/Schema'
import { useSyncExternalStore } from 'react'

type ValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export interface EffectStoredValue<Value, Fallback> {
  readonly get: () => Value | Fallback
  /** False when the value fails the schema or the browser refuses the write (quota, privacy mode). */
  readonly set: (next: Value) => boolean
  readonly remove: () => void
  /** Re-read storage, e.g. after another window changed it through a channel other than the storage event. */
  readonly reload: () => void
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
 * The Effect-schema sibling of `@dshfiles/plugin-ui/hooks/stored-value`, whose
 * decoder only accepts zod. Same storage contract: cross-tab storage events,
 * fallback for missing or invalid values, and a bare legacy string is still
 * accepted when the schema takes it.
 */
export const createEffectStoredValue = <ValueSchema extends Schema.ConstraintDecoder<unknown>, Fallback>(options: {
  readonly key: string
  readonly schema: ValueSchema
  readonly fallback: Fallback
  readonly storage?: (() => ValueStorage | null) | undefined
}) => {
  const storage = options.storage ?? browserStorage
  const listeners = new Set<() => void>()
  let cached: { readonly value: ValueSchema['Type'] | Fallback } | null = null

  const decode = (raw: string): ValueSchema['Type'] | Fallback => {
    let parsed: unknown = raw
    try {
      parsed = JSON.parse(raw)
    } catch {
      // A value written before the key held JSON: let the schema decide whether the raw text is acceptable.
    }
    const checked = Schema.decodeUnknownResult(options.schema)(parsed)
    return checked._tag === 'Success' ? checked.success : options.fallback
  }

  const read = (): ValueSchema['Type'] | Fallback => {
    try {
      const raw = storage()?.getItem(options.key) ?? null
      return raw === null ? options.fallback : decode(raw)
    } catch {
      return options.fallback
    }
  }

  const get = (): ValueSchema['Type'] | Fallback => {
    cached ??= { value: read() }
    return cached.value
  }

  const publish = (value: ValueSchema['Type'] | Fallback): void => {
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

  const set = (next: ValueSchema['Type']): boolean => {
    const checked = Schema.decodeUnknownResult(options.schema)(next)
    if (checked._tag !== 'Success') return false
    publish(checked.success)
    try {
      const target = storage()
      if (target === null) return false
      target.setItem(options.key, JSON.stringify(checked.success))
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

  return {
    get,
    set,
    remove,
    reload,
    useValue: () => useSyncExternalStore(subscribe, get, get),
  } satisfies EffectStoredValue<ValueSchema['Type'], Fallback>
}
