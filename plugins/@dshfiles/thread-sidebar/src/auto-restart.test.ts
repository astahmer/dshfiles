import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Path, PubSub, Ref } from 'effect'
import { TestClock } from 'effect/testing'
import { AutoRestart, type AutoRestartPolicy } from './auto-restart.js'
import { OpenToolCalls } from './open-tool-calls.js'
import { RecoveryStore } from './restart-recovery.js'
import { RestartControl, type RestartEnvironment } from './restart.js'
import { StateFiles } from './runtime-files.js'
import { SessionEvents, type SessionEvent } from './session-events.js'
import { fakeSidebarHost, makeFakeHost, type FakeHost } from './sidebar-host.test-support.js'
import { temporaryStateFiles } from './state-files.test-support.js'

const RUN_ID = 'b53b44df-e873-4abb-2c6e-a92223ae2db9'

const managed = (home: string, path: Path.Path): RestartEnvironment => ({
  DSH_HOME: home,
  DSH_RESTART_RUN_ID: RUN_ID,
  DSH_RESTART_REQUEST_PATH: path.join(home, 'runtime', `dsh-web-restart-${RUN_ID}.request`),
})

const withAutoRestart = <A, E>(
  options: { readonly supervised?: boolean },
  body: (input: {
    readonly fake: FakeHost
    readonly requestPath: string
    readonly policy: Ref.Ref<AutoRestartPolicy>
    readonly updates: Ref.Ref<ReadonlyArray<string>>
  }) => Effect.Effect<A, E, AutoRestart | RecoveryStore | FileSystem.FileSystem>,
) =>
  Effect.gen(function* () {
    const files = yield* StateFiles
    const path = yield* Path.Path
    const fake = yield* makeFakeHost
    const policy = yield* Ref.make<AutoRestartPolicy>({ enabled: true, quietSeconds: 60 })
    const updates = yield* Ref.make<ReadonlyArray<string>>([])
    const pubsub = yield* PubSub.unbounded<SessionEvent>()
    const env = options.supervised === false ? {} : managed(files.home, path)
    const layer = AutoRestart.layerWith({ policy: Ref.get(policy), updates: Ref.get(updates), command: '/checkout/scripts/dsh-launcher' }).pipe(
      Layer.provideMerge(RestartControl.layerWith({ env, homeDirectory: files.home, armExitGuard: () => Effect.void })),
      Layer.provideMerge(OpenToolCalls.layer.pipe(Layer.provide(SessionEvents.layerTest(pubsub)))),
      Layer.provideMerge(fakeSidebarHost(fake)),
      Layer.provideMerge(RecoveryStore.layer.pipe(Layer.provide(Layer.succeed(StateFiles, files)))),
    )
    return yield* body({ fake, requestPath: path.join(files.home, 'runtime', `dsh-web-restart-${RUN_ID}.request`), policy, updates }).pipe(
      Effect.provide(layer),
    )
  }).pipe(Effect.provide(temporaryStateFiles))

const requested = (requestPath: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.exists(requestPath)
  })

/** Advance the test clock tick by tick, letting the file writes of a restart request land on the event loop. */
const advance = (seconds: number) =>
  Effect.forEach(Array.from({ length: Math.ceil(seconds / 5) }), () => TestClock.adjust('5 seconds').pipe(Effect.andThen(Effect.yieldNow)), { discard: true })

const phase = AutoRestart.use(auto => Effect.map(auto.status, status => status.phase))

/** The restart request writes real files: yield to the event loop until `read` satisfies `done`. */
const eventually = <A, E, R>(read: Effect.Effect<A, E, R>, done: (value: A) => boolean) =>
  read.pipe(
    Effect.tap(() => Effect.promise(() => new Promise(resolve => setImmediate(resolve)))),
    Effect.repeat({ until: done, times: 500 }),
  )

describe('automatic restart when idle', () => {
  it.effect('waits while a turn runs, then restarts once DSH stayed idle for the quiet period', () =>
    withAutoRestart({}, ({ fake, requestPath, updates }) =>
      Effect.gen(function* () {
        yield* advance(120)
        expect(yield* phase).toBe('none')
        yield* Ref.set(updates, ['@dshfiles/example'])
        yield* Ref.set(fake.running, ['working'])
        yield* advance(300)
        expect(yield* phase).toBe('waiting')
        expect(yield* requested(requestPath)).toBe(false)

        yield* Ref.set(fake.running, [])
        yield* advance(25)
        expect(yield* phase).toBe('quiet')
        yield* advance(10)
        expect(yield* phase).toBe('countdown')
        expect(yield* requested(requestPath)).toBe(false)
        yield* advance(30)
        expect(yield* eventually(phase, current => current === 'restarting')).toBe('restarting')
        expect(yield* requested(requestPath)).toBe(true)
      }),
    ),
  )

  it.effect('a running background job or an open user question blocks it like a turn', () =>
    withAutoRestart({}, ({ fake, requestPath, updates }) =>
      Effect.gen(function* () {
        yield* Ref.set(updates, ['@dshfiles/example'])
        yield* Ref.set(fake.jobs, 1)
        yield* advance(300)
        expect(yield* AutoRestart.use(auto => auto.status)).toMatchObject({ phase: 'waiting', busy: { jobs: 1 } })
        yield* Ref.set(fake.jobs, 0)
        yield* Ref.set(fake.sessions, [
          { sessionId: 'asking', running: false, blank: false, updatedAt: 0, parentSessionId: undefined, pendingQuestions: 1, cwd: undefined },
        ])
        yield* advance(300)
        expect(yield* AutoRestart.use(auto => auto.status)).toMatchObject({ phase: 'waiting', busy: { questions: 1 } })
        expect(yield* requested(requestPath)).toBe(false)
      }),
    ),
  )

  it.effect('a turn that starts during the countdown cancels it, and a later idle period starts over', () =>
    withAutoRestart({}, ({ fake, requestPath, updates }) =>
      Effect.gen(function* () {
        yield* Ref.set(updates, ['profile'])
        yield* advance(45)
        expect(yield* phase).toBe('countdown')
        yield* Ref.set(fake.running, ['late'])
        yield* advance(30)
        expect(yield* phase).toBe('waiting')
        expect(yield* requested(requestPath)).toBe(false)
        yield* Ref.set(fake.running, [])
        yield* advance(65)
        expect(yield* eventually(requested(requestPath), present => present)).toBe(true)
      }),
    ),
  )

  it.effect('postpone holds it, resume lets the next quiet period restart', () =>
    withAutoRestart({}, ({ requestPath, updates }) =>
      Effect.gen(function* () {
        yield* Ref.set(updates, ['@dshfiles/example'])
        yield* advance(45)
        expect(yield* phase).toBe('countdown')
        yield* AutoRestart.use(auto => auto.postpone(60))
        yield* advance(600)
        expect(yield* phase).toBe('postponed')
        expect(yield* requested(requestPath)).toBe(false)
        expect(yield* AutoRestart.use(auto => auto.resume)).toEqual({ resumed: true })
        yield* advance(65)
        expect(yield* eventually(requested(requestPath), present => present)).toBe(true)
      }),
    ),
  )

  it.effect('without a supervisor or with the setting off it never restarts; unsupervised names the launcher', () =>
    Effect.gen(function* () {
      yield* withAutoRestart({ supervised: false }, ({ requestPath, updates }) =>
        Effect.gen(function* () {
          yield* Ref.set(updates, ['@dshfiles/example'])
          yield* advance(600)
          expect(yield* AutoRestart.use(auto => auto.status)).toMatchObject({ phase: 'unsupervised', command: '/checkout/scripts/dsh-launcher' })
          expect(yield* requested(requestPath)).toBe(false)
        }),
      )
      yield* withAutoRestart({}, ({ requestPath, updates, policy }) =>
        Effect.gen(function* () {
          yield* Ref.set(policy, { enabled: false, quietSeconds: 60 })
          yield* Ref.set(updates, ['@dshfiles/example'])
          yield* advance(600)
          expect(yield* phase).toBe('disabled')
          expect(yield* requested(requestPath)).toBe(false)
        }),
      )
    }),
  )

  it.effect('a turn cut off anyway is recorded for the resume after boot', () =>
    withAutoRestart({}, ({ fake, updates }) =>
      Effect.gen(function* () {
        yield* Ref.set(updates, ['@dshfiles/example'])
        yield* advance(65)
        expect(yield* eventually(phase, current => current === 'restarting')).toBe('restarting')
        // A turn that starts in the second between the request and the exit is captured by the managed restart.
        yield* Ref.set(fake.running, ['raced'])
        yield* TestClock.adjust('1 second')
        const recorded = yield* eventually(
          RecoveryStore.use(store => store.list),
          entries => entries.length > 0,
        )
        expect(recorded.map(entry => [entry.sessionId, entry.reason])).toEqual([['raced', 'restart']])
      }),
    ),
  )

  it.effect('records one auto restart check span per tick', () =>
    withAutoRestart({}, ({ updates }) =>
      Effect.gen(function* () {
        using recorder = recordSpans()
        yield* Ref.set(updates, ['@dshfiles/example'])
        yield* advance(10)
        expect(recorder.spans.filter(span => span.name === 'auto restart check').length).toBeGreaterThanOrEqual(2)
      }),
    ).pipe(Effect.provide(DshxEffect.tracerLayer)),
  )
})
