import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Path, Ref } from 'effect'
import { TestClock } from 'effect/testing'
import { RecoveryStore } from './restart-recovery.js'
import { RestartControl, RestartDrain, type RestartEnvironment } from './restart.js'
import { StateFiles } from './runtime-files.js'
import { fakeSidebarHost, makeFakeHost, type FakeHost } from './sidebar-host.test-support.js'
import { temporaryStateFiles } from './state-files.test-support.js'

const RUN_ID = 'a53b44df-e873-4abb-2c6e-a92223ae2db9'

const managed = (home: string, path: Path.Path): RestartEnvironment => ({
  DSH_HOME: home,
  DSH_RESTART_RUN_ID: RUN_ID,
  DSH_RESTART_REQUEST_PATH: path.join(home, 'runtime', `dsh-web-restart-${RUN_ID}.request`),
})

/** The restart services over a fake Host and the real files of a temporary DSH home. */
const withRestart = <A, E>(
  options: { readonly env?: (home: string, path: Path.Path) => RestartEnvironment; readonly exitHook?: boolean },
  body: (input: {
    readonly fake: FakeHost
    readonly requestPath: string
    readonly home: string
  }) => Effect.Effect<A, E, RestartControl | RestartDrain | RecoveryStore | FileSystem.FileSystem | Path.Path>,
) =>
  Effect.gen(function* () {
    const files = yield* StateFiles
    const path = yield* Path.Path
    const fake = yield* makeFakeHost
    const env = (options.env ?? managed)(files.home, path)
    const layer = RestartDrain.layer.pipe(
      Layer.provideMerge(RestartControl.layerWith({ env, homeDirectory: files.home })),
      Layer.provideMerge(fakeSidebarHost(fake, { exitHook: options.exitHook ?? true })),
      Layer.provideMerge(RecoveryStore.layer.pipe(Layer.provide(Layer.succeed(StateFiles, files)))),
    )
    return yield* body({ fake, requestPath: path.join(files.home, 'runtime', `dsh-web-restart-${RUN_ID}.request`), home: files.home }).pipe(
      Effect.provide(layer),
    )
  }).pipe(Effect.provide(temporaryStateFiles))

const exists = (path: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.exists(path)
  })

/** File writes finish on the event loop, not on the test clock: yield to it until `read` satisfies `done`. */
const eventually = <A, E, R>(read: Effect.Effect<A, E, R>, done: (value: A) => boolean) =>
  read.pipe(Effect.tap(Effect.yieldNow), Effect.repeat({ until: done, times: 500 }))

describe('managed restart', () => {
  it.effect('restart availability requires both the launcher handoff and the DSH exit hook', () =>
    Effect.gen(function* () {
      expect(yield* withRestart({}, () => RestartControl.use(control => Effect.succeed(control.available)))).toBe(true)
      expect(yield* withRestart({ exitHook: false }, () => RestartControl.use(control => Effect.succeed(control.available)))).toBe(false)
      yield* withRestart(
        { env: (home, path) => ({ ...managed(home, path), DSH_RESTART_REQUEST_PATH: path.join(home, 'other.request') }) },
        ({ fake, requestPath }) =>
          Effect.gen(function* () {
            const control = yield* RestartControl
            expect(control.available).toBe(false)
            expect((yield* Effect.flip(control.request))._tag).toBe('RestartUnavailable')
            expect(yield* fake.exits).toEqual([])
            expect(yield* exists(requestPath)).toBe(false)
          }),
      )
    }).pipe(Effect.provide(temporaryStateFiles)),
  )

  it.effect('restart request writes one marker and schedules a distinct graceful exit code', () =>
    withRestart({}, ({ fake, requestPath }) =>
      Effect.gen(function* () {
        const control = yield* RestartControl
        yield* Ref.set(fake.running, ['working'])
        expect(yield* control.request).toEqual({ accepted: true })
        expect(yield* (yield* FileSystem.FileSystem).readFileString(requestPath)).toBe(RUN_ID)
        expect(yield* fake.exits).toEqual([])
        expect(yield* eventually(Effect.andThen(TestClock.adjust('1 second'), fake.exits), exits => exits.length > 0)).toEqual([75])
        expect((yield* RecoveryStore.use(store => store.list)).map(entry => [entry.sessionId, entry.reason])).toEqual([['working', 'restart']])
        expect((yield* Effect.flip(control.request))._tag).toBe('RestartRequestFailed')
      }),
    ),
  )

  it.effect('a failed recovery snapshot cancels the managed restart request', () =>
    withRestart({}, ({ fake, requestPath }) =>
      Effect.gen(function* () {
        yield* Ref.set(fake.persistenceFails, true)
        yield* RestartControl.use(control => control.request)
        expect(yield* eventually(Effect.andThen(TestClock.adjust('1 second'), exists(requestPath)), present => !present)).toBe(false)
        expect(yield* fake.exits).toEqual([])
      }),
    ),
  )

  it.effect('hands out only a loopback launch URL the supervisor recorded', () =>
    withRestart({}, ({ home }) =>
      Effect.gen(function* () {
        const control = yield* RestartControl
        const files = yield* FileSystem.FileSystem
        const path = yield* Path.Path
        expect(yield* control.launchUrl).toBe(null)
        yield* files.makeDirectory(path.join(home, 'runtime'), { recursive: true })
        yield* files.writeFileString(path.join(home, 'runtime', 'web-url'), 'http://127.0.0.1:3080/?token=abc\n')
        expect(yield* control.launchUrl).toBe('http://127.0.0.1:3080/?token=abc')
        yield* files.writeFileString(path.join(home, 'runtime', 'web-url'), 'http://evil.example/?token=abc\n')
        expect(yield* control.launchUrl).toBe(null)
      }),
    ),
  )
})

describe('restart when idle', () => {
  it.effect('waits for two idle polls in a row, then restarts', () =>
    withRestart({}, ({ fake, requestPath }) =>
      Effect.gen(function* () {
        const drain = yield* RestartDrain
        yield* TestClock.setTime(1_000)
        yield* Ref.set(fake.running, ['working'])
        expect(yield* drain.request).toEqual({ accepted: true })
        expect(yield* drain.request).toEqual({ accepted: true })
        expect(yield* drain.pending).toEqual({ since: 1_000, running: 1 })
        yield* TestClock.adjust('10 seconds')
        expect(yield* exists(requestPath)).toBe(false)

        yield* Ref.set(fake.running, [])
        yield* TestClock.adjust('2 seconds')
        expect(yield* exists(requestPath)).toBe(false)
        yield* TestClock.adjust('2 seconds')
        expect(yield* eventually(exists(requestPath), present => present)).toBe(true)
        expect(yield* drain.pending).toBe(null)
        // The exit fiber starts its one-second delay once the marker is written; keep the clock moving until it ran.
        expect(yield* eventually(Effect.andThen(TestClock.adjust('1 second'), fake.exits), exits => exits.length > 0)).toEqual([75])
      }),
    ),
  )

  it.effect('restarts anyway past the wait limit, and a canceled wait restarts nothing', () =>
    withRestart({}, ({ fake, requestPath }) =>
      Effect.gen(function* () {
        const drain = yield* RestartDrain
        yield* Ref.set(fake.running, ['working'])
        yield* drain.request
        expect(yield* drain.cancel).toEqual({ canceled: true })
        expect(yield* drain.cancel).toEqual({ canceled: false })
        yield* TestClock.adjust('31 minutes')
        expect(yield* exists(requestPath)).toBe(false)

        yield* drain.request
        yield* TestClock.adjust('30 minutes')
        expect(yield* eventually(exists(requestPath), present => present)).toBe(true)
      }),
    ),
  )

  it.effect('refuses to wait when this DSH cannot restart itself', () =>
    withRestart({ exitHook: false }, () =>
      Effect.gen(function* () {
        expect((yield* Effect.flip(RestartDrain.use(drain => drain.request)))._tag).toBe('RestartUnavailable')
      }),
    ),
  )
})
