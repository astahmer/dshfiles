import { Effect, Option, Schema } from 'effect'
import type { CleanupResult, CleanupTarget } from './api.js'
import type { CleanupKind } from './workspace-cleanup.js'

/** Namespace whose `settledSessionIds` field records settled threads; thread-sidebar owns it. */
export const SETTLED_THREADS_NAMESPACE = 'thread-sidebar'

const settledStatusSchema = Schema.Struct({ settledSessionIds: Schema.optional(Schema.Array(Schema.String)) })

const decodeSettledStatus = Schema.decodeUnknownOption(settledStatusSchema)

export const parseSettledStatus = (value: unknown): { readonly settledSessionIds: readonly string[] } => ({
  settledSessionIds: Option.match(decodeSettledStatus(value), { onNone: () => [], onSome: parsed => parsed.settledSessionIds ?? [] }),
})

interface SettleCleanupThread {
  readonly name: string
  readonly sessionIds: readonly string[]
  readonly unlanded: readonly unknown[]
  readonly rebasedAt?: number | undefined
}

interface SettleCleanupRepository {
  readonly repoRoot: string
  readonly threads: readonly SettleCleanupThread[]
}

const newlySettled = (input: { readonly previous: readonly string[]; readonly next: readonly string[] }): readonly string[] => {
  const before = new Set(input.previous)
  return input.next.filter(sessionId => !before.has(sessionId))
}

/**
 * Thread workspaces a settle just finished: one of their threads is in `justSettled`, every thread is settled or
 * archived, and nothing is left to land. The cleanup job still rechecks activity and unlanded work before removing.
 */
const targets = (input: {
  readonly repositories: readonly SettleCleanupRepository[]
  readonly justSettled: readonly string[]
  readonly settled: ReadonlySet<string>
  readonly archived: ReadonlySet<string>
  readonly kinds: readonly CleanupKind[]
}): CleanupTarget[] => {
  const trigger = new Set(input.justSettled)
  const found: CleanupTarget[] = []
  for (const repository of input.repositories) {
    for (const thread of repository.threads) {
      if (thread.sessionIds.length === 0 || thread.unlanded.length > 0) continue
      if (!thread.sessionIds.some(sessionId => trigger.has(sessionId))) continue
      if (!thread.sessionIds.every(sessionId => input.settled.has(sessionId) || input.archived.has(sessionId))) continue
      const kind = thread.rebasedAt === undefined ? 'empty' : 'integrated'
      if (!input.kinds.includes(kind)) continue
      found.push({ repoRoot: repository.repoRoot, name: thread.name, kind })
    }
  }
  return found
}

/** One span per settle: how many threads settled, how many workspaces it targeted and how many were removed. */
const run = Effect.fn('jj-integration settle cleanup')(function* <E, R>(input: {
  readonly justSettled: readonly string[]
  readonly settled: readonly string[]
  readonly kinds: readonly CleanupKind[]
  readonly repositories: Effect.Effect<readonly SettleCleanupRepository[], E, R>
  readonly archived: Effect.Effect<ReadonlySet<string>, E, R>
  readonly remove: (targets: CleanupTarget[]) => Effect.Effect<CleanupResult, E, R>
}) {
  yield* Effect.annotateCurrentSpan({ 'dshx.cleanup.settled': input.justSettled.length })
  const found = targets({
    repositories: yield* input.repositories,
    justSettled: input.justSettled,
    settled: new Set(input.settled),
    archived: yield* input.archived,
    kinds: input.kinds,
  })
  yield* Effect.annotateCurrentSpan({ 'dshx.cleanup.targets': found.length })
  if (found.length === 0) return 0
  const result = yield* input.remove(found)
  const removed = result.workspaces.filter(workspace => workspace.outcome === 'removed').length
  yield* Effect.annotateCurrentSpan({ 'dshx.cleanup.removed': removed })
  return removed
})

export class SettleCleanupModel {
  static readonly run = run
  static readonly newlySettled = newlySettled
  static readonly targets = targets
}
