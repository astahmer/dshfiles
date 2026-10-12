import { resolve } from 'node:path'
import type { WorkspaceRecord } from './types.js'

/**
 * Automatic cleanup decisions for provisioned thread workspaces.
 *
 * Pure: every input is passed in, so the whole rule table is testable without a
 * Host, a filesystem or jj. The service performs the checks that need jj and
 * applies the decision; it never deletes on a rule this module did not clear.
 *
 * The rule that matters most is what is NOT here: cleanup removes a registration
 * and a disposable directory, and nothing else. It never abandons a revision,
 * moves a bookmark, or touches a workspace that holds work nobody has taken.
 */

export type CleanupCode =
  | 'disabled'
  | 'not-isolated'
  | 'pinned'
  | 'missing'
  | 'quarantined'
  | 'pending-integration'
  | 'lifecycle'
  | 'attached'
  | 'leased'
  | 'observed'
  | 'uncommitted'
  | 'unique-revisions'
  | 'too-young'

export interface CleanupDecision {
  /** `eligible`: past the delete age and clear of every protection. `idle`: idle, but not yet old enough. */
  readonly kind: 'eligible' | 'idle' | 'skip'
  readonly code: CleanupCode | 'ok'
  readonly detail: string
}

export interface CleanupPolicy {
  readonly enabled: boolean
  readonly idleAfterMs: number
  readonly deleteAfterMs: number
  /** Report the same entries and remove nothing. */
  readonly dryRun: boolean
}

export interface CleanupInputs {
  readonly workspace: Pick<
    WorkspaceRecord,
    'name' | 'isolated' | 'pinned' | 'lifecycle' | 'missing' | 'writerLease' | 'observers' | 'lastActivityAt' | 'owners'
  >
  readonly now: number
  readonly policy: CleanupPolicy
  /** A candidate for this workspace that has not reached a terminal state. */
  readonly pendingIntegration: boolean
  /** The guard records this workspace as unavailable for new work. */
  readonly quarantined: boolean
  /** The working copy has changes that were never committed. */
  readonly uncommitted: boolean
  /** The workspace holds revisions that are not on the canonical spine. */
  readonly uniqueRevisions: boolean
}

const skip = (code: CleanupCode, detail: string): CleanupDecision => ({ kind: 'skip', code, detail })

export const decideCleanup = (input: CleanupInputs): CleanupDecision => {
  const { workspace, policy, now } = input
  if (!policy.enabled) return skip('disabled', 'automatic workspace cleanup is disabled')
  if (!workspace.isolated) return skip('not-isolated', 'only workspaces this plugin provisioned are ever removed')
  if (workspace.pinned) return skip('pinned', 'pinned by the operator')
  if (workspace.missing) return skip('missing', 'the directory is already gone; the registration is left for the operator')
  if (input.quarantined) return skip('quarantined', 'recorded as unavailable for new work')
  // Before the lifecycle, so a ready workspace with an open candidate reports
  // the thing the operator can act on rather than the state it implies.
  if (input.pendingIntegration) return skip('pending-integration', 'an integration candidate is still open')
  if (workspace.lifecycle === 'ready' || workspace.lifecycle === 'integrating' || workspace.lifecycle === 'blocked') {
    return skip('lifecycle', `lifecycle is ${workspace.lifecycle}`)
  }
  if (workspace.writerLease !== null) return skip('leased', `writer lease held by ${workspace.writerLease.sessionId}`)
  if (workspace.observers.length > 0) return skip('observed', `${String(workspace.observers.length)} observer(s) attached`)
  if (workspace.owners.some(owner => owner.detachedAt === null)) return skip('attached', 'a Session is still attached')
  if (input.uncommitted) return skip('uncommitted', 'the working copy has uncommitted changes')
  if (input.uniqueRevisions) return skip('unique-revisions', 'it holds revisions that are not on the canonical spine')

  const age = now - workspace.lastActivityAt
  if (age < policy.idleAfterMs) return skip('too-young', `last activity ${describeAge(age)} ago`)
  if (age < policy.deleteAfterMs) return { kind: 'idle', code: 'ok', detail: `idle for ${describeAge(age)}` }
  return { kind: 'eligible', code: 'ok', detail: `idle for ${describeAge(age)}` }
}

export const describeAge = (milliseconds: number): string => {
  const hours = Math.floor(milliseconds / 3_600_000)
  if (hours < 1) return `${String(Math.max(0, Math.floor(milliseconds / 60_000)))}m`
  if (hours < 48) return `${String(hours)}h`
  return `${String(Math.floor(hours / 24))}d`
}

/**
 * A directory cleanup may delete: a thread workspace beside the repository,
 * never the repository checkout itself, never anything inside it, and never a
 * parent of it. This is the last guard before `rm`, so it is deliberately
 * independent of every other rule.
 */
export const isDisposableWorkspacePath = (path: string, repositoryRoot: string): boolean => {
  const candidate = resolve(path)
  const root = resolve(repositoryRoot)
  if (candidate === root) return false
  if (candidate.startsWith(`${root}/`)) return false
  if (root.startsWith(`${candidate}/`)) return false
  return candidate.split('/').filter(segment => segment.length > 0).length > 1
}

export const daysToMs = (days: number): number => Math.max(0, days) * 86_400_000
