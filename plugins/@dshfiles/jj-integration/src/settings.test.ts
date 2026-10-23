import { describe, expect, it } from 'vitest'
import {
  defaultJjIntegrationSettings,
  IntegratedNoticeActions,
  isolatesNewThreadsByDefault,
  jjIntegrationSettings,
  mayAutoIntegrateWorkspace,
  RepositoryAutoIntegration,
} from './settings.js'

const noExcludedRepositories: readonly string[] = []

const eligibleWorkspace = {
  sessionId: 'session-1',
  sessionIds: ['session-1'],
  isThreadWorkspace: true,
  repositoryRoot: '/Users/dev/dshfiles',
  excludedRepositoryRoots: noExcludedRepositories,
}

describe('finished thread cleanup settings', () => {
  it('defaults to enabled with a fifteen-minute grace period and validates the configurable delay', () => {
    expect(defaultJjIntegrationSettings.removeFinishedThreads).toBe(true)
    expect(defaultJjIntegrationSettings.removeFinishedThreadsAfterMinutes).toBe(15)
    expect(jjIntegrationSettings.schema({ removeFinishedThreads: false, removeFinishedThreadsAfterMinutes: 30 })).toMatchObject({
      removeFinishedThreads: false,
      removeFinishedThreadsAfterMinutes: 30,
    })
    expect(() => jjIntegrationSettings.schema({ removeFinishedThreadsAfterMinutes: 0 })).toThrow()
    expect(() => jjIntegrationSettings.schema({ removeFinishedThreadsAfterMinutes: 24 * 60 + 1 })).toThrow()
  })
})

describe('automatic integration scope', () => {
  it('defaults to manual integration and opt-in thread isolation', () => {
    const settings = jjIntegrationSettings.schema({})

    expect(settings.autoIntegrationScope).toBe('none')
    expect(settings.autoIntegrationExcludedRepositories).toEqual([])
    expect(isolatesNewThreadsByDefault(settings)).toBe(false)
  })

  it('forces new-thread isolation for all scope', () => {
    const settings = jjIntegrationSettings.schema({ autoIntegrationScope: 'all' })

    expect(isolatesNewThreadsByDefault(settings)).toBe(true)
    expect(isolatesNewThreadsByDefault({ ...settings, isolateByDefault: true, autoIntegrationScope: 'isolated' })).toBe(true)
  })

  it('auto-integrates only uniquely owned thread workspaces', () => {
    expect(mayAutoIntegrateWorkspace({ ...eligibleWorkspace, scope: 'isolated' })).toBe(true)
    expect(mayAutoIntegrateWorkspace({ ...eligibleWorkspace, scope: 'none' })).toBe(false)
    expect(mayAutoIntegrateWorkspace({ ...eligibleWorkspace, scope: 'all', isThreadWorkspace: false })).toBe(false)
    expect(mayAutoIntegrateWorkspace({ ...eligibleWorkspace, scope: 'all', sessionIds: ['session-1', 'session-2'] })).toBe(false)
    expect(mayAutoIntegrateWorkspace({ ...eligibleWorkspace, scope: 'all', sessionId: 'session-2' })).toBe(false)
  })

  it('never auto-integrates an excluded repository', () => {
    const excluded = { ...eligibleWorkspace, scope: 'all' as const, excludedRepositoryRoots: ['/Users/dev/welii'] }

    expect(mayAutoIntegrateWorkspace({ ...excluded, repositoryRoot: '/Users/dev/welii' })).toBe(false)
    expect(mayAutoIntegrateWorkspace({ ...excluded, repositoryRoot: '/Users/dev/welii-threads/thread-2b56e6' })).toBe(true)
    expect(mayAutoIntegrateWorkspace({ ...excluded, repositoryRoot: '/Users/dev/welii', scope: 'isolated' })).toBe(false)
  })

  it('matches an excluded path regardless of a trailing separator or surrounding space', () => {
    expect(RepositoryAutoIntegration.isExcluded({ repositoryRoot: '/Users/dev/welii', excludedRepositoryRoots: [' /Users/dev/welii/ '] })).toBe(true)
    expect(RepositoryAutoIntegration.isExcluded({ repositoryRoot: '/Users/dev/welii/', excludedRepositoryRoots: ['/Users/dev/welii'] })).toBe(true)
    expect(RepositoryAutoIntegration.isExcluded({ repositoryRoot: '/Users/dev/welii-two', excludedRepositoryRoots: ['/Users/dev/welii'] })).toBe(false)
    expect(RepositoryAutoIntegration.isExcluded({ repositoryRoot: '/Users/dev/welii', excludedRepositoryRoots: ['~/dev/welii'] })).toBe(false)
  })
})

describe('integrated notice actions', () => {
  it('offers Settle alone unless another action is configured', () => {
    expect(defaultJjIntegrationSettings.integratedThreadActions).toBe('settle')
    expect(IntegratedNoticeActions.forSettings(defaultJjIntegrationSettings)).toEqual(['settle'])
    expect(IntegratedNoticeActions.forSettings(jjIntegrationSettings.schema({ integratedThreadActions: 'settle' }))).toEqual(['settle'])
    expect(IntegratedNoticeActions.forSettings(jjIntegrationSettings.schema({ integratedThreadActions: 'both' }))).toEqual(['settle', 'archive'])
    expect(IntegratedNoticeActions.forSettings(jjIntegrationSettings.schema({ integratedThreadActions: 'none' }))).toEqual([])
  })
})
