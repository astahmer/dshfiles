import type { ApiCaller } from '@dshfiles/dshx/api'
import { Effect } from 'effect'
import { JevCallerRejected } from './errors.js'
import type { JevUsageRecord } from './jev-usage.js'
import { UsageRepo } from './store.js'

const jevSourceOf = (caller: ApiCaller, source: JevUsageRecord['source']): boolean => caller.kind === 'plugin' && caller.packageId === `@dshfiles/${source}`

/** Only the plugin a Jev record names (backlog or memory) may record it; nothing is persisted otherwise. */
export const recordJevUsage = Effect.fn('usage jev record')(function* (input: { readonly record: JevUsageRecord; readonly caller: ApiCaller }) {
  if (!jevSourceOf(input.caller, input.record.source)) return yield* new JevCallerRejected({ source: input.record.source })
  const repo = yield* UsageRepo
  yield* repo.recordJevUsage(input.record)
  return { accepted: true as const }
})
