import type { LandResult } from './api.js'

export interface DeferredIntegration {
  readonly path: string
  readonly sessionId: string | undefined
  readonly queuedAt: number
}

export type DeferredIntegrationSettlement = { readonly kind: 'result'; readonly result: LandResult } | { readonly kind: 'error'; readonly error: unknown }

export type DeferredIntegrationCancel = 'cancelled' | 'not-queued' | 'integrating'

/** One recorded queue or cancel transition, with the Session that asked for it. */
export interface DeferredIntegrationEvent {
  at: number
  kind: 'queued' | 'unqueued'
  sessionId?: string | undefined
}

/**
 * Integrations the user asked for while the thread was still busy. Each attempt runs the regular guarded rebase, so a
 * thread that is still writing or waiting on a question stays queued, and the rebase only starts once the Host itself
 * sees every Session idle. Cancelling is honored until the guard passed; after that the rebase is already moving.
 */
export const createDeferredIntegrations = (options: {
  readonly land: (input: { readonly entry: DeferredIntegration; readonly stillQueued: () => boolean }) => Promise<LandResult>
  /** Errors that mean "not yet" (thread busy, activity unknown) keep the entry queued instead of settling it. */
  readonly isWaitingError: (error: unknown) => boolean
  readonly onSettled: (entry: DeferredIntegration, settlement: DeferredIntegrationSettlement) => void
  readonly now?: () => number
}) => {
  const now = options.now ?? Date.now
  const entries = new Map<string, DeferredIntegration>()
  const passedGuard = new Set<string>()
  const events: { readonly path: string; readonly at: number; readonly kind: 'queued' | 'unqueued'; readonly sessionId: string | undefined }[] = []
  const record = (event: (typeof events)[number]): void => {
    events.push(event)
    if (events.length > 1_000) events.shift()
  }
  let draining: Promise<void> | undefined
  let drainAgain = false

  const attempt = async (entry: DeferredIntegration): Promise<void> => {
    const stillQueued = (): boolean => {
      const current = entries.get(entry.path) === entry
      if (current) passedGuard.add(entry.path)
      return current
    }
    try {
      const result = await options.land({ entry, stillQueued })
      if (entries.get(entry.path) !== entry) return
      entries.delete(entry.path)
      options.onSettled(entry, { kind: 'result', result })
    } catch (error) {
      if (entries.get(entry.path) !== entry) return
      if (!passedGuard.has(entry.path) && options.isWaitingError(error)) return
      entries.delete(entry.path)
      options.onSettled(entry, { kind: 'error', error })
    } finally {
      passedGuard.delete(entry.path)
    }
  }

  const drainOnce = async (): Promise<void> => {
    for (const entry of [...entries.values()]) await attempt(entry)
  }

  /** Single-flight: a wake-up that arrives mid-drain runs one more pass instead of a parallel one. */
  const drain = (): Promise<void> => {
    if (draining !== undefined) {
      drainAgain = true
      return draining
    }
    const run = async (): Promise<void> => {
      do {
        drainAgain = false
        await drainOnce()
      } while (drainAgain && entries.size > 0)
    }
    const current = run().finally(() => {
      if (draining === current) draining = undefined
    })
    draining = current
    return current
  }

  const queue = (input: { readonly path: string; readonly sessionId: string | undefined }): DeferredIntegration => {
    const existing = entries.get(input.path)
    if (existing !== undefined) return existing
    const entry: DeferredIntegration = { path: input.path, sessionId: input.sessionId, queuedAt: now() }
    entries.set(input.path, entry)
    record({ path: input.path, at: entry.queuedAt, kind: 'queued', sessionId: input.sessionId })
    return entry
  }

  const cancel = (path: string): DeferredIntegrationCancel => {
    if (passedGuard.has(path)) return 'integrating'
    const entry = entries.get(path)
    if (entry === undefined) return 'not-queued'
    entries.delete(path)
    record({ path, at: now(), kind: 'unqueued', sessionId: entry.sessionId })
    return 'cancelled'
  }

  return {
    queue,
    cancel,
    drain,
    get: (path: string): DeferredIntegration | undefined => entries.get(path),
    paths: (): readonly string[] => [...entries.keys()],
    history: (path: string): readonly DeferredIntegrationEvent[] =>
      events
        .filter(event => event.path === path)
        .map(event => {
          const visible: DeferredIntegrationEvent = { at: event.at, kind: event.kind }
          if (event.sessionId !== undefined) visible.sessionId = event.sessionId
          return visible
        }),
    clear: (): void => {
      entries.clear()
      events.length = 0
    },
  }
}
