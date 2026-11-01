import * as Schema from 'effect/Schema'
import { AiAccountsSchema } from './effect-schema.js'

const HOUR_MS = 60 * 60_000
const MAX_HISTORY_BUCKETS = 500

const tokenCount = Schema.Number.check(Schema.isFinite(), Schema.isInt(), Schema.isGreaterThanOrEqualTo(0))

export const fastModeUsageObservationSchema = Schema.Struct({
  instanceId: AiAccountsSchema.id(64),
  model: AiAccountsSchema.id(200),
  serviceTier: Schema.NullOr(Schema.String.check(Schema.isMaxLength(32))),
  responseStatus: Schema.Literals(['completed', 'incomplete']),
  inputTokens: tokenCount,
  outputTokens: tokenCount,
  cacheReadTokens: tokenCount,
})

export type FastModeUsageObservation = typeof fastModeUsageObservationSchema.Type

export const fastModeUsageEventSchema = Schema.Struct({ ...fastModeUsageObservationSchema.fields, at: tokenCount })
export type FastModeUsageEvent = typeof fastModeUsageEventSchema.Type

const fastModeUsagePointSchema = Schema.Struct({
  at: tokenCount,
  requests: tokenCount,
  confirmedFast: tokenCount,
  returnedDefault: tokenCount,
  otherTier: tokenCount,
  unreportedTier: tokenCount,
  completed: tokenCount,
  incomplete: tokenCount,
  inputTokens: tokenCount,
  outputTokens: tokenCount,
  cacheReadTokens: tokenCount,
})

export const fastModeUsageHistorySchema = Schema.Struct({
  points: AiAccountsSchema.list(fastModeUsagePointSchema, MAX_HISTORY_BUCKETS),
})

export type FastModeUsagePoint = typeof fastModeUsagePointSchema.Type
export type FastModeUsageHistory = typeof fastModeUsageHistorySchema.Type

type MutablePoint = { -readonly [Key in keyof FastModeUsagePoint]: FastModeUsagePoint[Key] }

const categoryOf = (serviceTier: string | null): 'confirmedFast' | 'returnedDefault' | 'otherTier' | 'unreportedTier' => {
  if (serviceTier === null) return 'unreportedTier'
  if (serviceTier === 'fast' || serviceTier === 'priority') return 'confirmedFast'
  if (serviceTier === 'default') return 'returnedDefault'
  return 'otherTier'
}

const emptyPoint = (at: number): MutablePoint => ({
  at,
  requests: 0,
  confirmedFast: 0,
  returnedDefault: 0,
  otherTier: 0,
  unreportedTier: 0,
  completed: 0,
  incomplete: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
})

export class FastModeUsageModel {
  static readonly maxBuckets = MAX_HISTORY_BUCKETS

  static bucketWidth = (since: number, now: number): number => {
    const span = Math.max(HOUR_MS, now - since)
    const hoursPerBucket = Math.max(1, Math.ceil(span / (MAX_HISTORY_BUCKETS * HOUR_MS)))
    return hoursPerBucket * HOUR_MS
  }

  static aggregate = (events: readonly FastModeUsageEvent[], bucketWidthMs: number): FastModeUsageHistory => {
    const buckets = new Map<number, MutablePoint>()
    for (const event of events) {
      const at = Math.floor(event.at / bucketWidthMs) * bucketWidthMs
      const point = buckets.get(at) ?? emptyPoint(at)
      point.requests += 1
      point[categoryOf(event.serviceTier)] += 1
      point[event.responseStatus] += 1
      point.inputTokens += event.inputTokens
      point.outputTokens += event.outputTokens
      point.cacheReadTokens += event.cacheReadTokens
      buckets.set(at, point)
    }
    return AiAccountsSchema.decode(fastModeUsageHistorySchema, {
      points: [...buckets.values()].sort((left, right) => left.at - right.at),
    })
  }
}
