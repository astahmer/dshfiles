import { z } from 'zod'

const HOUR_MS = 60 * 60_000
const MAX_HISTORY_BUCKETS = 500

export const fastModeUsageObservationSchema = z.object({
  instanceId: z.string().min(1).max(64),
  model: z.string().min(1).max(200),
  serviceTier: z.string().max(32).nullable(),
  responseStatus: z.enum(['completed', 'incomplete']),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheReadTokens: z.number().int().min(0),
})

export type FastModeUsageObservation = z.infer<typeof fastModeUsageObservationSchema>

export const fastModeUsageEventSchema = fastModeUsageObservationSchema.extend({ at: z.number().int().min(0) })
export type FastModeUsageEvent = z.infer<typeof fastModeUsageEventSchema>

export const fastModeUsagePointSchema = z.object({
  at: z.number().int().min(0),
  requests: z.number().int().min(0),
  confirmedFast: z.number().int().min(0),
  returnedDefault: z.number().int().min(0),
  otherTier: z.number().int().min(0),
  unreportedTier: z.number().int().min(0),
  completed: z.number().int().min(0),
  incomplete: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  cacheReadTokens: z.number().int().min(0),
})

export const fastModeUsageHistorySchema = z.object({
  points: z.array(fastModeUsagePointSchema).max(MAX_HISTORY_BUCKETS),
})

export type FastModeUsagePoint = z.infer<typeof fastModeUsagePointSchema>
export type FastModeUsageHistory = z.infer<typeof fastModeUsageHistorySchema>

const categoryOf = (serviceTier: string | null): 'confirmedFast' | 'returnedDefault' | 'otherTier' | 'unreportedTier' => {
  if (serviceTier === null) return 'unreportedTier'
  if (serviceTier === 'fast' || serviceTier === 'priority') return 'confirmedFast'
  if (serviceTier === 'default') return 'returnedDefault'
  return 'otherTier'
}

const emptyPoint = (at: number): FastModeUsagePoint => ({
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
    const buckets = new Map<number, FastModeUsagePoint>()
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
    return fastModeUsageHistorySchema.parse({ points: [...buckets.values()].sort((left, right) => left.at - right.at) })
  }
}
