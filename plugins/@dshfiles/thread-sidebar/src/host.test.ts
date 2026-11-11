import { DshxEffect } from '@dshfiles/dshx/effect'
import { Settings } from '@dshfiles/dshx/effect/settings'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Option, PubSub, Ref } from 'effect'
import { TestClock } from 'effect/testing'
import { ThreadAttention } from './attention-store.js'
import { INFLIGHT_FILE, InflightTurns } from './inflight-turns.js'
import { AutoResumeReport, Recoveries, bootRecovery, type AutoResumeOutcome } from './recoveries.js'
import { RECOVERY_FILE, RecoveryStore } from './restart-recovery.js'
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
  options: {
    readonly seed?: Effect.Effect<void, unknown, StateFiles>
    readonly boot?: boolean
    readonly resumeAfterRestart?: boolean
    readonly resumeAfterRestartMaxThreads?: number
  },
  body: (input: {
    readonly publish: (event: SessionEvent['event'], sessionId?: string) => Effect.Effect<void>
    readonly fake: FakeHost
    readonly reported: Ref.Ref<ReadonlyArray<AutoResumeOutcome>>
  }) => Effect.Effect<A, E, InflightTurns | RecoveryStore | ThreadAttention | Recoveries>,
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
      resumeAfterRestartMaxThreads: options.resumeAfterRestartMaxThreads ?? 5,
    })
    const reported = yield* Ref.make<ReadonlyArray<AutoResumeOutcome>>([])
    const consumers =
      options.boot === true
        ? Layer.mergeAll(attentionRecorder, inflightTracker, bootRecovery.pipe(Layer.provide(AutoResumeReport.layerTest(reported))))
        : Layer.mergeAll(attentionRecorder, inflightTracker)
    const layer = consumers.pipe(
      Layer.provideMerge(Layer.mergeAll(ThreadAttention.layer.pipe(Layer.provide(jsonStorageDomain(root))), InflightTurns.layer, Recoveries.layer)),
      Layer.provideMerge(RecoveryStore.layer),
      Layer.provideMerge(Layer.mergeAll(SessionEvents.layerTest(pubsub), fakeSidebarHost(fake), SidebarSettings.layer.pipe(Layer.provide(settings)))),
      Layer.provide(Layer.succeed(StateFiles, files)),
    )
    const publish = (event: SessionEvent['event'], sessionId = 'session-1') =>
      PubSub.publish(pubsub, { sessionId, origin: undefined, parentSessionId: undefined, event }).pipe(Effect.asVoid)
    return yield* body({ publish, fake, reported }).pipe(Effect.provide(layer))
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

  it('ships the automatic resume after a restart off', () => {
    expect(threadSidebarSettings.schema({}).resumeAfterRestart).toBe(false)
    expect(threadSidebarSettings.schema({}).resumeAfterRestartMaxThreads).toBe(5)
    expect(threadSidebarSettings.schema({}).resumeAfterRestartDelaySeconds).toBe(10)
  })

  it.effect('promotes the turns a crash left open as interrupted rows and never resumes them on its own', () =>
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
      ({ fake, reported }) =>
        Effect.gen(function* () {
          expect(yield* eventually(recoveryRows, rows => rows.length > 0)).toEqual([['crashed-thread', 'interrupted']])
          expect(yield* inflightIds).toEqual([])
          const outcomes = yield* eventually(Effect.andThen(TestClock.adjust('10 seconds'), Ref.get(reported)), sent => sent.length > 0)
          expect(outcomes[0]?.skipped).toEqual([{ sessionId: 'crashed-thread', reason: 'crash' }])
          expect(yield* Ref.get(fake.prompts)).toEqual([])
          expect(yield* recoveryRows).toEqual([['crashed-thread', 'interrupted']])
        }),
    ),
  )

  it.effect('resumes the threads a managed restart cut off once, newest first, within the limit, naming what was cut off', () =>
    withWiring({ boot: true, resumeAfterRestart: true, resumeAfterRestartMaxThreads: 2, seed: seedRestartRows }, ({ fake, reported, publish }) =>
      Effect.gen(function* () {
        // The user continued restart-c before the delay ran out: it is left alone.
        yield* publish(turnStart(1), 'restart-c')
        yield* TestClock.adjust('9 seconds')
        expect(yield* Ref.get(fake.prompts)).toEqual([])
        const outcomes = yield* eventually(Effect.andThen(TestClock.adjust('1 second'), Ref.get(reported)), sent => sent.length > 0)
        const prompts = yield* Ref.get(fake.prompts)
        expect(prompts.map(prompt => prompt.sessionId).toSorted()).toEqual(['restart-a', 'restart-d'])
        const waiting = prompts.find(prompt => prompt.sessionId === 'restart-d')?.text ?? ''
        expect(waiting).toMatch(/cut off by a managed DSH restart/)
        expect(waiting).toMatch(/never returned: background_jobs_wait/)
        expect(waiting).toMatch(/background command you were waiting on/)
        expect(waiting).toMatch(/sent automatically/)
        expect(outcomes[0]?.skipped.toSorted((left, right) => left.sessionId.localeCompare(right.sessionId))).toEqual([
          { sessionId: 'restart-b', reason: 'over-limit' },
          { sessionId: 'restart-c', reason: 'continued' },
        ])
        expect(outcomes[0]?.resumed).toContainEqual({ sessionId: 'restart-d', openTools: ['background_jobs_wait'] })
        expect(yield* Recoveries.use(recoveries => recoveries.lastAutoResume)).toEqual(Option.some(outcomes[0]))
        // Resumed rows leave Needs resume; the rest wait there for a person.
        expect((yield* recoveryRows).map(([sessionId]) => sessionId).toSorted()).toEqual(['restart-b', 'restart-c'])
        // Once: a second resume of the same row finds nothing to resume.
        expect(yield* Recoveries.use(recoveries => recoveries.resume('restart-a'))).toBe(false)
      }),
    ),
  )

  it.effect('records one automatic resume span with its counts', () => {
    const recorder = recordSpans()
    return withWiring({ boot: true, resumeAfterRestart: true, seed: seedRestartRows }, ({ reported }) =>
      Effect.gen(function* () {
        yield* eventually(Effect.andThen(TestClock.adjust('10 seconds'), Ref.get(reported)), sent => sent.length > 0)
        const spans = recorder.spans.filter(span => span.name === 'recoveries auto resume')
        expect(spans).toHaveLength(1)
        expect(spans[0]?.attributes).toMatchObject({ 'recoveries.auto.resumed': 4, 'recoveries.auto.skipped': 0 })
      }),
    ).pipe(Effect.provide(DshxEffect.tracerLayer), Effect.ensuring(Effect.sync(() => recorder[Symbol.dispose]())))
  })

  it.effect('does nothing after a restart when the automatic resume is off', () =>
    withWiring({ boot: true, seed: seedRestartRows }, ({ fake, reported }) =>
      Effect.gen(function* () {
        yield* TestClock.adjust('1 minute')
        yield* Effect.yieldNow
        expect(yield* Ref.get(fake.prompts)).toEqual([])
        expect(yield* Ref.get(reported)).toEqual([])
        expect(yield* recoveryRows).toHaveLength(4)
      }),
    ),
  )
})

const restartRow = (sessionId: string, interruptedAt: number, requestId: string, openTools?: ReadonlyArray<string>) => {
  const row = { sessionId, requestId, interruptedAt, reason: 'restart' }
  return openTools === undefined ? row : { ...row, openTools }
}

const seedRestartRows = StateFiles.use(files =>
  files.write({
    path: files.runtimePath(RECOVERY_FILE),
    text: `${JSON.stringify({
      version: 2,
      entries: [
        restartRow('restart-a', 3, '7b0f6a3e-1d1e-4a3c-9a55-0c4c3b0d5e01'),
        restartRow('restart-b', 1, '7b0f6a3e-1d1e-4a3c-9a55-0c4c3b0d5e02'),
        restartRow('restart-c', 4, '7b0f6a3e-1d1e-4a3c-9a55-0c4c3b0d5e03'),
        restartRow('restart-d', 2, '7b0f6a3e-1d1e-4a3c-9a55-0c4c3b0d5e04', ['background_jobs_wait']),
      ],
    })}\n`,
  }),
)
