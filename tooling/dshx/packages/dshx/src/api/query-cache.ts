/**
 * Completed API reads shared by every mounted surface, so reopening a panel or
 * mounting a second slot within the stale window costs no Host call. dshx is
 * inlined into each plugin bundle, so the store lives on globalThis: a page has
 * one cache even though it has several copies of this module.
 */
interface CachedApiQuery {
  readonly value: unknown
  readonly at: number
}

const CACHE_KEY = '__dshfilesDshxApiQueryCache'

const store = (): Map<string, CachedApiQuery> => {
  const scope = globalThis as typeof globalThis & { [CACHE_KEY]?: Map<string, CachedApiQuery> }
  scope[CACHE_KEY] ??= new Map()
  return scope[CACHE_KEY]
}

export class ApiQueryCache {
  /** The cached value when it is younger than `staleTime`, otherwise undefined. */
  static read(key: string, staleTime: number, now = Date.now()): unknown {
    const entry = store().get(key)
    if (entry === undefined || now - entry.at >= staleTime) return undefined
    return entry.value
  }

  static write(key: string, value: unknown, now = Date.now()): void {
    const cache = store()
    cache.set(key, { value, at: now })
    if (cache.size <= 500) return
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }

  /** Drop every cached read; for tests and for a connection that changed identity. */
  static clear(): void {
    store().clear()
  }
}
