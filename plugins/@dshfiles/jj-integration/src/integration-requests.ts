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

/**
 * One path's integration lifecycle: waiting for its queue slot, an attempt in flight after its guard passed, or the
 * tail of an attempt that holds no queue entry. A cancel answers `integrating` only while an attempt in flight still
 * owns a queue entry, so a new queued request is never mistaken for an attempt that already ended.
 */
export type IntegrationRequestState =
  | { readonly _tag: 'queued'; readonly entry: QueuedIntegration; readonly progress: IntegrationProgress }
  | { readonly _tag: 'integrating'; readonly entry: QueuedIntegration; readonly progress: IntegrationProgress }
  | { readonly _tag: 'running'; readonly progress: IntegrationProgress }

interface RequestsState {
  readonly paths: ReadonlyMap<string, IntegrationRequestState>
  readonly events: readonly RecordedEvent[]
}

const withEvent = (events: readonly RecordedEvent[], event: RecordedEvent): readonly RecordedEvent[] => [...events, event].slice(-MAX_EVENTS)

const withProgress = (state: IntegrationRequestState, progress: IntegrationProgress): IntegrationRequestState => {
  if (state._tag === 'running') return { _tag: 'running', progress }
  if (state._tag === 'integrating') return { _tag: 'integrating', entry: state.entry, progress }
  return { _tag: 'queued', entry: state.entry, progress }
}

const withoutEntry = (state: IntegrationRequestState): IntegrationRequestState => ({ _tag: 'running', progress: state.progress })

/** A progress phase older than the TTL is forgotten, and only the paths that hold no queue entry are bounded. */
const prunedProgress = (paths: ReadonlyMap<string, IntegrationRequestState>, now: number): ReadonlyMap<string, IntegrationRequestState> => {
  const fresh = new Map<string, IntegrationRequestState>()
  for (const [key, state] of paths) {
    if (state._tag !== 'running' || now - state.progress.updatedAt <= INTEGRATION_PROGRESS_TTL_MS) fresh.set(key, state)
  }
  const runningKeys = [...fresh].flatMap(([key, state]) => (state._tag === 'running' ? [key] : []))
  for (const key of runningKeys.slice(0, Math.max(0, runningKeys.length - MAX_INTEGRATION_PROGRESS_ENTRIES))) fresh.delete(key)
  return fresh
}

const entryOf = (state: IntegrationRequestState | undefined): QueuedIntegration | undefined =>
  state === undefined || state._tag === 'running' ? undefined : state.entry

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
    /** An attempt that ended without settling returns its entry to the queue, so a later attempt can retry or cancel it. */
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
      const state = yield* Ref.make<RequestsState>({ paths: new Map(), events: [] })
      const queuedSignals = yield* Queue.sliding<void>(1)

      const queue = Effect.fn('integration requests queue')(function* (input: { readonly path: string; readonly sessionId: string | undefined }) {
        const now = yield* Clock.currentTimeMillis
        const entry = yield* Ref.modify(state, (current): readonly [QueuedIntegration, RequestsState] => {
          const existing = current.paths.get(input.path)
          if (existing !== undefined && existing._tag !== 'running') return [existing.entry, current]
          const entry: QueuedIntegration = { path: input.path, sessionId: input.sessionId, queuedAt: now }
          const progress = existing?.progress ?? { phase: 'queued', updatedAt: now }
          return [
            entry,
            {
              ...current,
              paths: new Map([...current.paths, [input.path, { _tag: 'queued', entry, progress }]]),
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
          const existing = current.paths.get(path)
          if (existing === undefined || existing._tag === 'running') return ['not-queued', current]
          if (existing._tag === 'integrating') return ['integrating', current]
          return [
            'cancelled',
            {
              ...current,
              paths: new Map([...current.paths, [path, withoutEntry(existing)]]),
              events: withEvent(current.events, { path, at: now, kind: 'unqueued', sessionId: existing.entry.sessionId }),
            },
          ]
        })
      })

      return IntegrationRequests.of({
        queued: Stream.fromQueue(queuedSignals),
        queue,
        cancel,
        get: path => Effect.map(Ref.get(state), current => entryOf(current.paths.get(path))),
        entries: Effect.map(Ref.get(state), current => [...current.paths.values()].flatMap(current => (current._tag === 'running' ? [] : [current.entry]))),
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
            const existing = current.paths.get(entry.path)
            if (existing === undefined || existing._tag !== 'queued' || existing.entry !== entry) return [false, current]
            return [true, { ...current, paths: new Map([...current.paths, [entry.path, { _tag: 'integrating', entry, progress: existing.progress }]]) }]
          }),
        hasPassedGuard: path => Effect.map(Ref.get(state), current => current.paths.get(path)?._tag === 'integrating'),
        isCurrent: entry =>
          Effect.map(Ref.get(state), current => {
            const existing = current.paths.get(entry.path)
            return existing !== undefined && existing._tag !== 'running' && existing.entry === entry
          }),
        settle: entry =>
          Ref.modify(state, (current): readonly [boolean, RequestsState] => {
            const existing = current.paths.get(entry.path)
            if (existing === undefined || existing._tag === 'running' || existing.entry !== entry) return [false, current]
            return [true, { ...current, paths: new Map([...current.paths, [entry.path, withoutEntry(existing)]]) }]
          }),
        endAttempt: path =>
          Ref.update(state, current => {
            const existing = current.paths.get(path)
            if (existing === undefined || existing._tag !== 'integrating') return current
            return {
              ...current,
              paths: new Map([...current.paths, [path, { _tag: 'queued', entry: existing.entry, progress: existing.progress }]]),
            }
          }),
        recordProgress: input =>
          Effect.flatMap(Clock.currentTimeMillis, now =>
            Ref.update(state, current => {
              const existing = current.paths.get(input.path)
              const progress: IntegrationProgress = { phase: input.phase, updatedAt: now }
              const paths =
                existing === undefined
                  ? new Map([...current.paths, [input.path, { _tag: 'running', progress }]] as const)
                  : new Map([...current.paths, [input.path, withProgress(existing, progress)]])
              return { ...current, paths: prunedProgress(paths, now) }
            }),
          ),
        progress: path =>
          Effect.flatMap(Clock.currentTimeMillis, now =>
            Ref.modify(state, (current): readonly [IntegrationProgress | null, RequestsState] => {
              const paths = prunedProgress(current.paths, now)
              const progress = paths.get(path)?.progress
              return [
                progress === undefined || now - progress.updatedAt > INTEGRATION_PROGRESS_TTL_MS ? null : progress,
                paths === current.paths ? current : { ...current, paths },
              ]
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
