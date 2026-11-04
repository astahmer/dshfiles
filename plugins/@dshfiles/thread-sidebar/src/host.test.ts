import { Settings } from '@dshfiles/dshx/effect/settings'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, PubSub, Ref } from 'effect'
import { TestClock } from 'effect/testing'
import { ThreadAttention } from './attention-store.js'
import { INFLIGHT_FILE, InflightTurns } from './inflight-turns.js'
import { Recoveries, bootRecovery } from './recoveries.js'
import { RecoveryStore } from './restart-recovery.js'
import { StateFiles } from './runtime-files.js'
import { SessionEvents, attentionRecorder, inflightTracker, type SessionEvent } from './session-events.js'
import { threadSidebarSettings } from './settings.js'
import { fakeSidebarHost, makeFakeHost, type FakeHost } from './sidebar-host.test-support.js'
import { SidebarSettings, type SidebarSettingsValue } from './sidebar-settings.js'
import { temporaryStateFiles } from './state-files.test-support.js'
import { jsonStorageDomain } from './storage.test-support.js'

/**
 * The Host half's event wiring over real layers: committed `turn/end` events become durable attention rows, turn
 * boundaries keep the in-flight markers a crash could leave, and boot promotes a previous process's markers.
 */
const withWiring = <A, E>(
  options: { readonly seed?: Effect.Effect<void, unknown, StateFiles>; readonly boot?: boolean; readonly resumeAfterRestart?: boolean },
  body: (input: {
    readonly publish: (event: SessionEvent['event']) => Effect.Effect<void>
    readonly fake: FakeHost
  }) => Effect.Effect<A, E, InflightTurns | RecoveryStore | ThreadAttention>,
) =>
  Effect.gen(function* () {
    const root = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped({ prefix: 'thread-sidebar-host-' })
    if (options.seed !== undefined) yield* options.seed
    const pubsub = yield* PubSub.unbounded<SessionEvent>()
    const fake = yield* makeFakeHost
    const files = yield* StateFiles
    const settings = Settings.layerTest<SidebarSettingsValue>('thread-sidebar', {
      ...threadSidebarSettings.schema({}),
      resumeAfterRestart: options.resumeAfterRestart ?? false,
    })
    const consumers =
      options.boot === true ? Layer.mergeAll(attentionRecorder, inflightTracker, bootRecovery) : Layer.mergeAll(attentionRecorder, inflightTracker)
    const layer = consumers.pipe(
      Layer.provideMerge(Layer.mergeAll(ThreadAttention.layer.pipe(Layer.provide(jsonStorageDomain(root))), InflightTurns.layer, Recoveries.layer)),
      Layer.provideMerge(RecoveryStore.layer),
      Layer.provideMerge(Layer.mergeAll(SessionEvents.layerTest(pubsub), fakeSidebarHost(fake), SidebarSettings.layer.pipe(Layer.provide(settings)))),
      Layer.provide(Layer.succeed(StateFiles, files)),
    )
    const publish = (event: SessionEvent['event']) => PubSub.publish(pubsub, { sessionId: 'session-1', event }).pipe(Effect.asVoid)
    return yield* body({ publish, fake }).pipe(Effect.provide(layer))
  }).pipe(Effect.provide(temporaryStateFiles))

/** Consumers run on their own fibers and write files on the event loop: yield until `read` satisfies `done`. */
const eventually = <A, E, R>(read: Effect.Effect<A, E, R>, done: (value: A) => boolean) =>
  read.pipe(Effect.tap(Effect.yieldNow), Effect.repeat({ until: done, times: 500 }))

const turnStart = (seq: number) => ({ type: 'turn/start', seq, time: seq, data: { turn: 1 } })
const turnEnd = (kind: string, reason?: { readonly kind: string }) => ({
  type: 'turn/end',
  seq: 16,
  time: 1_700_000_000_000,
  data: { turn: 1, reason: reason === undefined ? { kind } : { kind, reason } },
})

const inflightIds = InflightTurns.use(inflight => Effect.map(inflight.list, entries => entries.map(entry => entry.sessionId)))
const recoveryRows = RecoveryStore.use(store => Effect.map(store.list, entries => entries.map(entry => [entry.sessionId, entry.reason])))
const attentionRows = ThreadAttention.use(attention => Effect.map(attention.snapshot, snapshot => snapshot.sessions))

describe('thread-sidebar Host event wiring', () => {
  it.effect('stores a finished turn and ignores turn ends that ask for nothing', () =>
    withWiring({}, ({ publish }) =>
      Effect.gen(function* () {
        yield* publish(turnStart(4))
        yield* publish(turnEnd('forked'))
        yield* publish(turnEnd('interrupted'))
        yield* publish(turnEnd('error'))
        const rows = yield* eventually(attentionRows, sessions => sessions.length > 0)
        expect(rows).toEqual([
          expect.objectContaining({ sessionId: 'session-1', finishedReason: 'error', finishedSeq: 16, finishedAt: 1_700_000_000_000, manuallyUnread: false }),
        ])
      }),
    ),
  )

  it.effect('records an open turn and clears it when the turn ends', () =>
    withWiring({}, ({ publish }) =>
      Effect.gen(function* () {
        yield* publish(turnStart(4))
        expect(yield* eventually(inflightIds, ids => ids.length > 0)).toEqual(['session-1'])
        yield* publish(turnEnd('completed'))
        expect(yield* eventually(inflightIds, ids => ids.length === 0)).toEqual([])
        expect(yield* recoveryRows).toEqual([])
      }),
    ),
  )

  it.effect('keeps a resume row when crash recovery closes the turn before the boot promotion reads it', () =>
    withWiring({}, ({ publish }) =>
      Effect.gen(function* () {
        yield* publish(turnStart(4))
        yield* eventually(inflightIds, ids => ids.length > 0)
        yield* publish(turnEnd('interrupted'))
        expect(yield* eventually(recoveryRows, rows => rows.length > 0)).toEqual([['session-1', 'interrupted']])
        expect(yield* inflightIds).toEqual([])
      }),
    ),
  )

  it.effect('keeps the marker of a turn its own shutdown cut off, so the next process can resume it', () =>
    withWiring({}, ({ publish }) =>
      Effect.gen(function* () {
        yield* publish(turnStart(4))
        yield* eventually(inflightIds, ids => ids.length > 0)
        yield* publish(turnEnd('aborted', { kind: 'disposed' }))
        // The next boundary is handled after the shutdown one: once it is seen, the shutdown left the marker alone.
        yield* publish(turnStart(6))
        yield* publish(turnEnd('aborted', { kind: 'user' }))
        expect(yield* eventually(inflightIds, ids => ids.length === 0)).toEqual([])
        expect(yield* recoveryRows).toEqual([])
      }),
    ),
  )

  it.effect('promotes the turns a previous process left open as interrupted recoveries, then resumes them', () =>
    withWiring(
      {
        boot: true,
        resumeAfterRestart: true,
        seed: StateFiles.use(files =>
          files.write({
            path: files.runtimePath(INFLIGHT_FILE),
            text: `${JSON.stringify({ version: 1, entries: [{ sessionId: 'crashed-thread', startedAt: 1 }] })}\n`,
          }),
        ),
      },
      ({ fake }) =>
        Effect.gen(function* () {
          expect(yield* eventually(recoveryRows, rows => rows.length > 0)).toEqual([['crashed-thread', 'interrupted']])
          expect(yield* inflightIds).toEqual([])
          expect(yield* Ref.get(fake.prompts)).toEqual([])
          const prompts = yield* eventually(Effect.andThen(TestClock.adjust('10 seconds'), Ref.get(fake.prompts)), sent => sent.length > 0)
          expect(prompts.map(prompt => prompt.sessionId)).toEqual(['crashed-thread'])
          expect(yield* eventually(recoveryRows, rows => rows.length === 0)).toEqual([])
        }),
    ),
  )
})
