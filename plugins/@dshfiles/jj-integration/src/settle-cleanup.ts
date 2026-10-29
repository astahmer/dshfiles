import { withSpan } from '@dshfiles/dshx/tracing'
import { z } from 'zod'
import type { CleanupResult, CleanupTarget } from './api.js'
import type { CleanupKind } from './workspace-cleanup.js'

/** Namespace whose `settledSessionIds` field records settled threads; thread-sidebar owns it. */
export const SETTLED_THREADS_NAMESPACE = 'thread-sidebar'

/** Decodes the settings document; an unknown shape reads as none settled. */
export const settledStatusSchema = z.object({ settledSessionIds: z.array(z.string()).catch([]) }).catch({ settledSessionIds: [] })

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
const run = (input: {
  readonly justSettled: readonly string[]
  readonly settled: readonly string[]
  readonly kinds: readonly CleanupKind[]
  readonly repositories: () => Promise<readonly SettleCleanupRepository[]>
  readonly archived: () => ReadonlySet<string>
  readonly remove: (targets: CleanupTarget[]) => Promise<CleanupResult>
}): Promise<number> =>
  withSpan('jj-integration settle cleanup', { attributes: { 'dshx.cleanup.settled': input.justSettled.length } }, async span => {
    const found = targets({
      repositories: await input.repositories(),
      justSettled: input.justSettled,
      settled: new Set(input.settled),
      archived: input.archived(),
      kinds: input.kinds,
    })
    span.setAttributes({ 'dshx.cleanup.targets': found.length })
    if (found.length === 0) return 0
    const result = await input.remove(found)
    const removed = result.workspaces.filter(workspace => workspace.outcome === 'removed').length
    span.setAttributes({ 'dshx.cleanup.removed': removed })
    return removed
  })

export class SettleCleanupModel {
  static readonly run = run
  static readonly newlySettled = newlySettled
  static readonly targets = targets
}
