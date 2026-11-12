import type {} from '@deepseek-ai/dsh-tools'
import { Api, DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { VcsProviderService } from '@dshfiles/vcs-provider-port/effect'
import { Deferred, Effect, Layer, Option, Queue, Ref, Schema } from 'effect'
import { sessionUndoApi } from './api.js'
import { sessionUndoSettings, type SessionUndoSettings } from './settings.js'
import { undoSessionsLayer } from './host-edge-promise.js'
import { UndoHistory } from './undo-history.js'
import { PACKAGE_ID, SessionUndo, UndoFiles } from './undo-service.js'

const UndoSettings = Settings.Tag<SessionUndoSettings>(sessionUndoSettings.namespace)

/** Only a message the user wrote names a turn; DSH also appends runtime-context and time messages as user turns. */
const userWritten = Schema.Struct({ source: Schema.Struct({ kind: Schema.Literal('user') }) })

type Observed =
  | { readonly _tag: 'turn-start'; readonly sessionId: string; readonly seq: number; readonly turn: number; readonly cwd: string | undefined }
  | { readonly _tag: 'turn-end'; readonly sessionId: string; readonly seq: number; readonly turn: number }
  | { readonly _tag: 'prompt'; readonly sessionId: string; readonly seq: number; readonly text: string }
  | { readonly _tag: 'other'; readonly sessionId: string; readonly seq: number }
  | { readonly _tag: 'barrier'; readonly done: Deferred.Deferred<void> }

/**
 * Session events reach one consumer fiber in emission order, so checkpoint bookkeeping (the last sequence before a
 * turn, the turn a prompt belongs to) stays ordered. A tool call first queues a barrier: once the consumer passes it,
 * its turn's checkpoint is registered and `whenReady` holds the call until the snapshot is stored.
 */
const SessionHooks = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* HostContext
    const undo = yield* SessionUndo
    const settings = yield* UndoSettings
    const observed = yield* Queue.unbounded<Observed>()
    const lastSeq = yield* Ref.make<ReadonlyMap<string, number>>(new Map())
    const turns = yield* Ref.make<ReadonlyMap<string, number>>(new Map())

    const handle = Effect.fnUntraced(function* (event: Observed) {
      if (event._tag === 'barrier') return yield* Deferred.succeed(event.done, undefined)
      if (event._tag === 'turn-end') {
        yield* undo.turnEnded(event.sessionId)
        if ((yield* settings.get).turnRevisions) yield* undo.turnFinished({ sessionId: event.sessionId, turn: event.turn })
      }
      if (event._tag === 'turn-start') {
        yield* undo.turnRunning(event.sessionId)
        yield* Ref.update(turns, current => new Map(current).set(event.sessionId, event.turn))
        const forkAtSeq = (yield* Ref.get(lastSeq)).get(event.sessionId) ?? event.seq - 1
        if (event.cwd !== undefined) yield* undo.turnStarted({ sessionId: event.sessionId, turn: event.turn, forkAtSeq, cwd: event.cwd })
      }
      if (event._tag === 'prompt') {
        const turn = (yield* Ref.get(turns)).get(event.sessionId)
        if (turn !== undefined && event.text !== '')
          yield* undo
            .promptEntered({ sessionId: event.sessionId, turn, text: event.text })
            .pipe(Effect.catchTag('UndoHistoryUnavailable', error => Effect.logWarning('session-undo: the turn prompt was not stored', error)))
      }
      yield* Ref.update(lastSeq, current => new Map(current).set(event.sessionId, event.seq))
    })
    yield* DshxPlugin.worker(Queue.take(observed).pipe(Effect.flatMap(handle), Effect.forever))

    const whenReady = yield* DshxPlugin.callback((sessionId: string) =>
      Effect.gen(function* () {
        const done = yield* Deferred.make<void>()
        yield* Queue.offer(observed, { _tag: 'barrier', done })
        yield* Deferred.await(done)
        yield* undo.whenReady(sessionId)
      }),
    )

    yield* Effect.acquireRelease(
      Effect.sync(() => [
        host.ctx.on('session/event', (session, event) => {
          const sessionId = String(session.header.id)
          if (event.type === 'turn/start') {
            Queue.offerUnsafe(observed, { _tag: 'turn-start', sessionId, seq: event.seq, turn: event.data.turn, cwd: session.header.cwd })
            return
          }
          if (event.type === 'turn/end') {
            Queue.offerUnsafe(observed, { _tag: 'turn-end', sessionId, seq: event.seq, turn: event.data.turn })
            return
          }
          if (event.type === 'user/message' && Option.isSome(Schema.decodeUnknownOption(userWritten)(event.data))) {
            Queue.offerUnsafe(observed, { _tag: 'prompt', sessionId, seq: event.seq, text: UndoHistory.promptOf(event.data.content) })
            return
          }
          Queue.offerUnsafe(observed, { _tag: 'other', sessionId, seq: event.seq })
        }),
        // A turn's snapshot must finish before its first tool call can change a file.
        host.ctx.on('tools/pre-execute', async (execution, next) => {
          const agentId = execution.agent?.id
          if (agentId !== undefined) await whenReady(String(agentId)).catch(() => undefined)
          return next()
        }),
      ]),
      disposers =>
        Effect.sync(() => {
          for (const dispose of disposers.reverse()) dispose()
        }),
    )
  }),
)

/** Tell browsers which thread's history changed, so its controls read it again instead of polling. */
const HistoryEvents = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* HostContext
    const changed = yield* Queue.unbounded<string>()
    yield* Effect.acquireRelease(
      Effect.sync(() =>
        host.ctx.on('domain/changed', change => {
          if (change.domain === UndoHistory.domain.name) Queue.offerUnsafe(changed, change.key)
        }),
      ),
      dispose => Effect.sync(dispose),
    )
    yield* DshxPlugin.worker(
      Queue.take(changed).pipe(
        Effect.flatMap(sessionId =>
          Api.publish({ contract: sessionUndoApi, event: 'historyChanged', payload: { sessionId } }).pipe(
            Effect.catchTag('PublishEventError', error => Effect.logWarning('session-undo: history change event refused', error.message)),
          ),
        ),
        Effect.forever,
      ),
    )
  }),
)

const sessionUndoLayer = Layer.mergeAll(SessionHooks, HistoryEvents).pipe(
  Layer.provideMerge(SessionUndo.layer),
  Layer.provide(Layer.mergeAll(UndoFiles.layer, undoSessionsLayer, StorageDomain.layer)),
  Layer.provide(VcsProviderService.layer),
  Layer.provideMerge(HostApis.layer),
  Layer.provide(Settings.layer(sessionUndoSettings)),
)

export default DshxPlugin.make({
  name: PACKAGE_ID,
  inject: ['storageDomain', 'tools'],
  settings: [sessionUndoSettings],
  layer: sessionUndoLayer,
  apis: [
    Api.bind(sessionUndoApi, {
      history: input => SessionUndo.use(undo => undo.history(input.sessionId)),
      undo: input => SessionUndo.use(undo => undo.undo(input.sessionId, { allowSharedDirectory: input.allowSharedDirectory })),
      rewind: input => SessionUndo.use(undo => undo.undo(input.sessionId, { turn: input.turn, allowSharedDirectory: input.allowSharedDirectory })),
      redo: input => SessionUndo.use(undo => undo.redo(input.sessionId, { allowSharedDirectory: input.allowSharedDirectory })),
    }),
  ],
})
