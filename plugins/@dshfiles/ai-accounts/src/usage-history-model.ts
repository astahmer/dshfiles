import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { AiAccountsSchema } from './effect-schema.js'
import { extraUsageSchema } from './extra-usage-schema.js'

export const MAX_USAGE_HISTORY_POINTS = 5_000

const timestamp = Schema.Number.check(Schema.isFinite())
const windowKeys = Schema.Record(Schema.String.check(Schema.isMaxLength(32)), timestamp)

export const quotaSnapshotSchema = Schema.Struct({
  at: timestamp,
  instanceId: AiAccountsSchema.id(64),
  windows: windowKeys,
  resetsAt: windowKeys,
  bankedResets: AiAccountsSchema.intBetween(0, 20),
  /** Missing on older persisted snapshots. */
  bankedResetExpiries: Schema.optional(AiAccountsSchema.list(Schema.NullOr(timestamp), 20)),
  /** Claude pay-as-you-go spend at this reading; missing on older snapshots and other providers. */
  extraUsage: Schema.optional(extraUsageSchema),
})

export const usageMetaSchema = Schema.Struct({
  lastReadAt: Schema.NullOr(timestamp).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  lastAttemptAt: Schema.NullOr(timestamp).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  intervalMinutes: AiAccountsSchema.intBetween(1, 60).pipe(Schema.withDecodingDefaultKey(Effect.succeed(5))),
  retentionDays: AiAccountsSchema.intBetween(1, 365).pipe(Schema.withDecodingDefaultKey(Effect.succeed(90))),
})

export const usageHistoryPointSchema = Schema.Struct({
  at: quotaSnapshotSchema.fields.at,
  windows: quotaSnapshotSchema.fields.windows,
  resetsAt: quotaSnapshotSchema.fields.resetsAt,
  bankedResets: quotaSnapshotSchema.fields.bankedResets,
  bankedResetExpiries: quotaSnapshotSchema.fields.bankedResetExpiries,
  extraUsage: quotaSnapshotSchema.fields.extraUsage,
})

export type QuotaSnapshot = typeof quotaSnapshotSchema.Type
export type UsageMeta = typeof usageMetaSchema.Type
export type UsageHistoryPoint = typeof usageHistoryPointSchema.Type
export type UsageHistorySettings = Partial<Pick<UsageMeta, 'intervalMinutes' | 'retentionDays'>>
