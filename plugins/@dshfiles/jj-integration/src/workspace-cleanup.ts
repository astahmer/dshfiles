import type { ThreadSessionActivity } from './thread-rebase-eligibility.js'

/** `empty` never landed anything; `integrated` landed at least once and has nothing left above the bookmark. */
export type CleanupKind = 'empty' | 'integrated'

export type CleanupSkipReason = 'has-work' | 'busy' | 'activity-unknown' | 'queued' | 'too-recent' | 'kind-excluded'

export interface CleanupThread {
  readonly name: string
  readonly unlandedCount: number
  readonly rebasedAt: number | undefined
  readonly sessionIds: readonly string[]
  readonly integrationQueued: boolean
  /** Every timestamp that says the workspace was used: its working-copy commit, its creation, its lands. */
  readonly usedAt: readonly (number | undefined)[]
}

export type CleanupDecision =
  | { readonly action: 'remove'; readonly kind: CleanupKind; readonly lastUsedAt: number }
  | { readonly action: 'skip'; readonly reason: CleanupSkipReason; readonly lastUsedAt: number }

const lastUsedAt = (thread: CleanupThread): number => Math.max(0, ...thread.usedAt.filter(at => at !== undefined))

/**
 * Which idle thread workspaces a cleanup may remove. A workspace with unlanded work is never a candidate, and a live
 * Session that works, asks or cannot be read keeps its workspace; archived Sessions no longer count.
 */
const decide = (input: {
  readonly thread: CleanupThread
  readonly archived: ReadonlySet<string>
  readonly activity: ReadonlyMap<string, ThreadSessionActivity> | undefined
  readonly now: number
  readonly olderThanMs: number
  readonly kinds: readonly CleanupKind[]
}): CleanupDecision => {
  const thread = input.thread
  const usedAt = lastUsedAt(thread)
  const skip = (reason: CleanupSkipReason): CleanupDecision => ({ action: 'skip', reason, lastUsedAt: usedAt })
  if (thread.unlandedCount > 0) return skip('has-work')
  if (thread.integrationQueued) return skip('queued')
  const liveSessions = thread.sessionIds.filter(sessionId => !input.archived.has(sessionId))
  for (const sessionId of liveSessions) {
    const activity = input.activity?.get(sessionId)
    if (activity?.running === true || activity?.pendingUserQuestion === true) return skip('busy')
    if (activity?.running === undefined || activity.pendingUserQuestion === undefined) return skip('activity-unknown')
  }
  const kind: CleanupKind = thread.rebasedAt === undefined ? 'empty' : 'integrated'
  if (!input.kinds.includes(kind)) return skip('kind-excluded')
  if (input.now - usedAt < input.olderThanMs) return skip('too-recent')
  return { action: 'remove', kind, lastUsedAt: usedAt }
}

export class WorkspaceCleanupModel {
  static readonly decide = decide
}
