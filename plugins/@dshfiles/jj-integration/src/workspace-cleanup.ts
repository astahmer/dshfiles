import type { ThreadSessionActivity } from './thread-rebase-eligibility.js'

/**
 * `empty` never landed anything; `integrated` landed at least once and has nothing left above the bookmark, or every
 * revision it holds is already on another bookmark; `merged` is the same with a merged pull request recorded for one of
 * its threads; `secondary` is another checkout of the repository; `untracked` is a threads-directory entry no jj
 * workspace owns.
 */
export type CleanupKind = 'empty' | 'integrated' | 'merged' | 'secondary' | 'untracked'
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
  /** Bookmarks other than the target that each hold all of `unlandedCount`; the work stays safe once the workspace goes. */
  readonly integratedInto?: readonly string[]
  readonly rebasedAt: number | undefined
  readonly sessionIds: readonly string[]
  readonly integrationQueued: boolean
  /** Merged pull requests recorded for this workspace's threads, as `owner/repo#123`: why a landed workspace is merged. */
  readonly mergedPullRequests?: readonly string[]
  readonly secondary?: boolean
  readonly missing?: boolean
  readonly workingCopyState?: 'clean' | 'dirty' | 'unknown' | 'missing'
  /** Every timestamp that says the workspace was used: its working-copy commit, its creation, its lands. */
  readonly usedAt: readonly (number | undefined)[]
}

export type CleanupDecision =
  | { readonly action: 'remove'; readonly kind: WorkspaceKind; readonly lastUsedAt: number }
  | { readonly action: 'skip'; readonly reason: CleanupSkipReason; readonly lastUsedAt: number }

const lastUsedAt = (thread: CleanupThread): number => Math.max(0, ...thread.usedAt.filter(at => at !== undefined))

/**
 * Which idle thread workspaces a cleanup may remove. A workspace with unlanded work is never a candidate unless another
 * bookmark already holds all of it, and a live Session that works, asks or cannot be read keeps its workspace; archived
 * Sessions no longer count.
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
  if (thread.secondary === true && thread.workingCopyState !== 'clean' && thread.workingCopyState !== 'missing') return skip('workspace-state-unknown')
  if (thread.secondary === true && usedAt === 0) return skip('workspace-state-unknown')
  const onAnotherBookmark = (thread.integratedInto?.length ?? 0) > 0
  if (thread.unlandedCount > 0 && !onAnotherBookmark) return skip('has-work')
  if (thread.integrationQueued) return skip('queued')
  const liveSessions = thread.sessionIds.filter(sessionId => !input.archived.has(sessionId))
  for (const sessionId of liveSessions) {
    const activity = input.activity?.get(sessionId)
    if (activity?.running === true || activity?.pendingUserQuestion === true) return skip('busy')
    if (activity?.running === undefined || activity.pendingUserQuestion === undefined) return skip('activity-unknown')
  }
  let kind: WorkspaceKind = 'integrated'
  if (thread.secondary === true) kind = 'secondary'
  else if (thread.rebasedAt === undefined && !onAnotherBookmark) kind = 'empty'
  else if ((thread.mergedPullRequests?.length ?? 0) > 0) kind = 'merged'
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

/**
 * An automatic run has no preview to name a bookmark in, so like `secondary` this stays a manual choice: it never reads
 * them and those workspaces are kept as `has-work`. `merged` needs the same bookmark read plus the merged pull requests,
 * so it is manual only too.
 */
const readsBookmarkedWork = (input: { readonly trigger: 'manual' | 'automatic'; readonly kinds: readonly CleanupKind[] }): boolean =>
  input.trigger === 'manual' && (input.kinds.includes('integrated') || input.kinds.includes('merged'))

/** Why a kept workspace was kept, in the words the cleanup result and the agent tool report. */
const skipReasonMessage = (reason: CleanupSkipReason): string => {
  if (reason === 'has-work') return 'Kept because: it still holds revisions that are not on the bookmark.'
  if (reason === 'busy') return 'Kept because: a thread working in it is running or waiting for an answer.'
  if (reason === 'activity-unknown') return "Kept because: its thread's activity could not be read, so it may be in use."
  if (reason === 'queued') return 'Kept because: an integration is queued for it.'
  if (reason === 'too-recent') return 'Kept because: it was used more recently than the configured age.'
  if (reason === 'kind-excluded') return 'Kept because: its kind is not one this run removes.'
  if (reason === 'working-copy-dirty') return 'Kept because: this checkout has uncommitted changes that are not tracked yet.'
  return 'Kept because: its working-copy state could not be read.'
}

export class WorkspaceCleanupModel {
  static readonly decide = decide
  static readonly skipReasonMessage = skipReasonMessage
  static readonly readsBookmarkedWork = readsBookmarkedWork
  static readonly isStaleUntracked = isStaleUntracked
  static readonly isFinishedWorkspaceReadyToRemove = isFinishedWorkspaceReadyToRemove
}
