import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { quotaSnapshotSchema, usageMetaSchema } from './usage-history-model.js'

export { quotaSnapshotSchema, usageMetaSchema } from './usage-history-model.js'
export type { QuotaSnapshot, UsageMeta } from './usage-history-model.js'

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

export const usageHistoryDomain = defineDomain({
  name: USAGE_HISTORY_DOMAIN,
  version: 1,
  // `initial` is the shape the type is inferred from, so it carries every field.
  global: {
    schema: usageMetaSchema,
    initial: { lastReadAt: null, lastAttemptAt: null, intervalMinutes: 15, retentionDays: 90 },
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
