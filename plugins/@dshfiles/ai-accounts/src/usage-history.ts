import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

/**
 * Durable quota history.
 *
 * A live quota card answers "how much is left now". It cannot answer "which
 * account burned the quota last Tuesday" or "will this reset before I need it",
 * because nothing is kept between polls. This domain is that memory: one row per
 * account per poll, so a chart and a projection are both derived from the same
 * record rather than from a second, separately-maintained series.
 *
 * The key is the account plus the poll bucket rather than a random id, so a
 * second poll inside the same window updates the row instead of accumulating
 * duplicates, and retention is a single sweep over keys.
 */

// The domain name is a lower-case identifier, so the package's hyphen cannot appear.
export const USAGE_HISTORY_DOMAIN = 'ai_accounts_usage'

const BUCKET_MS = 15 * 60_000

export const quotaSnapshotSchema = z.object({
  /** Epoch milliseconds when this bucket was written. */
  at: z.number(),
  instanceId: z.string().min(1).max(64),
  /** Percent remaining per window, keyed by the window's label. */
  windows: z.record(z.string().max(32), z.number()),
  /** Epoch milliseconds per window label, when the provider reports a reset. */
  resetsAt: z.record(z.string().max(32), z.number()),
  bankedResets: z.number().int().min(0).max(20),
})

export const usageMetaSchema = z.object({
  /**
   * Epoch milliseconds of the newest stored snapshot. Kept as a nullable field
   * rather than optional so a stored record always validates against the same
   * shape the domain was opened with.
   */
  lastReadAt: z.number().nullable().default(null),
  /** Poll interval in minutes, so the schedule survives a restart. */
  intervalMinutes: z.number().int().min(1).max(60).default(15),
  /** Oldest snapshot still worth keeping. */
  retentionDays: z.number().int().min(1).max(365).default(90),
})

export type QuotaSnapshot = z.infer<typeof quotaSnapshotSchema>
export type UsageMeta = z.infer<typeof usageMetaSchema>

export const usageHistoryDomain = defineDomain({
  name: USAGE_HISTORY_DOMAIN,
  version: 1,
  // `initial` is the shape the type is inferred from, so it carries every field.
  global: {
    schema: usageMetaSchema,
    initial: { lastReadAt: null, intervalMinutes: 15, retentionDays: 90 },
  },
  tables: {
    /** Keyed by `<instanceId>:<bucket>`, so one row per account per window. */
    quota: { valueSchema: quotaSnapshotSchema, __key: 'quota' },
  },
})

/** Bucket a reading belongs to, so repeat polls collapse into one row. */
export const usageBucketKey = (instanceId: string, at: number): string =>
  `${instanceId}:${String(Math.floor(at / BUCKET_MS))}`

export const parseUsageBucketKey = (
  key: string,
): { readonly instanceId: string; readonly bucket: number } | null => {
  const separator = key.lastIndexOf(':')
  if (separator <= 0) return null
  const instanceId = key.slice(0, separator)
  const bucket = Number(key.slice(separator + 1))
  if (instanceId.length === 0 || !Number.isFinite(bucket)) return null
  return { instanceId, bucket }
}