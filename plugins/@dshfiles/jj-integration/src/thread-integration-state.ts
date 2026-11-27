import type { ThreadView } from './api.js'
import type { IntegrationJobPhase } from './integration-queue-machine.js'
import type { ThreadRevision } from './thread-workspace-types.js'

const DAY_MS = 86_400_000

/** Placeholder descriptions the Host refuses to integrate, shared so the badge and the guard agree. */
const PLACEHOLDER_DESCRIPTIONS = new Set(['', 'wip'])

/**
 * What the integration control center shows. Eligibility (`ready`, `stale`, `blocked`, `conflicts`, `unknown`) is separate
 * from lifecycle: a finished thread with pending work is still ready, and a workspace that only sits behind the
 * bookmark without pending revisions is `no-changes`, never a blocker.
 */
export type ThreadIntegrationCategory = 'conflicts' | 'ready' | 'stale' | 'blocked' | 'integrating' | 'integrated' | 'no-changes' | 'unknown'

export type ThreadIntegrationBlocker = 'conflict' | 'missing' | 'question' | 'active' | 'description' | 'activity-unknown'

export interface ThreadIntegrationAssessment {
  readonly category: ThreadIntegrationCategory
  /** Every blocker that currently applies, most severe first; the first one is the row's primary explanation. */
  readonly blockers: readonly ThreadIntegrationBlocker[]
  readonly blocker: ThreadIntegrationBlocker | undefined
  readonly pendingRevisions: number
  readonly conflictedRevisions: number
  readonly undescribedRevisions: number
  /** Commits the bookmark has that the workspace lacks; advisory, never a blocker on its own. */
  readonly behindBookmark: number
  /** Described, conflict-free pending work the bookmark moved past and nobody changed for the stale window. */
  readonly stale: boolean
  /** Pending work that still needs a user decision or an integration attempt. */
  readonly needsAttention: boolean
}

const blockedCategory = (blockers: readonly ThreadIntegrationBlocker[]): ThreadIntegrationCategory => {
  const primary = blockers[0]
  if (primary === 'conflict') return 'conflicts'
  if (primary === 'missing' || primary === 'activity-unknown') return 'unknown'
  return 'blocked'
}

const categoryForJob = (phase: IntegrationJobPhase): ThreadIntegrationCategory => {
  if (phase === 'queued' || phase === 'integrating' || phase === 'validating' || phase === 'rebasing') return 'integrating'
  if (phase === 'conflicts') return 'conflicts'
  if (phase === 'needs-description' || phase === 'failed') return 'blocked'
  if (phase === 'integrated') return 'integrated'
  return 'no-changes'
}

const liveCategoryOf = (props: {
  readonly hasPendingWork: boolean
  readonly blockers: readonly ThreadIntegrationBlocker[]
  readonly missing: boolean
  readonly rebasedAt: number | undefined
  readonly stale: boolean
}): ThreadIntegrationCategory => {
  if (props.hasPendingWork) {
    if (props.blockers.length > 0) return blockedCategory(props.blockers)
    return props.stale ? 'stale' : 'ready'
  }
  if (props.missing) return 'unknown'
  if (props.rebasedAt === undefined) return 'no-changes'
  return 'integrated'
}

/**
 * One answer to "what does this workspace need", used by the row, the filter counts and the batch action so they
 * cannot drift. It classifies; it never authorizes an integration — the Host re-checks activity, descriptions and
 * conflicts when the operation runs, and refuses an unsafe one.
 */
export class ThreadIntegrationModel {
  static readonly isPlaceholderRevisionDescription = (description: string): boolean => PLACEHOLDER_DESCRIPTIONS.has(description.trim().toLowerCase())

  /** The newest author time among revisions, epoch ms: when the work itself last changed. */
  static readonly newestRevisionAt = (revisions: readonly Pick<ThreadRevision, 'at'>[]): number | undefined =>
    revisions.reduce<number | undefined>((newest, revision) => {
      if (revision.at === undefined) return newest
      return newest === undefined || revision.at > newest ? revision.at : newest
    }, undefined)

  /**
   * Work has gone cold when the bookmark moved past it and no revision was authored for `afterDays`: landing would
   * rebase abandoned work, so it leaves Ready and the inbox while staying landable one workspace at a time.
   * `afterDays` of 0 disables the rule; a Host that reports no author time never marks work stale.
   */
  static readonly isStale = (input: {
    readonly revisions: readonly Pick<ThreadRevision, 'at'>[]
    readonly behindBookmark: number
    readonly now: number
    readonly afterDays: number
  }): boolean => {
    if (input.afterDays <= 0 || input.behindBookmark <= 0) return false
    const newest = ThreadIntegrationModel.newestRevisionAt(input.revisions)
    if (newest === undefined) return false
    return input.now - newest >= input.afterDays * DAY_MS
  }

  /** Totals over every unlanded revision, whether `unlanded` is the full list or only its newest (`unlandedSummary`). */
  static readonly unlandedTotals = (
    thread: Pick<ThreadView, 'unlanded' | 'unlandedSummary'>,
  ): { readonly total: number; readonly conflicted: number; readonly undescribed: number } =>
    thread.unlandedSummary ?? {
      total: thread.unlanded.length,
      conflicted: thread.unlanded.filter(revision => revision.conflict).length,
      undescribed: thread.unlanded.filter(revision => ThreadIntegrationModel.isPlaceholderRevisionDescription(revision.description)).length,
    }

  /** The newest `limit` unlanded revisions of a thread, with totals over all of them; a thread within the limit is unchanged. */
  static readonly withRevisionLimit = (thread: ThreadView, limit: number): ThreadView =>
    thread.unlanded.length <= limit
      ? thread
      : { ...thread, unlanded: thread.unlanded.slice(0, limit), unlandedSummary: ThreadIntegrationModel.unlandedTotals(thread) }

  /**
   * A workspace nobody ever opened is not finished, and neither is one with an active Session: only every conversation
   * being archived makes a thread inactive. A blank New-thread slot is not a conversation, so it never keeps a thread
   * out of that rule (the app opens one in a workspace and may never prompt it). The finished-thread sweep and the
   * row's lifecycle both read this one rule.
   */
  static readonly isFinishedThread = (sessionIds: readonly string[], archived: ReadonlySet<string>, blank: ReadonlySet<string> = new Set()): boolean => {
    const conversations = sessionIds.filter(sessionId => blank.has(sessionId) !== true)
    return conversations.length > 0 && conversations.every(sessionId => archived.has(sessionId))
  }

  /**
   * One answer to "what does this workspace need", used by the row, the filter counts and the batch action so they
   * cannot drift. It classifies; it never authorizes an integration — the Host re-checks activity, descriptions and
   * conflicts when the operation runs, and refuses an unsafe one.
   */
  static readonly assess = (input: {
    readonly thread: ThreadView
    readonly running: boolean
    readonly waitingForInput: boolean
    /** The Host's verdict for this thread's sessions, merged with the live client view; undefined means unverified. */
    readonly integrationAllowed: boolean | undefined
    readonly jobPhase?: IntegrationJobPhase | undefined
  }): ThreadIntegrationAssessment => {
    const thread = input.thread
    const totals = ThreadIntegrationModel.unlandedTotals(thread)
    const conflictedRevisions = totals.conflicted
    const undescribedRevisions = totals.undescribed
    const pendingRevisions = totals.total
    const behindBookmark = thread.behindCount ?? (thread.behind ? 1 : 0)
    const blockers: ThreadIntegrationBlocker[] = []
    const hasPendingWork = pendingRevisions > 0

    if (hasPendingWork && conflictedRevisions > 0) blockers.push('conflict')
    if (thread.missing) blockers.push('missing')
    if (hasPendingWork) {
      if (input.waitingForInput) blockers.push('question')
      if (input.running) blockers.push('active')
      if (!input.running && !input.waitingForInput && input.integrationAllowed === false) blockers.push('active')
      if (input.integrationAllowed === undefined) blockers.push('activity-unknown')
      if (undescribedRevisions > 0) blockers.push('description')
    }

    const stale = thread.stale === true
    const liveCategory = liveCategoryOf({ hasPendingWork, blockers, missing: thread.missing, rebasedAt: thread.rebasedAt, stale })

    const category = input.jobPhase === undefined ? liveCategory : categoryForJob(input.jobPhase)
    const assessment: ThreadIntegrationAssessment = {
      category,
      blockers,
      blocker: blockers[0],
      pendingRevisions,
      conflictedRevisions,
      undescribedRevisions,
      behindBookmark,
      stale: thread.stale === true,
      needsAttention: category !== 'integrated' && category !== 'no-changes' && category !== 'stale',
    }
    return assessment
  }

  /** The only state a batch integration may enqueue. */
  static readonly canSelectForIntegration = (assessment: ThreadIntegrationAssessment): boolean => assessment.category === 'ready'
}
