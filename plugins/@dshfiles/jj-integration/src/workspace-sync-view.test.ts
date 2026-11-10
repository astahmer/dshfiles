import { describe, expect, it } from 'vitest'
import type { WorkspaceSyncView } from './api.js'
import { queuedSyncView } from './workspace-sync-view.js'

const running: WorkspaceSyncView = {
  state: 'running',
  workspace: 'default',
  bookmark: 'main',
  status: null,
  pluginsRebuilt: [],
  hotPlugins: [],
  restartNeeded: false,
  conflicts: [],
  message: null,
  finishedAt: null,
}

const queued: WorkspaceSyncView = { ...running, state: 'queued' }

describe('queuedSyncView', () => {
  it('reports a new sync as queued, not as one that already runs', () => {
    expect(queuedSyncView(null, { workspace: 'default', bookmark: 'main' })).toMatchObject({
      state: 'queued',
      status: null,
      finishedAt: null,
    })
  })

  it('keeps the running sync on screen while another request is only queued', () => {
    expect(queuedSyncView(running, { workspace: 'other', bookmark: 'trunk' })).toBe(running)
  })

  it('replaces a queued view with the newest queued request', () => {
    expect(queuedSyncView(queued, { workspace: 'default', bookmark: 'trunk' })).toMatchObject({ state: 'queued', bookmark: 'trunk' })
  })
})
