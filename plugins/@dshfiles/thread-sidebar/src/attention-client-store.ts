import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import type { ThreadAttentionMigrationEntry, ThreadAttentionSnapshot, ThreadAttentionView } from './attention-api.js'

/** The slice of the client this store uses, so a test can serve it without casting. */
export interface AttentionApi {
  readonly state: (input: undefined, options?: { readonly signal?: AbortSignal }) => Promise<ThreadAttentionSnapshot>
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
    revision = snapshot.revision
    setState({ snapshot, error: null, ownerMissing: false })
  }

  const read = (): Promise<void> => {
    if (stopped || api === null || active === 0) return Promise.resolve()
    if (inFlight !== null) return inFlight
    const now = Date.now()
    if (now - lastAttemptAt < MIN_REFRESH_GAP_MS) return Promise.resolve()
    lastAttemptAt = now
    const pending = api
      .state(undefined, {})
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

  const mutate = async (call: () => Promise<ThreadAttentionSnapshot>): Promise<void> => {
    adopt(await call())
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
    acknowledge: (sessionId, version) => mutate(() => requireApi().acknowledge({ sessionId, version })),
    clearUnread: (sessionId, version) => mutate(() => requireApi().clearUnread({ sessionId, version })),
    clearUnreadMany: entries => mutate(() => requireApi().clearUnreadMany({ entries: [...entries] })),
    markUnread: sessionId => mutate(() => requireApi().markUnread({ sessionId })),
    markUnreadMany: sessionIds => mutate(() => requireApi().markUnreadMany({ sessionIds: [...sessionIds] })),
    migrate: entries => mutate(() => requireApi().migrate({ entries: [...entries] })),
    reset: () => {
      listeners.clear()
      state = { snapshot: null, error: null, ownerMissing: false }
      api = null
      active = 0
      revision = 0
      lastAttemptAt = 0
      stopped = false
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
