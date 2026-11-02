import { Clock, Context, Effect, Layer, Queue, Ref, Stream } from 'effect'

export interface QueuedIntegration {
  readonly path: string
  readonly sessionId: string | undefined
  readonly queuedAt: number
}

export type QueuedIntegrationCancel = 'cancelled' | 'not-queued' | 'integrating'

/** One recorded queue or cancel transition, with the Session that asked for it. */
export interface QueuedIntegrationEvent {
  at: number
  kind: 'queued' | 'unqueued'
  sessionId?: string | undefined
}

export type IntegrationProgressPhase = 'queued' | 'validating' | 'rebasing'
export interface IntegrationProgress {
  readonly phase: IntegrationProgressPhase
  readonly updatedAt: number
}

const MAX_EVENTS = 1_000
const INTEGRATION_PROGRESS_TTL_MS = 10 * 60_000
const MAX_INTEGRATION_PROGRESS_ENTRIES = 256

interface RecordedEvent {
  readonly path: string
  readonly at: number
  readonly kind: 'queued' | 'unqueued'
  readonly sessionId: string | undefined
}

interface RequestsState {
  readonly entries: ReadonlyMap<string, QueuedIntegration>
  /** Paths whose current attempt passed its guard: a cancel now answers `integrating`. */
  readonly passedGuard: ReadonlySet<string>
  readonly events: readonly RecordedEvent[]
}

const withEvent = (events: readonly RecordedEvent[], event: RecordedEvent): readonly RecordedEvent[] => [...events, event].slice(-MAX_EVENTS)

const freshProgress = (progress: ReadonlyMap<string, IntegrationProgress>, now: number): Map<string, IntegrationProgress> =>
  new Map([...progress].filter(([, entry]) => now - entry.updatedAt <= INTEGRATION_PROGRESS_TTL_MS))

/**
 * Integrations the user asked for while the thread was still busy, and the phase of every integration in flight. Each
 * attempt runs the regular guarded rebase, so a thread that is still writing or waiting on a question stays queued;
 * cancelling is honoured until the guard passed, after that the rebase is already moving.
 */
export class IntegrationRequests extends Context.Service<
  IntegrationRequests,
  {
    readonly queue: (input: { readonly path: string; readonly sessionId: string | undefined }) => Effect.Effect<QueuedIntegration>
    readonly cancel: (path: string) => Effect.Effect<QueuedIntegrationCancel>
    readonly get: (path: string) => Effect.Effect<QueuedIntegration | undefined>
    readonly entries: Effect.Effect<readonly QueuedIntegration[]>
    readonly history: (path: string) => Effect.Effect<readonly QueuedIntegrationEvent[]>
    /** The attempt's last chance to be cancelled: true while `entry` is still the queued one, and from then on `integrating`. */
    readonly passGuard: (entry: QueuedIntegration) => Effect.Effect<boolean>
    readonly hasPassedGuard: (path: string) => Effect.Effect<boolean>
    readonly isCurrent: (entry: QueuedIntegration) => Effect.Effect<boolean>
    /** Drop `entry` once its attempt settled, unless it was cancelled or replaced meanwhile. */
    readonly settle: (entry: QueuedIntegration) => Effect.Effect<boolean>
    readonly endAttempt: (path: string) => Effect.Effect<void>
    readonly recordProgress: (input: { readonly path: string; readonly phase: IntegrationProgressPhase }) => Effect.Effect<void>
    readonly progress: (path: string) => Effect.Effect<IntegrationProgress | null>
    /** One element whenever a new integration is queued, so the retry worker tries it at once. */
    readonly queued: Stream.Stream<void>
  }
>()('@dshfiles/jj-integration/IntegrationRequests') {
  static readonly layer = Layer.effect(
    IntegrationRequests,
    Effect.gen(function* () {
      const state = yield* Ref.make<RequestsState>({ entries: new Map(), passedGuard: new Set(), events: [] })
      const progressByPath = yield* Ref.make<ReadonlyMap<string, IntegrationProgress>>(new Map())
      const queuedSignals = yield* Queue.sliding<void>(1)

      const queue = Effect.fn('integration requests queue')(function* (input: { readonly path: string; readonly sessionId: string | undefined }) {
        const now = yield* Clock.currentTimeMillis
        const entry = yield* Ref.modify(state, (current): readonly [QueuedIntegration, RequestsState] => {
          const existing = current.entries.get(input.path)
          if (existing !== undefined) return [existing, current]
          const entry: QueuedIntegration = { path: input.path, sessionId: input.sessionId, queuedAt: now }
          return [
            entry,
            {
              ...current,
              entries: new Map([...current.entries, [input.path, entry]]),
              events: withEvent(current.events, { path: input.path, at: now, kind: 'queued', sessionId: input.sessionId }),
            },
          ]
        })
        yield* Queue.offer(queuedSignals, undefined)
        return entry
      })

      const cancel = Effect.fn('integration requests cancel')(function* (path: string) {
        const now = yield* Clock.currentTimeMillis
        return yield* Ref.modify(state, (current): readonly [QueuedIntegrationCancel, RequestsState] => {
          if (current.passedGuard.has(path)) return ['integrating', current]
          const entry = current.entries.get(path)
          if (entry === undefined) return ['not-queued', current]
          const entries = new Map(current.entries)
          entries.delete(path)
          return ['cancelled', { ...current, entries, events: withEvent(current.events, { path, at: now, kind: 'unqueued', sessionId: entry.sessionId }) }]
        })
      })

      const isCurrent = (entry: QueuedIntegration) => Effect.map(Ref.get(state), current => current.entries.get(entry.path) === entry)

      return IntegrationRequests.of({
        queued: Stream.fromQueue(queuedSignals),
        queue,
        cancel,
        get: path => Effect.map(Ref.get(state), current => current.entries.get(path)),
        entries: Effect.map(Ref.get(state), current => [...current.entries.values()]),
        history: path =>
          Effect.map(Ref.get(state), current =>
            current.events
              .filter(event => event.path === path)
              .map(event => {
                const visible: QueuedIntegrationEvent = { at: event.at, kind: event.kind }
                if (event.sessionId !== undefined) visible.sessionId = event.sessionId
                return visible
              }),
          ),
        passGuard: entry =>
          Ref.modify(state, (current): readonly [boolean, RequestsState] => {
            if (current.entries.get(entry.path) !== entry) return [false, current]
            return [true, { ...current, passedGuard: new Set([...current.passedGuard, entry.path]) }]
          }),
        hasPassedGuard: path => Effect.map(Ref.get(state), current => current.passedGuard.has(path)),
        isCurrent,
        settle: entry =>
          Ref.modify(state, (current): readonly [boolean, RequestsState] => {
            if (current.entries.get(entry.path) !== entry) return [false, current]
            const entries = new Map(current.entries)
            entries.delete(entry.path)
            return [true, { ...current, entries }]
          }),
        endAttempt: path =>
          Ref.update(state, current => ({ ...current, passedGuard: new Set([...current.passedGuard].filter(candidate => candidate !== path)) })),
        recordProgress: input =>
          Effect.flatMap(Clock.currentTimeMillis, now =>
            Ref.update(progressByPath, current => {
              const next = freshProgress(current, now)
              next.delete(input.path)
              next.set(input.path, { phase: input.phase, updatedAt: now })
              return new Map([...next].slice(-MAX_INTEGRATION_PROGRESS_ENTRIES))
            }),
          ),
        progress: path =>
          Effect.flatMap(Clock.currentTimeMillis, now =>
            Ref.modify(progressByPath, (current): readonly [IntegrationProgress | null, ReadonlyMap<string, IntegrationProgress>] => {
              const next = freshProgress(current, now)
              return [next.get(path) ?? null, next]
            }),
          ),
      })
    }),
  )
}

/** Session ids that isolated their working directory into a thread workspace, with that workspace. */
export class IsolatedSessions extends Context.Service<
  IsolatedSessions,
  {
    readonly get: (sessionId: string) => Effect.Effect<{ readonly name: string; readonly path: string } | undefined>
    readonly set: (input: { readonly sessionId: string; readonly name: string; readonly path: string }) => Effect.Effect<void>
    readonly sessionIdsAt: (path: string) => Effect.Effect<readonly string[]>
    readonly forget: (path: string) => Effect.Effect<void>
  }
>()('@dshfiles/jj-integration/IsolatedSessions') {
  static readonly layer = Layer.effect(
    IsolatedSessions,
    Effect.gen(function* () {
      const workspaces = yield* Ref.make<ReadonlyMap<string, { readonly name: string; readonly path: string }>>(new Map())
      return IsolatedSessions.of({
        get: sessionId => Effect.map(Ref.get(workspaces), current => current.get(sessionId)),
        set: input => Ref.update(workspaces, current => new Map([...current, [input.sessionId, { name: input.name, path: input.path }]])),
        sessionIdsAt: path =>
          Effect.map(Ref.get(workspaces), current => [...current].flatMap(([sessionId, workspace]) => (workspace.path === path ? [sessionId] : []))),
        forget: path => Ref.update(workspaces, current => new Map([...current].filter(([, workspace]) => workspace.path !== path))),
      })
    }),
  )
}
