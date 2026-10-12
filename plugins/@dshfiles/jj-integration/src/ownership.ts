/**
 * Exclusive-writer decisions for one registered workspace.
 *
 * Pure: every input is passed in, so the whole rule table is testable without a
 * Host, a filesystem, or jj. The Host applies the decision and performs the
 * durable write.
 */

export type OwnershipCode = 'writer-held' | 'writer-fenced' | 'unsafe-workspace' | 'foreign-workspace' | 'protected-path'

export type OwnershipDecision =
  | { readonly kind: 'allow' }
  /** The caller may proceed, but must take the writer lease first. */
  | { readonly kind: 'acquire'; readonly reclaim: boolean }
  | { readonly kind: 'deny'; readonly code: OwnershipCode; readonly reason: string }

export interface WorkspaceOwnershipView {
  readonly workspaceName: string
  /** Only provisioned thread workspaces are enforced; discovered ones are not migrated. */
  readonly isolated: boolean
  /** Recorded as unavailable for new coding work (folded or stale checkout). */
  readonly unsafe: boolean
  readonly writerEpoch: number
  readonly writerLease: {
    readonly sessionId: string
    readonly epoch: number
    readonly heartbeatAt: number
  } | null
  readonly observers: readonly string[]
}

export interface OwnershipQuery {
  readonly workspace: WorkspaceOwnershipView
  readonly sessionId: string
  readonly toolName: string
  /** Lease epoch this session already holds in memory, or null when it holds none. */
  readonly heldEpoch: number | null
  readonly now: number
  readonly staleAfterMs: number
  readonly readOnlyTools: readonly string[]
}

const deny = (code: OwnershipCode, reason: string): OwnershipDecision => ({ kind: 'deny', code, reason })

/**
 * Decide whether one tool call may run against the workspace its Session sits in.
 *
 * Reads never transfer ownership, a stale lease is reclaimable, and a session
 * whose remembered epoch is behind the record has been fenced by a transfer.
 */
export const decideToolCall = (query: OwnershipQuery): OwnershipDecision => {
  const { workspace } = query
  const readOnly = query.readOnlyTools.includes(query.toolName)
  if (workspace.unsafe) {
    return readOnly
      ? { kind: 'allow' }
      : deny(
          'unsafe-workspace',
          `workspace "${workspace.workspaceName}" is quarantined: a folded or stale checkout would rebase the canonical line, so only read-only tools are allowed there`,
        )
  }
  if (!workspace.isolated) return { kind: 'allow' }

  const lease = workspace.writerLease
  if (lease === null) return { kind: 'acquire', reclaim: false }
  if (lease.sessionId === query.sessionId) return { kind: 'allow' }

  if (query.now - lease.heartbeatAt > query.staleAfterMs) return { kind: 'acquire', reclaim: true }

  // A session that lost the lease may keep reading while it is an observer; only
  // writes are refused with the fencing explanation.
  if (readOnly && workspace.observers.includes(query.sessionId)) return { kind: 'allow' }
  const fenced = query.heldEpoch !== null && workspace.writerEpoch > query.heldEpoch
  if (fenced) {
    return deny(
      'writer-fenced',
      `this thread lost ownership of "${workspace.workspaceName}" (epoch ${String(query.heldEpoch)} -> ${String(workspace.writerEpoch)}); stop writing there and move to the workspace you now own`,
    )
  }
  return deny(
    'writer-held',
    `workspace "${workspace.workspaceName}" is owned by another live writer; wait for it to release, take a read-only observer slot, or transfer ownership explicitly`,
  )
}
