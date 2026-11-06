import type { WorkspaceSyncView } from './api.js'

export interface WorkspaceSyncSubject {
  readonly workspace: string
  readonly bookmark: string
}

/** One sync view; a queued or running sync has no result yet. */
export const syncView = (input: WorkspaceSyncSubject, state: WorkspaceSyncView['state'], message: string | null, finishedAt: number): WorkspaceSyncView => ({
  workspace: input.workspace,
  bookmark: input.bookmark,
  state,
  status: null,
  pluginsRebuilt: [],
  hotPlugins: [],
  restartNeeded: false,
  conflicts: [],
  message,
  finishedAt: state === 'queued' || state === 'running' ? null : new Date(finishedAt).toISOString(),
})

/** A newly queued sync shows as queued unless one already runs, whose view stays the one on screen. */
export const queuedSyncView = (current: WorkspaceSyncView | null, input: WorkspaceSyncSubject): WorkspaceSyncView =>
  current?.state === 'running' ? current : syncView(input, 'queued', null, 0)
