import type { JjCommand } from './jj.ts'

export interface ViewReadKey {
  readonly operationHeads: string
  readonly command: JjCommand
}

/** The reads cached for one store at one operation head. */
export interface StoreViewReads {
  readonly heads: string
  readonly keys: ReadonlyMap<string, ViewReadKey>
}

/** One entry per store directory, so a moved head drops that store's reads and no other store's. */
export type TrackedViewReads = ReadonlyMap<string, StoreViewReads>

export interface ViewReadTracking {
  readonly invalidated: readonly ViewReadKey[]
  readonly next: TrackedViewReads
}

export const viewReadSignature = (key: ViewReadKey): string => [key.operationHeads, key.command.cwd, ...key.command.args].join('\u0000')

/**
 * Record one read against its store and return the entries the store's head just made unreachable. A key carries the
 * head it was read at, so an entry from an older head can never be answered again; without this bookkeeping it would
 * stay in the cache, up to a 1.16 MB result each, until the LRU dropped it.
 */
export const trackViewRead = (
  current: TrackedViewReads,
  input: { readonly store: string; readonly heads: string; readonly key: ViewReadKey },
): ViewReadTracking => {
  const entry = current.get(input.store)
  const sameHeads = entry !== undefined && entry.heads === input.heads
  const invalidated = entry === undefined || sameHeads ? [] : [...entry.keys.values()]
  const keys = new Map<string, ViewReadKey>()
  if (entry !== undefined && sameHeads) for (const [signature, key] of entry.keys) keys.set(signature, key)
  keys.set(viewReadSignature(input.key), input.key)
  const next = new Map(current)
  next.set(input.store, { heads: input.heads, keys })
  return { invalidated, next }
}
