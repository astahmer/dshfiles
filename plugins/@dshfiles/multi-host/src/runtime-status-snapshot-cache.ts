import { pluginAttributes, withSpan } from '@dshfiles/dshx/tracing'

type CachedStatus = { readonly ok: boolean }
type StatusEntry<Status> = { readonly status: Status; readonly refreshedAt: number }
type RuntimeStatusSnapshot<Status> = { readonly status: Status | undefined; readonly stale: boolean; readonly refreshing: boolean }

export const createRuntimeStatusCache = <Status extends CachedStatus>(input: {
  readonly now?: () => number
  readonly successTtlMs: number
  readonly failureTtlMs: number
  readonly maxEntries?: number
  readonly spanName?: string
}) => {
  const entries = new Map<string, StatusEntry<Status>>()
  const refreshes = new Map<string, Promise<void>>()
  const generations = new Map<string, number>()
  const now = input.now ?? Date.now
  const maxEntries = input.maxEntries ?? 128

  const read = (runtimeId: string): RuntimeStatusSnapshot<Status> => {
    const entry = entries.get(runtimeId)
    if (entry === undefined) return { status: undefined, stale: true, refreshing: refreshes.has(runtimeId) }
    const ttlMs = entry.status.ok ? input.successTtlMs : input.failureTtlMs
    return { status: entry.status, stale: now() >= entry.refreshedAt + ttlMs, refreshing: refreshes.has(runtimeId) }
  }

  const refresh = (runtimeId: string, load: () => Promise<Status>): Promise<void> => {
    const active = refreshes.get(runtimeId)
    if (active !== undefined) return active

    const generation = generations.get(runtimeId) ?? 0
    const pending = withSpan(
      input.spanName ?? 'multi-host runtime status refresh',
      { attributes: pluginAttributes({ plugin: 'multi-host', attributes: { runtime_id: runtimeId } }) },
      async () => {
        const status = await load()
        if ((generations.get(runtimeId) ?? 0) !== generation) return
        entries.delete(runtimeId)
        entries.set(runtimeId, { status, refreshedAt: now() })
        while (entries.size > maxEntries) {
          const oldest = entries.keys().next().value
          if (oldest === undefined) break
          entries.delete(oldest)
        }
      },
    ).finally(() => {
      refreshes.delete(runtimeId)
      generations.delete(runtimeId)
    })
    refreshes.set(runtimeId, pending)
    return pending
  }

  const invalidate = (runtimeId: string): void => {
    entries.delete(runtimeId)
    if (refreshes.has(runtimeId)) generations.set(runtimeId, (generations.get(runtimeId) ?? 0) + 1)
  }

  return { read, refresh, invalidate }
}
