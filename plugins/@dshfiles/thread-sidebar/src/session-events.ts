import { DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { Context, Effect, Layer, PubSub, type Scope, Stream } from 'effect'
import { ThreadAttention, ThreadAttentionStoreModel } from './attention-store.js'
import { InflightTurns, turnBoundaryFromEvent } from './inflight-turns.js'
import { RecoveryStore } from './restart-recovery.js'
import { InflightMarkerWriteFailed } from './sidebar-errors.js'

export interface SessionEvent {
  readonly sessionId: string
  readonly event: { readonly type: string; readonly seq: number; readonly time: number }
}

/**
 * Every committed Session event of this Host, from one `session/event` listener, in emission order. Each consumer
 * subscribes while its layer builds, so none misses an event the Host emits after activation.
 */
export class SessionEvents extends Context.Service<SessionEvents, { readonly subscribe: Effect.Effect<Stream.Stream<SessionEvent>, never, Scope.Scope> }>()(
  '@dshfiles/thread-sidebar/SessionEvents',
) {
  static readonly layer = Layer.effect(
    SessionEvents,
    Effect.gen(function* () {
      const host = yield* HostContext
      const pubsub = yield* Effect.acquireRelease(PubSub.unbounded<SessionEvent>(), PubSub.shutdown)
      yield* Effect.acquireRelease(
        Effect.sync(() =>
          host.ctx.on('session/event', (session, event) => {
            PubSub.publishUnsafe(pubsub, { sessionId: String(session.id), event })
          }),
        ),
        dispose => Effect.sync(dispose),
      )
      return SessionEvents.of({ subscribe: Effect.map(PubSub.subscribe(pubsub), Stream.fromSubscription) })
    }),
  )

  /** Events published by hand, for tests that drive the consumers without a Host. */
  static readonly layerTest = (pubsub: PubSub.PubSub<SessionEvent>) =>
    Layer.succeed(SessionEvents, SessionEvents.of({ subscribe: Effect.map(PubSub.subscribe(pubsub), Stream.fromSubscription) }))
}

/**
 * One durable attention record per Session, written where the turn actually ends, so every browser, plugin and CLI
 * reads the same unacknowledged-thread state instead of each tab guessing from its own memory.
 */
export const attentionRecorder = Layer.effectDiscard(
  Effect.gen(function* () {
    const attention = yield* ThreadAttention
    const events = yield* (yield* SessionEvents).subscribe
    yield* DshxPlugin.worker(
      Stream.runForEach(events, ({ sessionId, event }) => {
        const reason = ThreadAttentionStoreModel.finishReasonFromEvent(event)
        if (reason === null) return Effect.void
        return attention
          .recordFinish({ sessionId, seq: event.seq, time: event.time, reason })
          .pipe(Effect.catch(error => Effect.logWarning('thread-sidebar: a finished turn was not recorded as unread', error)))
      }),
    )
  }),
)

/**
 * The turn markers a crash would leave behind. A turn this Host's own shutdown cut off keeps its marker: the next
 * process promotes it into a resume row, which a write racing the five-second shutdown could not guarantee.
 */
export const inflightTracker = Layer.effectDiscard(
  Effect.gen(function* () {
    const inflight = yield* InflightTurns
    const recovery = yield* RecoveryStore
    const events = yield* (yield* SessionEvents).subscribe
    const track = Effect.fnUntraced(function* ({ sessionId, event }: SessionEvent) {
      const boundary = turnBoundaryFromEvent(event)
      if (boundary === null || boundary === 'shutdown') return
      if (boundary === 'start') {
        return yield* inflight.start(sessionId).pipe(Effect.mapError(cause => new InflightMarkerWriteFailed({ sessionId, boundary: 'start', cause })))
      }
      const wasOpen = yield* inflight.end(sessionId).pipe(Effect.mapError(cause => new InflightMarkerWriteFailed({ sessionId, boundary: 'end', cause })))
      // Crash recovery appends an `interrupted` turn end the moment the thread is next loaded, which can land before
      // this process promotes the markers it inherited; the marker taken here still becomes a resume row.
      if (wasOpen && boundary === 'interrupted') yield* recovery.record({ sessionIds: [sessionId], reason: 'interrupted' })
    })
    yield* DshxPlugin.worker(
      Stream.runForEach(events, event => track(event).pipe(Effect.catch(error => Effect.logWarning('thread-sidebar: in-flight turn tracking failed', error)))),
    )
  }),
)
