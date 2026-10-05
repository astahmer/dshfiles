import { z } from 'zod'

export const MAX_USAGE_HISTORY_POINTS = 5_000

export const quotaSnapshotSchema = z.object({
  at: z.number(),
  instanceId: z.string().min(1).max(64),
  windows: z.record(z.string().max(32), z.number()),
  resetsAt: z.record(z.string().max(32), z.number()),
  bankedResets: z.number().int().min(0).max(20),
  /** Missing on older persisted snapshots. */
  bankedResetExpiries: z.array(z.number().nullable()).max(20).optional(),
})

export const usageMetaSchema = z.object({
  lastReadAt: z.number().nullable().default(null),
  lastAttemptAt: z.number().nullable().default(null),
  intervalMinutes: z.number().int().min(1).max(60).default(5),
  retentionDays: z.number().int().min(1).max(365).default(90),
  /** Surfaces quota can live on. A stored row written before overlays existed reads the default. */
  overlays: z
    .object({
      /** The draggable edge overlay. */
      edgeWidget: z.boolean().default(true),
      /** The sidebar foot disclosure. */
      footerQuota: z.boolean().default(true),
    })
    .prefault({}),
})

export const usageHistoryPointSchema = quotaSnapshotSchema.omit({ instanceId: true })

export type QuotaSnapshot = z.infer<typeof quotaSnapshotSchema>
export type UsageMeta = z.infer<typeof usageMetaSchema>
export type UsageHistoryPoint = z.infer<typeof usageHistoryPointSchema>
export type UsageHistorySettings = Partial<Pick<UsageMeta, 'intervalMinutes' | 'retentionDays' | 'overlays'>>
