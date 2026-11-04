import * as Schema from 'effect/Schema'

const moneySchema = Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0)))

/**
 * Pay-as-you-go spend past the plan's windows (Claude "extra usage"), in the currency's major unit. Absent when the
 * provider reports none; `monthlyLimit` null means no cap was reported; `resetsAt` null when no reset is reported.
 */
export const extraUsageSchema = Schema.Struct({
  enabled: Schema.Boolean,
  used: moneySchema,
  monthlyLimit: moneySchema,
  currency: Schema.String.check(Schema.isMaxLength(8)),
  /** Percent of the cap spent as the provider reports it, or derived from used/cap. */
  percentUsed: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
  resetsAt: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
})
export type ExtraUsage = typeof extraUsageSchema.Type
