import type { Effect } from 'effect'
import type { ThreadWorkspaceError } from './errors.js'
import type { IntegrationRecord } from './thread-metadata.js'
import type { ThreadLocation, VcsKind } from './thread-workspace-model.js'

/**
 * The version-control port every thread-workspace flow runs through. `ThreadWorkspaces` routes each call to the
 * backend that owns the path: `JjThreadWorkspaces` for a repository with `.jj` (colocated or not), and
 * `GitThreadWorkspaces` for a git-only checkout. Revisions, outcomes and errors are shared, so the Host APIs, the
 * landing queue and cleanup never name the VCS.
 */

export interface ThreadRevision {
  /** jj: the persistent change id. git: the commit id (git has no identity that survives a rebase). */
  readonly changeId: string
  readonly commitId: string
  readonly description: string
  readonly conflict: boolean
}

export interface ThreadStatus {
  readonly name: string
  readonly path: string
  readonly repoRoot: string
  readonly missing: boolean
  /** Non-empty revisions in the thread that the target bookmark does not contain yet. */
  readonly unlanded: readonly ThreadRevision[]
  /** The target bookmark moved since this thread last rebased. */
  readonly behind: boolean
  /** Revisions the target bookmark has that this workspace lacks. */
  readonly behindCount: number
  /** Timestamp of the latest successful land, persisted beside the thread workspaces. */
  readonly rebasedAt?: number
  /** Change ID of the bookmark tip when this thread last landed. */
  readonly rebasedTipChangeId?: string
  /** Every recorded land, oldest first; the last one matches `rebasedAt`. */
  readonly integrations?: readonly IntegrationRecord[]
}

export type LandOutcome =
  | { readonly status: 'landed'; readonly revisions: readonly ThreadRevision[]; readonly head: ThreadRevision }
  | { readonly status: 'nothing-to-land' }
  | { readonly status: 'needs-description'; readonly revisions: readonly ThreadRevision[] }
  | { readonly status: 'conflicted'; readonly revisions: readonly ThreadRevision[]; readonly files: readonly string[] }

export interface LandCandidate {
  readonly workingCopyCommitId: string
  readonly attempt: number
}

export type LandCandidateVerification =
  | { readonly status: 'passed' }
  | { readonly status: 'failed'; readonly message: string }
  | { readonly status: 'stale'; readonly message: string }
  | { readonly status: 'cancelled' }

export type VerifiedLandOutcome =
  | LandOutcome
  | { readonly status: 'already-integrated'; readonly revisions: readonly ThreadRevision[] }
  | { readonly status: 'patch-equivalent-work'; readonly revisions: readonly ThreadRevision[] }
  | { readonly status: 'patch-equivalence-unavailable'; readonly revisions: readonly ThreadRevision[] }
  | { readonly status: 'detached-work'; readonly revisions: readonly ThreadRevision[] }
  | { readonly status: 'not-eligible' }
  | { readonly status: 'verification-failed'; readonly message: string }
  | { readonly status: 'verification-stale'; readonly message: string }
  | { readonly status: 'verification-cancelled' }

export interface VerifiedLandOptions {
  readonly path: string
  readonly bookmark?: string | undefined
  readonly sessionId?: string | undefined
  readonly expectedSourceRevision: string
  /** Re-read before every step that moves anything; `false` stops the integration as not eligible. */
  readonly authorize: (location: ThreadLocation) => Effect.Effect<boolean>
  readonly verifyCandidate: (candidate: LandCandidate) => Effect.Effect<LandCandidateVerification>
  /** Read between steps; once true the integration stops as `verification-cancelled` before it moves anything else. */
  readonly cancelled?: Effect.Effect<boolean> | undefined
}

export type LandPhase = 'queued' | 'validating' | 'rebasing'

export interface LandAtOptions<E> {
  readonly bookmark?: string | undefined
  readonly sessionId?: string | undefined
  /** Runs inside the repository lock, before the rebase; its failure stops the land. */
  readonly validate?: Effect.Effect<void, E> | undefined
  readonly onProgress?: ((phase: LandPhase) => Effect.Effect<void>) | undefined
}

export interface UntrackedEntry {
  readonly name: string
  readonly path: string
  readonly modifiedAt: number
}

export interface SecondaryWorkspaceStatus {
  readonly name: string
  readonly path: string
  readonly repoRoot: string
  readonly missing: boolean
  readonly unlanded: readonly ThreadRevision[]
  readonly workingCopyState: 'clean' | 'dirty' | 'unknown' | 'missing'
}

export interface SecondaryDiscardResult {
  readonly name: string
  readonly path: string
  readonly status: 'discarded' | 'has-work' | 'error'
  readonly message: string | null
}

export interface ThreadDiscardResult {
  readonly name: string
  readonly status: 'discarded' | 'has-work' | 'error'
  readonly revisions: readonly ThreadRevision[]
  readonly error: string | null
}

export type DiscardOutcome = { readonly status: 'discarded' } | { readonly status: 'has-work'; readonly revisions: readonly ThreadRevision[] }

export type ManagedThread = ThreadLocation & { readonly threadName: string }

/** One VCS backend for thread workspaces. Every method is the same contract whichever backend serves it. */
export interface ThreadWorkspacesBackend {
  readonly vcs: VcsKind
  readonly threadsDirectory: (repoRoot: string) => Effect.Effect<string>
  readonly locate: (target: string) => Effect.Effect<ThreadLocation, ThreadWorkspaceError>
  readonly list: (repoRoot: string) => Effect.Effect<readonly ThreadStatus[], ThreadWorkspaceError>
  readonly status: (repoRoot: string, name: string) => Effect.Effect<ThreadStatus, ThreadWorkspaceError>
  readonly reviewHistory: (input: {
    readonly repoRoot: string
    readonly name: string
  }) => Effect.Effect<{ readonly repoRoot: string; readonly name: string; readonly integrations: readonly IntegrationRecord[] }, ThreadWorkspaceError>
  readonly provision: (
    repoRoot: string,
    base?: string,
    requestedName?: string,
  ) => Effect.Effect<{ readonly name: string; readonly path: string }, ThreadWorkspaceError>
  /** Prepare the next thread workspace in the background; a no-op where the backend has nothing to warm. */
  readonly prewarm: (repoRoot: string, base?: string) => Effect.Effect<void>
  readonly branchPoint: (workspaceRoot: string) => Effect.Effect<string, ThreadWorkspaceError>
  readonly restore: (repoRoot: string, workspacePath: string) => Effect.Effect<void, ThreadWorkspaceError>
  readonly land: <E = never>(target: string, input?: LandAtOptions<E>) => Effect.Effect<LandOutcome, ThreadWorkspaceError | E>
  readonly landAt: <E = never>(thread: ManagedThread, input?: LandAtOptions<E>) => Effect.Effect<LandOutcome, ThreadWorkspaceError | E>
  readonly landVerified: (input: VerifiedLandOptions) => Effect.Effect<VerifiedLandOutcome, ThreadWorkspaceError>
  readonly discard: (input: {
    readonly repoRoot: string
    readonly name: string
    readonly force: boolean
  }) => Effect.Effect<DiscardOutcome, ThreadWorkspaceError>
  readonly discardMany: (input: {
    readonly repoRoot: string
    readonly names: readonly string[]
    readonly force: boolean
    /** Also remove a workspace whose work another bookmark holds, rechecked under the repository lock. */
    readonly acceptBookmarkedWork?: boolean
  }) => Effect.Effect<{ readonly results: readonly ThreadDiscardResult[] }, ThreadWorkspaceError>
  /**
   * Bookmarks (git: branches) other than the target that each hold all of the thread's unlanded work, sorted; empty when
   * nothing is unlanded or no single one holds it. Uncommitted edits count as work no bookmark holds.
   */
  readonly containingBookmarks: (input: { readonly repoRoot: string; readonly name: string }) => Effect.Effect<readonly string[], ThreadWorkspaceError>
  readonly secondaryWorkspaces: (repoRoot: string) => Effect.Effect<readonly SecondaryWorkspaceStatus[], ThreadWorkspaceError>
  readonly discardSecondaryMany: (input: {
    readonly repoRoot: string
    readonly workspaces: readonly { readonly name: string; readonly path: string; readonly missing: boolean }[]
  }) => Effect.Effect<{ readonly results: readonly SecondaryDiscardResult[] }, ThreadWorkspaceError>
  /** When each workspace's working copy last changed, in epoch milliseconds, keyed by workspace name. */
  readonly workingCopyChangedAt: (repoRoot: string) => Effect.Effect<ReadonlyMap<string, number>, ThreadWorkspaceError>
  /** Empty, undescribed revisions nothing builds on; always none where the VCS has no such revisions. */
  readonly danglingEmptyRevisions: (input: {
    readonly repoRoot: string
    readonly abandon: boolean
  }) => Effect.Effect<readonly ThreadRevision[], ThreadWorkspaceError>
  readonly untrackedEntries: (repoRoot: string) => Effect.Effect<readonly UntrackedEntry[], ThreadWorkspaceError>
  readonly removeUntrackedEntry: (input: { readonly repoRoot: string; readonly name: string }) => Effect.Effect<void, ThreadWorkspaceError>
  /** Local bookmarks (git: branches), and the nearest one the workspace at `path` builds on. */
  readonly bookmarks: (target: string) => Effect.Effect<{ readonly current: string | null; readonly names: readonly string[] }, ThreadWorkspaceError>
  readonly workingCopyCommitId: (target: string) => Effect.Effect<string, ThreadWorkspaceError>
  /** Record the workspace's files and return an opaque token `restoreFiles` accepts; moves nothing. */
  readonly snapshotFiles: (target: string) => Effect.Effect<string, ThreadWorkspaceError>
  /** Put the workspace's files back to a snapshot; returns a snapshot of what they were. */
  readonly restoreFiles: (target: string, snapshot: string) => Effect.Effect<string, ThreadWorkspaceError>
  readonly revisionGraph: (target: string) => Effect.Effect<string, ThreadWorkspaceError>
}
