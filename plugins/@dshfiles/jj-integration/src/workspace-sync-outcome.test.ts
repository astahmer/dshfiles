import { describe, expect, it } from 'vitest'
import type { WorkspaceSyncView } from './api.js'
import { workspaceSyncActivity, workspaceSyncOutcome } from './workspace-sync-outcome.js'

const view = (patch: Partial<WorkspaceSyncView>): WorkspaceSyncView => ({
  state: 'failed',
  workspace: 'default',
  bookmark: 'main',
  status: null,
  pluginsRebuilt: [],
  hotPlugins: [],
  restartNeeded: false,
  conflicts: [],
  message: null,
  finishedAt: '2026-10-23T12:00:00.000Z',
  ...patch,
})

const refusalHint = 'default@ carries described work that main does not have yet. Rebase it onto main, then sync again.'

describe('workspaceSyncOutcome', () => {
  it('names each dshx checkout sync status', () => {
    expect(workspaceSyncOutcome(view({ state: 'running', finishedAt: null }))).toBe('running')
    expect(workspaceSyncOutcome(view({ status: 'refused' }))).toBe('kept')
    expect(workspaceSyncOutcome(view({ status: 'conflicted' }))).toBe('conflicted')
    expect(workspaceSyncOutcome(view({ status: 'build-failed' }))).toBe('failed')
    expect(workspaceSyncOutcome(view({ status: null }))).toBe('failed')
    expect(workspaceSyncOutcome(view({ state: 'done', status: 'up-to-date' }))).toBe('up-to-date')
    expect(workspaceSyncOutcome(view({ state: 'done', status: 'synced' }))).toBe('updated')
  })
})

describe('workspaceSyncActivity', () => {
  it('reports a refusal as a safe no-change outcome with the next step, not a failed sync', () => {
    const activity = workspaceSyncActivity(view({ status: 'refused', message: refusalHint }))
    expect(activity.type).toBe('workspace.sync_refused')
    expect(activity.summary).toBe('default kept as is: sync refused, local work preserved')
    expect(activity.summary).not.toContain('not updated')
    expect(activity.detail).toBe(refusalHint)
  })

  it('gives a refusal without a hint the generic next step', () => {
    expect(workspaceSyncActivity(view({ status: 'refused' })).detail).toMatch(/then sync again/u)
  })

  it('keeps conflicts and build failures as failed syncs', () => {
    expect(workspaceSyncActivity(view({ status: 'conflicted', conflicts: ['a.ts'] }))).toMatchObject({
      type: 'workspace.sync_failed',
      level: 'attention',
      summary: 'default not updated: conflicts in a.ts',
    })
    expect(workspaceSyncActivity(view({ status: 'build-failed', message: 'tsc failed' }))).toMatchObject({
      type: 'workspace.sync_failed',
      summary: 'default not updated: tsc failed',
    })
  })

  it('reports an update, asking for attention only when a restart is needed', () => {
    expect(workspaceSyncActivity(view({ state: 'done', status: 'synced' }))).toMatchObject({
      type: 'workspace.sync_done',
      level: 'notable',
      summary: 'default updated · nothing to rebuild',
    })
    expect(workspaceSyncActivity(view({ state: 'done', status: 'synced', pluginsRebuilt: ['a'], restartNeeded: true }))).toMatchObject({
      level: 'attention',
      summary: 'default updated · 1 plugin rebuilt · restart to apply',
    })
  })
})
