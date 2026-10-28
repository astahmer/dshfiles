import { z } from 'zod'

export const legacySavedDraftSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string().min(1).max(120),
    text: z.string().min(1).max(24_000),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict()
