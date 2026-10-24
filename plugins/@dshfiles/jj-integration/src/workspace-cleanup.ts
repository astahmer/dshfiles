import type { ThreadSessionActivity } from './thread-rebase-eligibility.js'

/**
 * `empty` never landed anything; `integrated` landed at least once and has nothing left above the bookmark;
 * `untracked` is a threads-directory entry no jj workspace owns.
 */
export type CleanupKind = 'empty' | 'integrated' | 'secondary' | 'untracked'
type WorkspaceKind = Exclude<CleanupKind, 'untracked'>

export type CleanupSkipReason =
  | 'has-work'
  | 'busy'
  | 'activity-unknown'
  | 'queued'
  | 'too-recent'
  | 'kind-excluded'
  | 'working-copy-dirty'
  | 'workspace-state-unknown'

export interface CleanupThread {
  readonly name: string
  readonly unlandedCount: number
  readonly rebasedAt: number | undefined
  readonly sessionIds: readonly string[]
  readonly integrationQueued: boolean
  readonly secondary?: boolean
  readonly workingCopyState?: 'clean' | 'dirty' | 'unknown'
  /** Every timestamp that says the workspace was used: its working-copy commit, its creation, its lands. */
  readonly usedAt: readonly (number | undefined)[]
}

export type CleanupDecision =
  | { readonly action: 'remove'; readonly kind: WorkspaceKind; readonly lastUsedAt: number }
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
  if (thread.secondary === true && thread.workingCopyState === 'dirty') return skip('working-copy-dirty')
  if (thread.secondary === true && thread.workingCopyState !== 'clean') return skip('workspace-state-unknown')
  if (thread.secondary === true && usedAt === 0) return skip('workspace-state-unknown')
  if (thread.unlandedCount > 0) return skip('has-work')
  if (thread.integrationQueued) return skip('queued')
  const liveSessions = thread.sessionIds.filter(sessionId => !input.archived.has(sessionId))
  for (const sessionId of liveSessions) {
    const activity = input.activity?.get(sessionId)
    if (activity?.running === true || activity?.pendingUserQuestion === true) return skip('busy')
    if (activity?.running === undefined || activity.pendingUserQuestion === undefined) return skip('activity-unknown')
  }
  const kind: WorkspaceKind = thread.secondary === true ? 'secondary' : thread.rebasedAt === undefined ? 'empty' : 'integrated'
  if (!input.kinds.includes(kind)) return skip('kind-excluded')
  if (input.now - usedAt < input.olderThanMs) return skip('too-recent')
  return { action: 'remove', kind, lastUsedAt: usedAt }
}

/** A folder can sit unregistered for a moment while a workspace is created, so a younger one is never untracked. */
const UNTRACKED_MIN_AGE_MS = 60 * 60_000

const isFinishedWorkspaceReadyToRemove = (input: {
  readonly finished: boolean
  readonly unlandedCount: number
  readonly rebasedAt: number | undefined
  readonly now: number
  readonly graceMs: number
}): boolean => input.finished && input.unlandedCount === 0 && input.rebasedAt !== undefined && input.now - input.rebasedAt >= input.graceMs

const isStaleUntracked = (input: {
  readonly modifiedAt: number
  readonly now: number
  readonly olderThanMs: number
  readonly kinds: readonly CleanupKind[]
}): boolean => input.kinds.includes('untracked') && input.now - input.modifiedAt >= Math.max(input.olderThanMs, UNTRACKED_MIN_AGE_MS)

export class WorkspaceCleanupModel {
  static readonly decide = decide
  static readonly isStaleUntracked = isStaleUntracked
  static readonly isFinishedWorkspaceReadyToRemove = isFinishedWorkspaceReadyToRemove
}
