import { describe, expect, it } from 'vitest'
import type { CleanupResult } from './api.js'
import { AUTO_CLEANUP_FIRST_RUN_DELAY_MS, AutoCleanupModel, createAutoCleanupScheduler, type AutoCleanupOutcome } from './auto-cleanup.js'
import { createCleanupJobRunner, type CleanupJobRequest } from './cleanup-jobs.js'
import { defaultJjIntegrationSettings, jjIntegrationSettings } from './settings.js'

const emptyResult: CleanupResult = { applied: true, workspaces: [], skipped: [], untracked: [], emptyRevisions: [] }

const settingsWith = (autoCleanup: Partial<typeof defaultJjIntegrationSettings.autoCleanup>) =>
  jjIntegrationSettings.schema({ autoCleanup: { ...defaultJjIntegrationSettings.autoCleanup, ...autoCleanup } }).autoCleanup

/** Timers the test fires by hand: each entry is one armed run and whether dispose cancelled it. */
const manualSchedule = () => {
  const armed: { run: () => void; delayMs: number; cancelled: boolean }[] = []
  return {
    armed,
    schedule: (run: () => void, delayMs: number) => {
      const entry = { run, delayMs, cancelled: false }
      armed.push(entry)
      return () => {
        entry.cancelled = true
      }
    },
  }
}

const settle = async (): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, 0))
}

/** A scheduler over a scripted set of recently active repositories and every repository the registry knows. */
const schedulerFor = (options: {
  readonly requests: CleanupJobRequest[]
  readonly active?: readonly string[]
  readonly known?: readonly string[]
  readonly settings?: Parameters<typeof settingsWith>[0]
  readonly outcome?: (outcome: AutoCleanupOutcome) => void
}) =>
  createAutoCleanupScheduler({
    runner: createCleanupJobRunner({
      execute: async ({ request }) => {
        options.requests.push(request)
        return emptyResult
      },
    }),
    settings: () => settingsWith(options.settings ?? {}),
    report: options.outcome ?? (() => undefined),
    activeProjects: async () => options.active ?? [],
    knownProjects: async () => options.known ?? options.active ?? [],
    schedule: manualSchedule().schedule,
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

describe('createAutoCleanupScheduler', () => {
  it('runs one shared cleanup job per recently active repository and reports every run into the same trail', async () => {
    const requests: CleanupJobRequest[] = []
    const scheduler = schedulerFor({ requests, active: ['/work/recent-a', '/work/recent-b'] })

    const outcome = await scheduler.runOnce()

    expect(requests).toEqual([
      { path: '/work/recent-a', olderThanHours: 24, kinds: ['empty', 'integrated'], trigger: 'automatic' },
      { path: '/work/recent-b', olderThanHours: 24, kinds: ['empty', 'integrated'], trigger: 'automatic' },
    ])
    expect(outcome).toMatchObject({ status: 'done', inactive: 0 })
    expect(outcome.status === 'done' ? outcome.runs.map(run => run.path) : []).toEqual(['/work/recent-a', '/work/recent-b'])
    scheduler.dispose()
  })

  it('leaves an inactive repository alone and counts it', async () => {
    const requests: CleanupJobRequest[] = []
    const scheduler = schedulerFor({ requests, active: ['/work/recent-a'], known: ['/work/recent-a', '/work/idle'] })

    const outcome = await scheduler.runOnce()

    expect(requests.map(request => request.path)).toEqual(['/work/recent-a'])
    expect(outcome).toMatchObject({ status: 'done', inactive: 1 })
    scheduler.dispose()
  })

  it('idles without starting any job when no repository was used inside the window', async () => {
    const requests: CleanupJobRequest[] = []
    const outcomes: AutoCleanupOutcome[] = []
    const scheduler = schedulerFor({ requests, active: [], known: ['/work/idle'], outcome: outcome => outcomes.push(outcome) })

    await expect(scheduler.runOnce()).resolves.toEqual({ status: 'idle', activeWithinHours: 2 })
    expect(requests).toEqual([])
    scheduler.dispose()
  })

  it('asks for the whole configured window, so a repository just inside it still runs', async () => {
    const windows: number[] = []
    const runner = createCleanupJobRunner({ execute: async () => emptyResult })
    const scheduler = createAutoCleanupScheduler({
      runner,
      settings: () => settingsWith({ activeWithinHours: 6 }),
      report: () => undefined,
      activeProjects: async withinHours => {
        windows.push(withinHours)
        return ['/work/recent']
      },
      schedule: manualSchedule().schedule,
    })

    await scheduler.runOnce()

    expect(windows).toEqual([6])
    scheduler.dispose()
  })

  it('covers every registered repository in one job when the activity window is zero', async () => {
    const requests: CleanupJobRequest[] = []
    const scheduler = schedulerFor({ requests, active: ['/work/recent'], settings: { activeWithinHours: 0 } })

    await scheduler.runOnce()

    expect(requests).toEqual([{ path: null, olderThanHours: 24, kinds: ['empty', 'integrated'], trigger: 'automatic' }])
    scheduler.dispose()
  })

  it('leaves a manual run untouched: automatic runs still cover every repository when given a project path', async () => {
    const requests: CleanupJobRequest[] = []
    const manualRunner = createCleanupJobRunner({
      execute: async ({ request }) => {
        requests.push(request)
        return emptyResult
      },
    })
    const manual = manualRunner.start({ path: '/work/sample', olderThanHours: 6, kinds: ['empty'], trigger: 'manual' })
    await manual.done
    const scheduler = createAutoCleanupScheduler({
      runner: manualRunner,
      settings: () => settingsWith({ activeWithinHours: 0 }),
      report: () => undefined,
      activeProjects: async () => ['/work/recent'],
      schedule: manualSchedule().schedule,
    })

    await scheduler.runOnce()

    expect(requests.map(request => [request.trigger, request.path])).toEqual([
      ['manual', '/work/sample'],
      ['automatic', null],
    ])
    scheduler.dispose()
  })

  it('skips without queuing while another cleanup job is running', async () => {
    let release: (() => void) | undefined
    const runner = createCleanupJobRunner({
      execute: () =>
        new Promise<CleanupResult>(resolve => {
          release = () => resolve(emptyResult)
        }),
    })
    const manual = runner.start({ path: '/work/sample', olderThanHours: 6, kinds: ['empty'], trigger: 'manual' })
    const scheduler = createAutoCleanupScheduler({
      runner,
      settings: () => settingsWith({}),
      report: () => undefined,
      activeProjects: async () => ['/work/recent'],
      schedule: manualSchedule().schedule,
    })

    await expect(scheduler.runOnce()).resolves.toEqual({ status: 'busy', jobId: manual.job.id })
    expect(runner.trail()).toHaveLength(1)

    await settle()
    release?.()
    await manual.done
    scheduler.dispose()
  })

  it('reports a failed job instead of throwing out of the timer', async () => {
    const runner = createCleanupJobRunner({
      execute: () => Promise.reject(new Error('jj workspace forget exited 1')),
    })
    const { schedule } = manualSchedule()
    const scheduler = createAutoCleanupScheduler({
      runner,
      settings: () => settingsWith({}),
      report: () => undefined,
      activeProjects: async () => ['/work/recent'],
      schedule,
    })

    await expect(scheduler.runOnce()).resolves.toEqual({ status: 'failed', jobId: 'cleanup-1', message: 'jj workspace forget exited 1' })
    expect(runner.trail()[0]).toMatchObject({ state: 'failed' })
    scheduler.dispose()
  })

  it('waits before its first run, then re-arms on the interval read at that moment', async () => {
    const { armed, schedule } = manualSchedule()
    const outcomes: AutoCleanupOutcome[] = []
    let intervalMinutes = 60
    const scheduler = createAutoCleanupScheduler({
      runner: createCleanupJobRunner({ execute: async () => emptyResult }),
      settings: () => settingsWith({ intervalMinutes }),
      report: outcome => outcomes.push(outcome),
      activeProjects: async () => ['/work/recent'],
      schedule,
    })

    expect(armed.map(entry => entry.delayMs)).toEqual([AUTO_CLEANUP_FIRST_RUN_DELAY_MS])
    intervalMinutes = 15
    armed[0]?.run()
    await settle()

    expect(outcomes.map(outcome => outcome.status)).toEqual(['done'])
    expect(armed.map(entry => entry.delayMs)).toEqual([AUTO_CLEANUP_FIRST_RUN_DELAY_MS, 15 * 60_000])
    scheduler.dispose()
  })

  it('keeps re-arming while disabled so enabling it later takes effect', async () => {
    const runner = createCleanupJobRunner({ execute: async () => emptyResult })
    const { armed, schedule } = manualSchedule()
    const outcomes: AutoCleanupOutcome[] = []
    const scheduler = createAutoCleanupScheduler({
      runner,
      settings: () => settingsWith({ enabled: false }),
      report: outcome => outcomes.push(outcome),
      activeProjects: async () => ['/work/recent'],
      schedule,
    })

    armed[0]?.run()
    await settle()

    expect(outcomes).toEqual([{ status: 'disabled' }])
    expect(runner.trail()).toHaveLength(0)
    expect(armed).toHaveLength(2)
    scheduler.dispose()
  })

  it('cancels the armed run on dispose and never re-arms after it', async () => {
    let release: (() => void) | undefined
    const runner = createCleanupJobRunner({
      execute: () =>
        new Promise<CleanupResult>(resolve => {
          release = () => resolve(emptyResult)
        }),
    })
    const { armed, schedule } = manualSchedule()
    const outcomes: AutoCleanupOutcome[] = []
    const scheduler = createAutoCleanupScheduler({
      runner,
      settings: () => settingsWith({}),
      report: outcome => outcomes.push(outcome),
      activeProjects: async () => ['/work/recent'],
      schedule,
    })

    armed[0]?.run()
    await settle()
    scheduler.dispose()
    release?.()
    await settle()

    expect(outcomes).toEqual([])
    expect(armed).toHaveLength(1)

    const idle = createAutoCleanupScheduler({
      runner,
      settings: () => settingsWith({}),
      report: () => undefined,
      activeProjects: async () => ['/work/recent'],
      schedule,
    })
    idle.dispose()
    expect(armed[1]?.cancelled).toBe(true)
  })

  it('logs a timer run whose repository scan rejects instead of leaving an unhandled rejection, and stays armed', async () => {
    const { armed, schedule } = manualSchedule()
    const errors: unknown[] = []
    const scheduler = createAutoCleanupScheduler({
      runner: createCleanupJobRunner({ execute: async () => emptyResult }),
      settings: () => settingsWith({}),
      report: () => undefined,
      activeProjects: async () => {
        throw new Error('registry unreadable')
      },
      schedule,
      onError: error => errors.push(error),
    })

    armed[0]?.run()
    await settle()

    expect(errors).toEqual([new Error('registry unreadable')])
    expect(armed).toHaveLength(2)
    scheduler.dispose()
  })
})
