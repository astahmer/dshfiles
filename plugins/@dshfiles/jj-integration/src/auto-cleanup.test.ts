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

describe('auto-cleanup settings', () => {
  it('defaults to an hourly run of empty and integrated workspaces idle for a day', () => {
    expect(defaultJjIntegrationSettings.autoCleanup).toEqual({ enabled: true, kinds: ['empty', 'integrated'], olderThanHours: 24, intervalMinutes: 60 })
  })

  it('rejects an interval below five minutes and an unknown kind', () => {
    expect(() => jjIntegrationSettings.schema({ autoCleanup: { intervalMinutes: 1 } })).toThrow()
    const storedByHand = JSON.parse('{ "autoCleanup": { "kinds": ["everything"] } }')
    expect(() => jjIntegrationSettings.schema(storedByHand)).toThrow()
  })
})

describe('AutoCleanupModel.request', () => {
  it('asks every repository for the configured kinds and age, marked automatic', () => {
    expect(AutoCleanupModel.request(settingsWith({ kinds: ['integrated', 'untracked', 'integrated'], olderThanHours: 48 }))).toEqual({
      path: null,
      olderThanHours: 48,
      kinds: ['integrated', 'untracked'],
      trigger: 'automatic',
    })
  })

  it('asks nothing when disabled or when no kind is selected', () => {
    expect(AutoCleanupModel.request(settingsWith({ enabled: false }))).toBeUndefined()
    expect(AutoCleanupModel.request(settingsWith({ kinds: [] }))).toBeUndefined()
  })
})

describe('createAutoCleanupScheduler', () => {
  it('runs the shared cleanup job and reports its result into the same trail', async () => {
    const requests: CleanupJobRequest[] = []
    const runner = createCleanupJobRunner({
      execute: async ({ request }) => {
        requests.push(request)
        return emptyResult
      },
    })
    const { schedule } = manualSchedule()
    const scheduler = createAutoCleanupScheduler({ runner, settings: () => settingsWith({}), report: () => undefined, schedule })

    const outcome = await scheduler.runOnce()

    expect(outcome).toEqual({ status: 'done', jobId: 'cleanup-1', result: emptyResult })
    expect(requests).toEqual([{ path: null, olderThanHours: 24, kinds: ['empty', 'integrated'], trigger: 'automatic' }])
    expect(runner.trail()[0]).toMatchObject({ state: 'done', request: { trigger: 'automatic' } })
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
    const { schedule } = manualSchedule()
    const scheduler = createAutoCleanupScheduler({ runner, settings: () => settingsWith({}), report: () => undefined, schedule })

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
    const scheduler = createAutoCleanupScheduler({ runner, settings: () => settingsWith({}), report: () => undefined, schedule })

    await expect(scheduler.runOnce()).resolves.toEqual({ status: 'failed', jobId: 'cleanup-1', message: 'jj workspace forget exited 1' })
    expect(runner.trail()[0]).toMatchObject({ state: 'failed' })
    scheduler.dispose()
  })

  it('waits before its first run, then re-arms on the interval read at that moment', async () => {
    const runner = createCleanupJobRunner({ execute: async () => emptyResult })
    const { armed, schedule } = manualSchedule()
    const outcomes: AutoCleanupOutcome[] = []
    let intervalMinutes = 60
    const scheduler = createAutoCleanupScheduler({
      runner,
      settings: () => settingsWith({ intervalMinutes }),
      report: outcome => outcomes.push(outcome),
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
    const scheduler = createAutoCleanupScheduler({ runner, settings: () => settingsWith({}), report: outcome => outcomes.push(outcome), schedule })

    armed[0]?.run()
    await settle()
    scheduler.dispose()
    release?.()
    await settle()

    expect(outcomes).toEqual([])
    expect(armed).toHaveLength(1)

    const idle = createAutoCleanupScheduler({ runner, settings: () => settingsWith({}), report: () => undefined, schedule })
    idle.dispose()
    expect(armed[1]?.cancelled).toBe(true)
  })
})
