import type { ThreadView } from './api.js'

export type ThreadIntegrationState = 'ready' | 'conflicts' | 'waiting' | 'up-to-date'

export const threadIntegrationState = (thread: ThreadView): ThreadIntegrationState => {
  if (thread.unlanded.some(revision => revision.conflict)) return 'conflicts'
  if (thread.missing) return 'waiting'
  if (thread.unlanded.length === 0) return thread.behind ? 'waiting' : 'up-to-date'
  if (thread.missing || thread.canRebase !== true) return 'waiting'
  if (thread.unlanded.some(revision => revision.description.trim().length === 0 || revision.description.trim().toLowerCase() === 'wip')) return 'waiting'
  return 'ready'
}

export const threadIntegrationBlockReason = (input: {
  readonly thread: ThreadView
  readonly sessionRunning: boolean
  readonly sessionWaitingForInput: boolean
  readonly sessionActivityUnknown: boolean
  readonly state: ThreadIntegrationState
}): 'missing' | 'conflicts' | 'active' | 'question' | 'description' | 'behind' | 'activity-unknown' | undefined => {
  if (input.state === 'conflicts') return 'conflicts'
  if (input.thread.missing) return 'missing'
  if (input.thread.unlanded.length === 0) return input.thread.behind ? 'behind' : undefined
  if (input.sessionWaitingForInput) return 'question'
  if (input.sessionRunning || input.thread.canRebase === false) return 'active'
  if (input.sessionActivityUnknown || input.thread.canRebase === undefined) return 'activity-unknown'
  if (input.thread.unlanded.some(revision => revision.description.trim().length === 0 || revision.description.trim().toLowerCase() === 'wip'))
    return 'description'
  if (input.thread.behind && input.thread.unlanded.length === 0) return 'behind'
  return undefined
}
