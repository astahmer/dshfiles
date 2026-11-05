import type { Effect } from 'effect'
import type { BacklogKind, BacklogStatus } from './item.js'
import type { RemoteBackendError } from './sync-errors.js'
import type { RemoteComment, RemoteIssue, SyncBackendKind, SyncFieldValues } from './sync-model.js'

/** What a new remote issue starts from. */
export interface RemoteIssueDraft {
  readonly title: string
  readonly body: string
  readonly status: BacklogStatus
  readonly kind: BacklogKind
  readonly tags: readonly string[]
}

/** Who the key signs in as, and the team or repository it reaches. */
export interface RemoteConnection {
  readonly account: string
  /** The team key or `owner/repo` in use, with its display name; null when none is set or reachable. */
  readonly target: { readonly key: string; readonly name: string } | null
  /** Every team the key can see (Linear); empty for GitHub. */
  readonly teams: readonly { readonly key: string; readonly name: string }[]
}

/**
 * The sync port: one remote tracker, already bound to its team or repository and its credential. Every method answers
 * in backlog vocabulary, so the sync service never sees GraphQL or REST shapes; tests implement it over a fake server.
 */
export interface RemoteBackend {
  readonly kind: SyncBackendKind
  /** The team key or `owner/repo` this backend serves, for labels and messages. */
  readonly target: string
  /** An issue from a URL, an identifier (`ENG-12`) or a number (`42`); fails with not-found when none matches. */
  readonly resolve: (reference: string) => Effect.Effect<RemoteIssue, RemoteBackendError>
  readonly fetch: (remoteId: string) => Effect.Effect<RemoteIssue, RemoteBackendError>
  readonly create: (draft: RemoteIssueDraft) => Effect.Effect<RemoteIssue, RemoteBackendError>
  /** Writes the given fields and answers the issue as it now is. */
  readonly update: (remoteId: string, change: Readonly<SyncFieldValues>) => Effect.Effect<RemoteIssue, RemoteBackendError>
  readonly comment: (remoteId: string, body: string) => Effect.Effect<RemoteComment, RemoteBackendError>
  /** Reads the signed-in account and the target, writing nothing. */
  readonly connection: Effect.Effect<RemoteConnection, RemoteBackendError>
}
