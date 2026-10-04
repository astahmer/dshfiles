import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { quotaSnapshotSchema, usageMetaSchema } from './usage-history-model.js'

export { quotaSnapshotSchema, usageMetaSchema } from './usage-history-model.js'
export type { QuotaSnapshot, UsageMeta } from './usage-history-model.js'

/**
 * Durable quota history.
 *
 * A live quota card answers "how much is left now". It cannot answer "which
 * account burned the quota last Tuesday" or "will this reset before I need it",
 * because nothing is kept between polls. This domain is that memory: one row
 * per account per configured interval window, so a chart and a projection are
 * both derived from the same record rather than a second, separately-maintained
 * series.
 *
 * The key includes its interval so repeated/manual polls inside one configured
 * window update the same row. Including the interval also keeps historical
 * readings intact if the user changes collection frequency.
 */

// The domain name is a lower-case identifier, so the package's hyphen cannot appear.
export const USAGE_HISTORY_DOMAIN = 'ai_accounts_usage'

const LEGACY_BUCKET_MS = 15 * 60_000
const MINUTE_MS = 60_000

export const usageHistoryDomain = defineDomain({
  name: USAGE_HISTORY_DOMAIN,
  version: 1,
  // `initial` is the shape the type is inferred from, so it carries every field.
  global: {
    schema: usageMetaSchema,
    initial: { lastReadAt: null, lastAttemptAt: null, intervalMinutes: 5, retentionDays: 90 },
  },
  tables: {
    /** Keyed by account, interval, and interval bucket. */
    quota: { valueSchema: quotaSnapshotSchema, __key: 'quota' },
  },
})

/** Bucket a reading belongs to, so repeat polls in the configured interval collapse. */
export const usageBucketKey = (instanceId: string, at: number, intervalMinutes: number): string =>
  `v2:${encodeURIComponent(instanceId)}:${String(intervalMinutes)}:${String(Math.floor(at / (intervalMinutes * MINUTE_MS)))}`

export const parseUsageBucketKey = (
  key: string,
): { readonly instanceId: string; readonly bucket: number; readonly intervalMinutes: number } | null => {
  if (key.startsWith('v2:')) {
    const [, encodedId, intervalToken, bucketToken] = key.split(':')
    if (encodedId === undefined || intervalToken === undefined || bucketToken === undefined) return null
    let instanceId: string
    try {
      instanceId = decodeURIComponent(encodedId)
    } catch {
      return null
    }
    const intervalMinutes = Number(intervalToken)
    const bucket = Number(bucketToken)
    if (
      instanceId.length === 0
      || !Number.isInteger(intervalMinutes)
      || intervalMinutes < 1
      || intervalMinutes > 60
      || !Number.isSafeInteger(bucket)
      || bucket < 0
    ) return null
    return { instanceId, bucket, intervalMinutes }
  }

  const separator = key.lastIndexOf(':')
  if (separator <= 0) return null
  const bucket = Number(key.slice(separator + 1))
  if (!Number.isSafeInteger(bucket) || bucket < 0) return null

  // Earlier rows used `<instanceId>:<15-minute bucket>`. Keep reading and
  // pruning those rows while new rows carry their configured interval.
  const instanceId = key.slice(0, separator)
  if (instanceId.length === 0) return null
  return { instanceId, bucket, intervalMinutes: LEGACY_BUCKET_MS / MINUTE_MS }
}
