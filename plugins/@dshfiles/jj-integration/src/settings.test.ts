import { describe, expect, it } from 'vitest'
import {
  defaultJjIntegrationSettings,
  IntegratedNoticeActions,
  isolatesNewThreadsByDefault,
  jjIntegrationSettings,
  mayAutoIntegrateWorkspace,
} from './settings.js'

describe('automatic integration scope', () => {
  it('defaults to manual integration and opt-in thread isolation', () => {
    const settings = jjIntegrationSettings.schema({})

    expect(settings.autoIntegrationScope).toBe('none')
    expect(isolatesNewThreadsByDefault(settings)).toBe(false)
  })

  it('forces new-thread isolation for all scope', () => {
    const settings = jjIntegrationSettings.schema({ autoIntegrationScope: 'all' })

    expect(isolatesNewThreadsByDefault(settings)).toBe(true)
    expect(isolatesNewThreadsByDefault({ ...settings, isolateByDefault: true, autoIntegrationScope: 'isolated' })).toBe(true)
  })

  it('auto-integrates only uniquely owned thread workspaces', () => {
    const base = { sessionId: 'session-1', sessionIds: ['session-1'] }

    expect(mayAutoIntegrateWorkspace({ ...base, scope: 'isolated', isThreadWorkspace: true })).toBe(true)
    expect(mayAutoIntegrateWorkspace({ ...base, scope: 'none', isThreadWorkspace: true })).toBe(false)
    expect(mayAutoIntegrateWorkspace({ ...base, scope: 'all', isThreadWorkspace: false })).toBe(false)
    expect(mayAutoIntegrateWorkspace({ ...base, scope: 'all', isThreadWorkspace: true, sessionIds: ['session-1', 'session-2'] })).toBe(false)
    expect(mayAutoIntegrateWorkspace({ ...base, scope: 'all', isThreadWorkspace: true, sessionId: 'session-2' })).toBe(false)
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
