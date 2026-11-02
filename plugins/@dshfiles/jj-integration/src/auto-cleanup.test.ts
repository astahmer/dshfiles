import { describe, expect, it } from '@effect/vitest'
import { Deferred, Duration, Effect, Fiber, Ref } from 'effect'
import { TestClock } from 'effect/testing'
import type { CleanupResult } from './api.js'
import { AUTO_CLEANUP_FIRST_RUN_DELAY, AutoCleanupModel } from './auto-cleanup.js'
import type { CleanupJobRequest } from './cleanup-jobs.js'
import { CleanupRunner } from './cleanup-runner.js'
import { defaultJjIntegrationSettings, jjIntegrationSettings } from './settings.js'

const emptyResult: CleanupResult = { applied: true, workspaces: [], skipped: [], untracked: [], emptyRevisions: [] }

const settingsWith = (autoCleanup: Partial<typeof defaultJjIntegrationSettings.autoCleanup>) =>
  jjIntegrationSettings.schema({ autoCleanup: { ...defaultJjIntegrationSettings.autoCleanup, ...autoCleanup } }).autoCleanup

/** A real runner whose jobs record their request and finish at once. */
const recordingRunner = Effect.gen(function* () {
  const requests: CleanupJobRequest[] = []
  const runner = yield* CleanupRunner.make({
    execute: ({ request }) =>
      Effect.sync(() => {
        requests.push(request)
        return emptyResult
      }),
  })
  return { runner, requests }
})

const runOnce = (input: {
  readonly runner: Effect.Success<ReturnType<typeof CleanupRunner.make>>
  readonly active?: readonly string[]
  readonly known?: readonly string[]
  readonly settings?: Parameters<typeof settingsWith>[0]
}) =>
  AutoCleanupModel.runOnce({
    settings: settingsWith(input.settings ?? {}),
    runner: input.runner,
    activeProjects: () => Effect.succeed(input.active ?? []),
    knownProjects: Effect.succeed(input.known ?? input.active ?? []),
  })

describe('auto-cleanup settings', () => {
  it('defaults to an hourly run of empty and integrated workspaces idle for a day, in the repositories used in the last two hours', () => {
    expect(defaultJjIntegrationSettings.autoCleanup).toEqual({
      enabled: true,
      kinds: ['empty', 'integrated'],
      olderThanHours: 24,
      intervalMinutes: 60,
      activeWithinHours: 2,
      onSettle: false,
    })
  })

  it('rejects an interval below five minutes, an activity window past a week and an unknown kind', () => {
    expect(() => jjIntegrationSettings.schema({ autoCleanup: { intervalMinutes: 1 } })).toThrow()
    expect(() => jjIntegrationSettings.schema({ autoCleanup: { activeWithinHours: 24 * 8 } })).toThrow()
    const storedByHand = JSON.parse('{ "autoCleanup": { "kinds": ["everything"] } }')
    expect(() => jjIntegrationSettings.schema(storedByHand)).toThrow()
    const manualOnlyKind = JSON.parse('{ "autoCleanup": { "kinds": ["secondary"] } }')
    expect(() => jjIntegrationSettings.schema(manualOnlyKind)).toThrow()
  })
})

describe('AutoCleanupModel.request', () => {
  it('asks one repository for the configured kinds and age, marked automatic', () => {
    expect(AutoCleanupModel.request(settingsWith({ kinds: ['integrated', 'untracked', 'integrated'], olderThanHours: 48 }), '/work/sample')).toEqual({
      path: '/work/sample',
      olderThanHours: 48,
      kinds: ['integrated', 'untracked'],
      trigger: 'automatic',
    })
  })

  it('falls back to every repository when the activity window is zero', () => {
    const settings = settingsWith({ activeWithinHours: 0 })
    expect(AutoCleanupModel.coversEveryRepository(settings)).toBe(true)
    expect(AutoCleanupModel.request(settings, null).path).toBeNull()
    expect(AutoCleanupModel.coversEveryRepository(settingsWith({ activeWithinHours: 2 }))).toBe(false)
  })
})

describe('AutoCleanupModel.runOnce', () => {
  it.effect('runs one shared cleanup job per recently active repository and reports every run into the same trail', () =>
    Effect.gen(function* () {
      const { runner, requests } = yield* recordingRunner
      const outcome = yield* runOnce({ runner, active: ['/work/recent-a', '/work/recent-b'] })
      expect(requests).toEqual([
        { path: '/work/recent-a', olderThanHours: 24, kinds: ['empty', 'integrated'], trigger: 'automatic' },
        { path: '/work/recent-b', olderThanHours: 24, kinds: ['empty', 'integrated'], trigger: 'automatic' },
      ])
      expect(outcome).toMatchObject({ status: 'done', inactive: 0 })
      expect(outcome.status === 'done' ? outcome.runs.map(run => run.path) : []).toEqual(['/work/recent-a', '/work/recent-b'])
      expect(yield* runner.trail).toHaveLength(2)
    }).pipe(Effect.scoped),
  )

  it.effect('leaves an inactive repository alone and counts it', () =>
    Effect.gen(function* () {
      const { runner, requests } = yield* recordingRunner
      const outcome = yield* runOnce({ runner, active: ['/work/recent-a'], known: ['/work/recent-a', '/work/idle'] })
      expect(requests.map(request => request.path)).toEqual(['/work/recent-a'])
      expect(outcome).toMatchObject({ status: 'done', inactive: 1 })
    }).pipe(Effect.scoped),
  )

  it.effect('idles without starting any job when no repository was used inside the window', () =>
    Effect.gen(function* () {
      const { runner, requests } = yield* recordingRunner
      expect(yield* runOnce({ runner, active: [], known: ['/work/idle'] })).toEqual({ status: 'idle', activeWithinHours: 2 })
      expect(requests).toEqual([])
    }).pipe(Effect.scoped),
  )

  it.effect('asks for the whole configured window, so a repository just inside it still runs', () =>
    Effect.gen(function* () {
      const { runner } = yield* recordingRunner
      const windows: number[] = []
      yield* AutoCleanupModel.runOnce({
        settings: settingsWith({ activeWithinHours: 6 }),
        runner,
        activeProjects: withinHours => Effect.sync(() => (windows.push(withinHours), ['/work/recent'])),
      })
      expect(windows).toEqual([6])
    }).pipe(Effect.scoped),
  )

  it.effect('covers every registered repository in one job when the activity window is zero', () =>
    Effect.gen(function* () {
      const { runner, requests } = yield* recordingRunner
      yield* runOnce({ runner, active: ['/work/recent'], settings: { activeWithinHours: 0 } })
      expect(requests).toEqual([{ path: null, olderThanHours: 24, kinds: ['empty', 'integrated'], trigger: 'automatic' }])
    }).pipe(Effect.scoped),
  )

  it.effect('leaves a manual run untouched: automatic runs still cover every repository when given a project path', () =>
    Effect.gen(function* () {
      const { runner, requests } = yield* recordingRunner
      yield* Effect.flatMap(runner.start({ path: '/work/sample', olderThanHours: 6, kinds: ['empty'], trigger: 'manual' }), started => started.done)
      yield* runOnce({ runner, active: ['/work/recent'], settings: { activeWithinHours: 0 } })
      expect(requests.map(request => [request.trigger, request.path])).toEqual([
        ['manual', '/work/sample'],
        ['automatic', null],
      ])
    }).pipe(Effect.scoped),
  )

  it.effect('skips without queuing while another cleanup job is running', () =>
    Effect.gen(function* () {
      const release = yield* Deferred.make<void>()
      const runner = yield* CleanupRunner.make({ execute: () => Effect.as(Deferred.await(release), emptyResult) })
      const manual = yield* runner.start({ path: '/work/sample', olderThanHours: 6, kinds: ['empty'], trigger: 'manual' })
      expect(yield* runOnce({ runner, active: ['/work/recent'] })).toEqual({ status: 'busy', jobId: manual.job.id })
      expect(yield* runner.trail).toHaveLength(1)
      yield* Deferred.succeed(release, undefined)
      yield* manual.done
    }).pipe(Effect.scoped),
  )

  it.effect('reports a failed job as an outcome', () =>
    Effect.gen(function* () {
      const runner = yield* CleanupRunner.make({ execute: () => Effect.fail(new Error('jj workspace forget exited 1')) })
      expect(yield* runOnce({ runner, active: ['/work/recent'] })).toEqual({ status: 'failed', jobId: 'cleanup-1', message: 'jj workspace forget exited 1' })
      expect((yield* runner.trail)[0]).toMatchObject({ state: 'failed' })
    }).pipe(Effect.scoped),
  )

  it.effect('reports disabled without starting a job', () =>
    Effect.gen(function* () {
      const { runner } = yield* recordingRunner
      expect(yield* runOnce({ runner, active: ['/work/recent'], settings: { enabled: false } })).toEqual({ status: 'disabled' })
      expect(yield* runner.trail).toHaveLength(0)
    }).pipe(Effect.scoped),
  )
})

describe('AutoCleanupModel.schedule', () => {
  it.effect('waits before its first run, then re-arms on the interval read after each run', () =>
    Effect.gen(function* () {
      const runs = yield* Ref.make(0)
      const interval = yield* Ref.make(60)
      const fiber = yield* Effect.forkChild(
        AutoCleanupModel.schedule({
          run: Ref.update(runs, count => count + 1),
          intervalMinutes: Ref.get(interval),
          firstRunDelay: AUTO_CLEANUP_FIRST_RUN_DELAY,
        }),
      )
      yield* TestClock.adjust(Duration.subtract(AUTO_CLEANUP_FIRST_RUN_DELAY, Duration.seconds(1)))
      expect(yield* Ref.get(runs)).toBe(0)
      yield* Ref.set(interval, 15)
      yield* TestClock.adjust(Duration.seconds(1))
      expect(yield* Ref.get(runs)).toBe(1)
      yield* TestClock.adjust(Duration.minutes(14))
      expect(yield* Ref.get(runs)).toBe(1)
      yield* TestClock.adjust(Duration.minutes(1))
      expect(yield* Ref.get(runs)).toBe(2)
      yield* Fiber.interrupt(fiber)
      yield* TestClock.adjust(Duration.hours(2))
      expect(yield* Ref.get(runs)).toBe(2)
    }),
  )

  it.effect('logs a failed run and stays armed', () =>
    Effect.gen(function* () {
      const attempts = yield* Ref.make(0)
      yield* Effect.forkChild(
        AutoCleanupModel.schedule({
          run: Effect.andThen(
            Ref.update(attempts, count => count + 1),
            Effect.fail(new Error('registry unreadable')),
          ),
          intervalMinutes: Effect.succeed(60),
          firstRunDelay: Duration.zero,
        }),
      )
      yield* TestClock.adjust(Duration.zero)
      expect(yield* Ref.get(attempts)).toBe(1)
      yield* TestClock.adjust(Duration.hours(1))
      expect(yield* Ref.get(attempts)).toBe(2)
    }),
  )
})
