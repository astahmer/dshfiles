import { z } from 'zod'

const quotaContinuationStateSchema = z.enum(['waiting', 'queued', 'invalidated', 'completed'])

export const quotaContinuationRecordSchema = z
  .object({
    continuationId: z.string().uuid(),
    sessionId: z.string().trim().min(1).max(256),
    accountId: z.string().trim().min(1).max(64),
    failedProvider: z.string().min(1).max(200).optional(),
    failedModel: z.string().min(1).max(200).optional(),
    failedSeq: z.number().int().safe().nonnegative(),
    failedAt: z.number().int().safe().nonnegative(),
    resetAt: z.number().int().safe().nonnegative().nullable(),
    autoRetry: z.boolean().default(false),
    /** `user` once someone ticked or unticked this recovery, so its choice carries to the thread's next failure. */
    autoRetrySource: z.enum(['user', 'default']).optional(),
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
    title: z.string().trim().min(1).max(512).optional(),
    cwd: z.string().trim().min(1).max(4096).optional(),
    failedProvider: z.string().min(1).max(200).optional(),
    failedModel: z.string().min(1).max(200).optional(),
    failedAt: z.number().int().safe().nonnegative(),
    resetAt: z.number().int().safe().nonnegative().nullable(),
    autoRetry: z.boolean().catch(false),
    snoozedUntil: z.number().int().safe().nonnegative().nullable(),
  })
  .extend({
    state: z.enum(['waiting', 'queued']),
    scheduled: z.boolean(),
    ready: z.boolean(),
  })

export type QuotaContinuationSummary = z.infer<typeof quotaContinuationSummarySchema>
