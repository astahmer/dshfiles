export interface RepositoryViewsSnapshot<Value> {
  readonly value: Value | undefined
  readonly refreshing: boolean
  readonly refreshFailed: boolean
}

type CacheEntry<Value> = { readonly value: Value; readonly at: number }
type ScanResult<Value> = { readonly ok: true; readonly value: Value } | { readonly ok: false; readonly error: unknown }

export const createRepositoryViewsCache = <Value>(options: { readonly read: () => Promise<Value>; readonly ttlMs: number; readonly now?: () => number }) => {
  const now = options.now ?? Date.now
  let cached: CacheEntry<Value> | undefined
  let scan: Promise<ScanResult<Value>> | undefined
  let generation = 0
  let invalidated = false
  let failedAt: number | undefined

  const startScan = () => {
    if (scan !== undefined) return { started: false, promise: scan }
    // oxlint-disable-next-line antislop/no-passthrough-variable -- snapshot: invalidation can advance `generation` while this async scan is running.
    const scanGeneration = generation
    let source: Promise<Value>
    try {
      source = options.read()
    } catch (error) {
      source = Promise.reject(error)
    }
    const pending = source.then(
      value => {
        if (scanGeneration === generation) {
          cached = { value, at: now() }
          invalidated = false
          failedAt = undefined
        }
        const result: ScanResult<Value> = { ok: true, value }
        return result
      },
      error => {
        if (scanGeneration === generation) failedAt = now()
        const result: ScanResult<Value> = { ok: false, error }
        return result
      },
    )
    scan = pending
    void pending.finally(() => {
      if (scan === pending) scan = undefined
    })
    failedAt = undefined
    return { started: true, promise: pending }
  }

  const read = (): RepositoryViewsSnapshot<Value> => {
    const currentTime = now()
    const recentFailure = failedAt !== undefined && currentTime - failedAt < options.ttlMs
    if (scan !== undefined) return { value: cached?.value, refreshing: true, refreshFailed: false }
    if (!invalidated && cached !== undefined && currentTime - cached.at < options.ttlMs) {
      return { value: cached.value, refreshing: false, refreshFailed: recentFailure }
    }
    if (recentFailure) return { value: cached?.value, refreshing: false, refreshFailed: true }
    startScan()
    return { value: cached?.value, refreshing: scan !== undefined, refreshFailed: false }
  }

  const refreshAndRead = async (): Promise<Value> => {
    const result = await startScan().promise
    if (!result.ok) throw result.error
    return result.value
  }

  const invalidate = (): void => {
    generation += 1
    invalidated = true
    scan = undefined
    failedAt = undefined
  }

  return { read, startRefresh: () => startScan().started, refreshAndRead, invalidate }
}
