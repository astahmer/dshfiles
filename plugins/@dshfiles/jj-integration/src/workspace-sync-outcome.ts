import type { WorkspaceSyncView } from './api.js'

type WorkspaceSyncOutcome = 'running' | 'updated' | 'up-to-date' | 'kept' | 'conflicted' | 'failed'

/**
 * What a finished `dshx checkout sync` means for the checkout. `kept` is the safe refusal: the routine stopped
 * before rewriting anything (or undid its own rebase), so the checkout and its local work are exactly as before.
 */
export const workspaceSyncOutcome = (view: WorkspaceSyncView): WorkspaceSyncOutcome => {
  if (view.state === 'running') return 'running'
  if (view.status === 'refused') return 'kept'
  if (view.status === 'conflicted') return 'conflicted'
  if (view.status === 'up-to-date') return 'up-to-date'
  if (view.state === 'done') return 'updated'
  return 'failed'
}

const NEXT_STEP_WHEN_KEPT = 'Bring that work onto the bookmark (or describe it "wip" if it is local-only), then sync again.'

interface WorkspaceSyncActivity {
  readonly type: 'workspace.sync_refused' | 'workspace.sync_failed' | 'workspace.sync_done'
  readonly level: 'notable' | 'attention'
  readonly summary: string
  readonly detail: string | undefined
}

/** The Activity event for one finished sync; a refusal gets its own type so it never reads as a failed or destructive sync. */
export const workspaceSyncActivity = (view: WorkspaceSyncView): WorkspaceSyncActivity => {
  const outcome = workspaceSyncOutcome(view)
  const detail = view.message ?? undefined
  if (outcome === 'kept')
    return {
      type: 'workspace.sync_refused',
      level: 'attention',
      summary: `${view.workspace} kept as is: sync refused, local work preserved`,
      detail: detail ?? NEXT_STEP_WHEN_KEPT,
    }
  if (outcome === 'up-to-date') return { type: 'workspace.sync_done', level: 'notable', summary: `${view.workspace} already on ${view.bookmark}`, detail }
  if (outcome === 'conflicted')
    return {
      type: 'workspace.sync_failed',
      level: 'attention',
      summary: `${view.workspace} not updated: conflicts in ${view.conflicts.length === 0 ? 'the rebased revisions' : view.conflicts.join(', ')}`,
      detail,
    }
  if (outcome === 'failed')
    return {
      type: 'workspace.sync_failed',
      level: 'attention',
      summary: `${view.workspace} not updated: ${view.message ?? view.status ?? 'unknown error'}`,
      detail,
    }
  const rebuilt = view.pluginsRebuilt.length
  const summary =
    rebuilt === 0 && !view.restartNeeded
      ? `${view.workspace} updated · nothing to rebuild`
      : `${view.workspace} updated · ${String(rebuilt)} plugin${rebuilt === 1 ? '' : 's'} rebuilt · ${view.restartNeeded ? 'restart to apply' : 'applied live'}`
  return { type: 'workspace.sync_done', level: view.restartNeeded ? 'attention' : 'notable', summary, detail }
}
