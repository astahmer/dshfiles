import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import {
  compareAttentionViews,
  type ThreadAttentionChanges,
  type ThreadAttentionMigrationEntry,
  type ThreadAttentionSnapshot,
  type ThreadAttentionView,
  type ThreadAttentionWriteCommand,
} from './attention-api.js'

/** The slice of the client this store uses, so a test can serve it without casting. */
export interface AttentionApi {
  readonly state: (input: undefined, options?: { readonly signal?: AbortSignal }) => Promise<ThreadAttentionSnapshot>
  /** Absent on a Host that predates it; the store then reads `state` every time. */
  readonly changesSince?: (input: { readonly revision: number }, options?: { readonly signal?: AbortSignal }) => Promise<ThreadAttentionChanges>
  readonly acknowledge: (
    input: { readonly sessionId: string; readonly version: number },
    options?: { readonly signal?: AbortSignal },
  ) => Promise<ThreadAttentionSnapshot>
  readonly clearUnread: (
    input: { readonly sessionId: string; readonly version: number },
    options?: { readonly signal?: AbortSignal },
  ) => Promise<ThreadAttentionSnapshot>
  readonly clearUnreadMany: (
    input: { readonly entries: { readonly sessionId: string; readonly version: number }[] },
    options?: { readonly signal?: AbortSignal },
  ) => Promise<ThreadAttentionSnapshot>
  readonly markUnread: (input: { readonly sessionId: string }, options?: { readonly signal?: AbortSignal }) => Promise<ThreadAttentionSnapshot>
  readonly markUnreadMany: (input: { readonly sessionIds: string[] }, options?: { readonly signal?: AbortSignal }) => Promise<ThreadAttentionSnapshot>
  readonly migrate: (
    input: { readonly entries: ThreadAttentionMigrationEntry[] },
    options?: { readonly signal?: AbortSignal },
  ) => Promise<ThreadAttentionSnapshot>
  /** Absent on a Host that predates delta writes; the store then writes through the v1 methods. */
  readonly writeDelta?: (
    input: { readonly since: number; readonly command: ThreadAttentionWriteCommand },
    options?: { readonly signal?: AbortSignal },
  ) => Promise<ThreadAttentionChanges>
  /** Absent on that same older Host: probe it before any delta write. */
  readonly writeCapabilities?: (input?: undefined, options?: { readonly signal?: AbortSignal }) => Promise<{ readonly deltaVersion: 1 }>
}

export interface ThreadAttentionClientState {
  readonly snapshot: ThreadAttentionSnapshot | null
  readonly error: unknown
  readonly ownerMissing: boolean
}

/**
 * How often the one page-wide attention read runs. Attention changes when a turn
 * ends, which the sidebar also refreshes on directly, so a slow safety poll is
 * enough; every consumer shares this read instead of adding its own interval.
 */
const POLL_MS = 30_000
/** Two surfaces mounting or focusing together still cause one Host read. */
const MIN_REFRESH_GAP_MS = 2_000

export interface ThreadAttentionStore {
  subscribe(listener: () => void): () => void
  getSnapshot(): ThreadAttentionClientState
  /** Register one mounted consumer; returns its detach. */
  attach(api: AttentionApi): () => void
  refresh(): Promise<void>
  /**
   * The Host announced a change at this revision: read now, past the refresh gap, unless ours is newer. Absent on a
   * store an older bundle created for the page, which callers then refresh instead.
   */
  changed?(revision: number): void
  acknowledge(sessionId: string, version: number): Promise<void>
  clearUnread(sessionId: string, version: number): Promise<void>
  clearUnreadMany(entries: readonly { readonly sessionId: string; readonly version: number }[]): Promise<void>
  markUnread(sessionId: string): Promise<void>
  markUnreadMany(sessionIds: readonly string[]): Promise<void>
  migrate(entries: readonly ThreadAttentionMigrationEntry[]): Promise<void>
  /** Drop cached state so a test starts from a clean page. */
  reset(): void
}

const createStore = (): ThreadAttentionStore => {
  const listeners = new Set<() => void>()
  let state: ThreadAttentionClientState = { snapshot: null, error: null, ownerMissing: false }
  let api: AttentionApi | null = null
  let active = 0
  let pollTimer: ReturnType<typeof setInterval> | null = null
  let inFlight: Promise<void> | null = null
  let lastAttemptAt = 0
  let stopped = false
  let revision = 0

  const notify = (): void => {
    for (const listener of listeners) listener()
  }

  const setState = (next: ThreadAttentionClientState): void => {
    state = next
    notify()
  }

  const adopt = (snapshot: ThreadAttentionSnapshot): void => {
    if (snapshot.revision < revision) return
    if (snapshot.revision === revision && snapshot.sessions === state.snapshot?.sessions && state.error === null) return
    revision = snapshot.revision
    setState({ snapshot, error: null, ownerMissing: false })
  }

  /** A Host without `changesSince` fails it (an unknown method); this page then reads the whole state every time. */
  let changesUnsupported = false

  /**
   * The records changed since the snapshot this page holds, merged into it; the whole state when there is no snapshot
   * yet, the Host does not know every change since (`complete: false`), or the call fails.
   */
  const fetchState = async (client: AttentionApi): Promise<ThreadAttentionSnapshot> => {
    const held = state.snapshot
    if (held === null || client.changesSince === undefined || changesUnsupported) return client.state(undefined, {})
    let changes: ThreadAttentionChanges
    try {
      changes = await client.changesSince({ revision: held.revision }, {})
    } catch (error) {
      if (error instanceof Error && isApiOwnerMissing(error)) throw error
      changesUnsupported = true
      return client.state(undefined, {})
    }
    if (!changes.complete) return client.state(undefined, {})
    if (changes.put.length === 0 && changes.removed.length === 0) return { revision: changes.revision, sessions: held.sessions }
    const merged = new Map(held.sessions.map(view => [view.sessionId, view]))
    for (const sessionId of changes.removed) merged.delete(sessionId)
    for (const view of changes.put) merged.set(view.sessionId, view)
    return { revision: changes.revision, sessions: [...merged.values()].sort(compareAttentionViews) }
  }

  const read = (): Promise<void> => {
    if (stopped || api === null || active === 0) return Promise.resolve()
    if (inFlight !== null) return inFlight
    const now = Date.now()
    if (now - lastAttemptAt < MIN_REFRESH_GAP_MS) return Promise.resolve()
    lastAttemptAt = now
    const pending = fetchState(api)
      .then(snapshot => {
        adopt(snapshot)
      })
      .catch((error: unknown) => {
        if (error instanceof Error && isApiOwnerMissing(error)) {
          stopped = true
          setState({ snapshot: state.snapshot, error, ownerMissing: true })
          return
        }
        setState({ snapshot: state.snapshot, error, ownerMissing: false })
      })
      .finally(() => {
        inFlight = null
      })
    inFlight = pending
    return pending
  }

  const stopPolling = (): void => {
    if (pollTimer === null) return
    clearInterval(pollTimer)
    pollTimer = null
  }

  const startPolling = (): void => {
    if (pollTimer !== null) return
    pollTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      void read()
    }, POLL_MS)
  }

  const onVisible = (): void => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    if (active === 0) return
    void read()
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)
  }

  // A cleared record leaves the Host revision where it was, so an announced revision equal to ours still means a read.
  let rereadQueued = false
  const changed = (next: number): void => {
    if (next < revision) return
    const force = (): void => {
      lastAttemptAt = 0
      void read()
    }
    if (inFlight === null) {
      force()
      return
    }
    if (rereadQueued) return
    rereadQueued = true
    void inFlight.then(() => {
      rereadQueued = false
      force()
    })
  }

  const mutate = async (call: () => Promise<ThreadAttentionSnapshot>): Promise<void> => {
    adopt(await call())
  }

  /**
   * Delta writes: probed once per page store, never cached as unsupported after a failure, and every write is
   * serialized so two surfaces cannot send overlapping bases. A delta answer merges only when this page still holds the
   * revision the write was built on; otherwise the page refreshes from the Host, and a failed delta write is never
   * replayed through the v1 methods.
   */
  let deltaSupported: boolean | null = null
  let writeQueue: Promise<unknown> = Promise.resolve()

  const deltaReady = async (client: AttentionApi): Promise<boolean> => {
    if (deltaSupported !== null) return deltaSupported
    if (client.writeCapabilities === undefined || client.writeDelta === undefined) return false
    try {
      await client.writeCapabilities(undefined, {})
      deltaSupported = true
      return true
    } catch (error) {
      if (error instanceof Error && isApiOwnerMissing(error)) throw error
      return false
    }
  }

  const mergeDelta = (changes: ThreadAttentionChanges, since: number): void => {
    const held = state.snapshot
    if (held === null || held.revision !== since) {
      void read()
      return
    }
    if (!changes.complete) {
      void read()
      return
    }
    const merged = new Map(held.sessions.map(view => [view.sessionId, view]))
    for (const sessionId of changes.removed) merged.delete(sessionId)
    for (const view of changes.put) merged.set(view.sessionId, view)
    adopt({ revision: changes.revision, sessions: [...merged.values()].sort(compareAttentionViews) })
  }

  const write = (command: ThreadAttentionWriteCommand, legacy: () => Promise<ThreadAttentionSnapshot>): Promise<void> => {
    const run = async (): Promise<void> => {
      const client = requireApi()
      if (!(await deltaReady(client))) {
        await mutate(legacy)
        return
      }
      const held = state.snapshot
      if (held === null || client.writeDelta === undefined) {
        await mutate(legacy)
        return
      }
      const since = held.revision
      try {
        mergeDelta(await client.writeDelta({ since, command }, {}), since)
      } catch (error) {
        void read()
        throw error
      }
    }
    const next = writeQueue.then(run, run)
    writeQueue = next.catch(() => undefined)
    return next
  }

  const requireApi = (): AttentionApi => {
    if (api === null) throw new Error('Thread attention was written before any surface mounted it.')
    return api
  }

  return {
    subscribe: listener => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => state,
    attach: client => {
      api = client
      active += 1
      startPolling()
      void read()
      return () => {
        active = Math.max(0, active - 1)
        if (active > 0) return
        stopPolling()
      }
    },
    refresh: read,
    changed,
    acknowledge: (sessionId, version) => write({ kind: 'acknowledge', sessionId, version }, () => requireApi().acknowledge({ sessionId, version })),
    clearUnread: (sessionId, version) => write({ kind: 'clearUnread', sessionId, version }, () => requireApi().clearUnread({ sessionId, version })),
    clearUnreadMany: entries => write({ kind: 'clearUnreadMany', entries: [...entries] }, () => requireApi().clearUnreadMany({ entries: [...entries] })),
    markUnread: sessionId => write({ kind: 'markUnread', sessionId }, () => requireApi().markUnread({ sessionId })),
    markUnreadMany: sessionIds => write({ kind: 'markUnreadMany', sessionIds: [...sessionIds] }, () => requireApi().markUnreadMany({ sessionIds: [...sessionIds] })),
    migrate: entries => write({ kind: 'migrate', entries: [...entries] }, () => requireApi().migrate({ entries: [...entries] })),
    reset: () => {
      listeners.clear()
      state = { snapshot: null, error: null, ownerMissing: false }
      api = null
      active = 0
      revision = 0
      rereadQueued = false
      lastAttemptAt = 0
      stopped = false
      changesUnsupported = false
      deltaSupported = null
      writeQueue = Promise.resolve()
      stopPolling()
    },
  }
}

interface AttentionGlobal {
  __dshfilesThreadAttentionStore?: ThreadAttentionStore
}

/** One store per page: every plugin bundle that reads attention shares this poll. */
export const sharedThreadAttentionStore = (): ThreadAttentionStore => {
  const scope = globalThis as AttentionGlobal
  scope.__dshfilesThreadAttentionStore ??= createStore()
  return scope.__dshfilesThreadAttentionStore
}

export const threadAttentionViews = (snapshot: ThreadAttentionSnapshot | null): readonly ThreadAttentionView[] => snapshot?.sessions ?? []
