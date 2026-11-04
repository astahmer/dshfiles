import * as EffectSchema from 'effect/Schema'
import { useSyncExternalStore } from 'react'

/** A zod-style schema; every zod schema satisfies it. */
export interface StoredValueSchema<Value> {
  // oxlint-disable-next-line antislop/no-unknown-parameters -- This is the decode boundary: the schema parses the stored JSON value.
  readonly safeParse: (value: unknown) => { readonly success: true; readonly data: Value } | { readonly success: false }
}

/** The decoded value a schema reports: an Effect schema's `Type`, or a zod schema's parsed data. */
type StoredValueOutput<Schema> =
  Schema extends EffectSchema.ConstraintDecoder<unknown>
    ? Schema['Type']
    : Schema extends { readonly safeParse: (input: never) => { readonly success: true; readonly data: infer Data } | { readonly success: false } }
      ? Data
      : never

type AcceptedSchema<Schema> = Schema extends EffectSchema.ConstraintDecoder<unknown> ? Schema : Schema & StoredValueSchema<StoredValueOutput<Schema>>

// oxlint-disable-next-line antislop/no-unknown-parameters -- The decode boundary for stored JSON.
type Check<Value> = (value: unknown) => { readonly ok: true; readonly value: Value } | { readonly ok: false }

const checkerOf = <Value>(schema: EffectSchema.ConstraintDecoder<unknown> | StoredValueSchema<Value>): Check<Value> => {
  if ('safeParse' in schema) {
    return value => {
      const parsed = schema.safeParse(value)
      return parsed.success ? { ok: true, value: parsed.data } : { ok: false }
    }
  }
  const decode = EffectSchema.decodeUnknownResult(schema)
  return value => {
    const decoded = decode(value)
    // SAFETY: the Effect branch is only taken when Value is that schema's `Type` (see StoredValueOutput).
    return decoded._tag === 'Success' ? { ok: true, value: decoded.success as Value } : { ok: false }
  }
}

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
 * One localStorage key behind a schema (an Effect schema or a zod schema), shared by every reader in the bundle and
 * kept in step across tabs through the storage event. Missing, unreadable, non-JSON or invalid values read as
 * `fallback`; a bare legacy string is still accepted when the schema takes it.
 */
export const createStoredValue = <Schema, Fallback = StoredValueOutput<Schema>>(options: {
  readonly key: string
  readonly schema: AcceptedSchema<Schema>
  readonly fallback: Fallback
  readonly storage?: (() => ValueStorage | null) | undefined
}): StoredValue<StoredValueOutput<Schema>, Fallback> => {
  type Value = StoredValueOutput<Schema>
  // SAFETY: AcceptedSchema narrows to exactly one of the two shapes checkerOf takes.
  const check = checkerOf<Value>(options.schema as EffectSchema.ConstraintDecoder<unknown> | StoredValueSchema<Value>)
  const storage = options.storage ?? browserStorage
  const listeners = new Set<() => void>()
  let cached: { readonly value: Value | Fallback } | null = null

  const decode = (raw: string): Value | Fallback => {
    let parsed: unknown = raw
    try {
      parsed = JSON.parse(raw)
    } catch {
      // A value written before the key held JSON: let the schema decide whether the raw text is acceptable.
    }
    const checked = check(parsed)
    return checked.ok ? checked.value : options.fallback
  }

  const read = (): Value | Fallback => {
    try {
      const raw = storage()?.getItem(options.key) ?? null
      return raw === null ? options.fallback : decode(raw)
    } catch {
      return options.fallback
    }
  }

  const get = (): Value | Fallback => {
    cached ??= { value: read() }
    return cached.value
  }

  const publish = (value: Value | Fallback): void => {
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

  const set = (next: Value): boolean => {
    const checked = check(next)
    if (!checked.ok) return false
    publish(checked.value)
    try {
      const target = storage()
      if (target === null) return false
      target.setItem(options.key, JSON.stringify(checked.value))
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
