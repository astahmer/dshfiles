import { z } from 'zod'
import { secretCredentialLabelSchema } from '@dshfiles/credential-port'

export const JEV_INPUT_USD_PER_MILLION = 0.042

export const jevUsageSourceSchema = z.enum(['backlog', 'memory'])
export const jevCredentialLabelSchema = secretCredentialLabelSchema.or(z.literal('Legacy / unknown')).or(z.literal('Other credentials'))
export const jevUsageOutcomeSchema = z.enum(['success', 'failure'])

export const jevUsageRecordSchema = z
  .object({
    requestId: z.string().uuid(),
    source: jevUsageSourceSchema,
    credential: jevCredentialLabelSchema,
    startedAt: z.number().int().nonnegative(),
    durationMs: z
      .number()
      .int()
      .min(0)
      .max(60 * 60_000),
    outcome: jevUsageOutcomeSchema,
    inputTokens: z.number().int().min(0).max(1_000_000).nullable(),
    outputTokens: z.number().int().min(0).max(1_000_000).nullable(),
  })
  .strict()

export const jevUsageQuerySchema = z
  .object({
    from: z.number().int().nonnegative(),
    to: z.number().int().positive(),
  })
  .strict()
  .refine(range => range.to > range.from, { path: ['to'], message: 'The end of the range must be after the start.' })

const jevUsageBreakdownSchema = z
  .object({
    credential: jevCredentialLabelSchema,
    backlogCalls: z.number().int().nonnegative(),
    memoryCalls: z.number().int().nonnegative(),
    calls: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    callsWithoutInputUsage: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative(),
  })
  .strict()

export const jevUsageViewSchema = z
  .object({
    calls: z.number().int().nonnegative(),
    succeeded: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    callsWithoutInputUsage: z.number().int().nonnegative(),
    estimatedCostUsd: z.number().nonnegative(),
    byCredential: z.array(jevUsageBreakdownSchema).max(20),
  })
  .strict()

export type JevUsageRecord = z.infer<typeof jevUsageRecordSchema>
export type JevUsageQuery = z.infer<typeof jevUsageQuerySchema>
export type JevUsageBreakdown = z.infer<typeof jevUsageBreakdownSchema>
export type JevUsageView = z.infer<typeof jevUsageViewSchema>
