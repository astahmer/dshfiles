import { secretCredentialLabelSchemaEffect } from '@dshfiles/credential-port/effect'
import * as Schema from 'effect/Schema'

export const JEV_INPUT_USD_PER_MILLION = 0.042

export const JEV_USAGE_SOURCES = ['backlog', 'memory'] as const
export const JEV_USAGE_OUTCOMES = ['success', 'failure'] as const

export const jevUsageSourceSchema = Schema.Literals(JEV_USAGE_SOURCES)
export const jevCredentialLabelSchema = Schema.Union([secretCredentialLabelSchemaEffect, Schema.Literals(['Legacy / unknown', 'Other credentials'])])
export const jevUsageOutcomeSchema = Schema.Literals(JEV_USAGE_OUTCOMES)

export const jevUsageRecordSchema = Schema.Struct({
  requestId: Schema.String.check(Schema.isUUID()),
  source: jevUsageSourceSchema,
  credential: jevCredentialLabelSchema,
  startedAt: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  durationMs: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(60 * 60_000)),
  outcome: jevUsageOutcomeSchema,
  inputTokens: Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1_000_000))),
  outputTokens: Schema.NullOr(Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0), Schema.isLessThanOrEqualTo(1_000_000))),
})

export const jevUsageQuerySchema = Schema.Struct({
  from: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
  to: Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThan(0)),
}).check(Schema.makeFilter(range => (range.to > range.from ? true : 'The end of the range must be after the start.')))

const nonNegativeCount = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))
const nonNegativeAmount = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0))

const jevUsageBreakdownSchema = Schema.Struct({
  credential: jevCredentialLabelSchema,
  backlogCalls: nonNegativeCount,
  memoryCalls: nonNegativeCount,
  calls: nonNegativeCount,
  succeeded: nonNegativeCount,
  failed: nonNegativeCount,
  inputTokens: nonNegativeCount,
  outputTokens: nonNegativeCount,
  callsWithoutInputUsage: nonNegativeCount,
  estimatedCostUsd: nonNegativeAmount,
})

export const jevUsageViewSchema = Schema.Struct({
  calls: nonNegativeCount,
  succeeded: nonNegativeCount,
  failed: nonNegativeCount,
  inputTokens: nonNegativeCount,
  outputTokens: nonNegativeCount,
  callsWithoutInputUsage: nonNegativeCount,
  estimatedCostUsd: nonNegativeAmount,
  byCredential: Schema.Array(jevUsageBreakdownSchema).check(Schema.isMaxLength(20)),
})

export type JevUsageRecord = typeof jevUsageRecordSchema.Type
export type JevUsageQuery = typeof jevUsageQuerySchema.Type
export type JevUsageBreakdown = typeof jevUsageBreakdownSchema.Type
export type JevUsageView = typeof jevUsageViewSchema.Type
