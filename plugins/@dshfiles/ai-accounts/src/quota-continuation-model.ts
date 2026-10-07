import { z } from 'zod'

export const quotaContinuationStateSchema = z.enum(['waiting', 'queued', 'invalidated', 'completed'])

export const quotaContinuationRecordSchema = z
  .object({
    continuationId: z.string().uuid(),
    sessionId: z.string().trim().min(1).max(256),
    accountId: z.string().trim().min(1).max(64),
    failedSeq: z.number().int().safe().nonnegative(),
    failedAt: z.number().int().safe().nonnegative(),
    resetAt: z.number().int().safe().nonnegative().nullable(),
    snoozedUntil: z.number().int().safe().nonnegative().nullable(),
    scheduleId: z.string().trim().min(1).max(128).nullable(),
    queueSource: z.enum(['manual', 'schedule']).nullable(),
    state: quotaContinuationStateSchema,
  })
  .strict()

export type QuotaContinuationRecord = z.infer<typeof quotaContinuationRecordSchema>

export const quotaContinuationSummarySchema = z
  .object({
    continuationId: z.string().uuid(),
    sessionId: z.string().trim().min(1).max(256),
    accountId: z.string().trim().min(1).max(64),
    failedAt: z.number().int().safe().nonnegative(),
    resetAt: z.number().int().safe().nonnegative().nullable(),
    snoozedUntil: z.number().int().safe().nonnegative().nullable(),
  })
  .extend({
    state: z.enum(['waiting', 'queued']),
    scheduled: z.boolean(),
    ready: z.boolean(),
  })

export type QuotaContinuationSummary = z.infer<typeof quotaContinuationSummarySchema>
