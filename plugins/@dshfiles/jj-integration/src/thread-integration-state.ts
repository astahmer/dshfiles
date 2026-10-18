import type { ThreadView } from './api.js'
import type { IntegrationJobPhase } from './integration-queue-machine.js'

/** Placeholder descriptions the Host refuses to integrate, shared so the badge and the guard agree. */
const PLACEHOLDER_DESCRIPTIONS = new Set(['', 'wip'])

/**
 * What the integration control center shows. Eligibility (`ready`, `blocked`, `conflicts`, `unknown`) is separate
 * from lifecycle: a finished thread with pending work is still ready, and a workspace that only sits behind the
 * bookmark without pending revisions is `no-changes`, never a blocker.
 */
export type ThreadIntegrationCategory = 'conflicts' | 'ready' | 'blocked' | 'integrating' | 'integrated' | 'no-changes' | 'unknown'

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

/**
 * One answer to "what does this workspace need", used by the row, the filter counts and the batch action so they
 * cannot drift. It classifies; it never authorizes an integration — the Host re-checks activity, descriptions and
 * conflicts when the operation runs, and refuses an unsafe one.
 */
export class ThreadIntegrationModel {
  static readonly isPlaceholderRevisionDescription = (description: string): boolean => PLACEHOLDER_DESCRIPTIONS.has(description.trim().toLowerCase())

  /**
   * A workspace nobody ever opened is not finished, and neither is one with an active Session: only every Session being
   * archived makes a thread inactive. The finished-thread sweep and the row's lifecycle both read this one rule.
   */
  static readonly isFinishedThread = (sessionIds: readonly string[], archived: ReadonlySet<string>): boolean =>
    sessionIds.length > 0 && sessionIds.every(sessionId => archived.has(sessionId))

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
    const conflictedRevisions = thread.unlanded.filter(revision => revision.conflict).length
    const undescribedRevisions = thread.unlanded.filter(revision => ThreadIntegrationModel.isPlaceholderRevisionDescription(revision.description)).length
    const pendingRevisions = thread.unlanded.length
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

    const liveCategory: ThreadIntegrationCategory = hasPendingWork
      ? blockers.length === 0
        ? 'ready'
        : blockedCategory(blockers)
      : thread.missing
        ? 'unknown'
        : thread.rebasedAt === undefined
          ? 'no-changes'
          : 'integrated'

    const category = input.jobPhase === undefined ? liveCategory : categoryForJob(input.jobPhase)
    const assessment: ThreadIntegrationAssessment = {
      category,
      blockers,
      blocker: blockers[0],
      pendingRevisions,
      conflictedRevisions,
      undescribedRevisions,
      behindBookmark,
      needsAttention: category !== 'integrated' && category !== 'no-changes',
    }
    return assessment
  }

  /** The only state a batch integration may enqueue. */
  static readonly canSelectForIntegration = (assessment: ThreadIntegrationAssessment): boolean => assessment.category === 'ready'
}
