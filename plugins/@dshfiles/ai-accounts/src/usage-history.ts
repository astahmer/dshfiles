import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { MAX_USAGE_HISTORY_POINTS, quotaSnapshotSchema, usageMetaSchema } from './usage-history-model.js'
import type { QuotaSnapshot } from './usage-history-model.js'

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
const USAGE_HISTORY_DOMAIN = 'ai_accounts_usage'

const LEGACY_BUCKET_MS = 15 * 60_000
const MINUTE_MS = 60_000
const FORECAST_POINT_COUNT = 48
const BANK_CHANGE_POINT_COUNT = 100

const spreadIndexes = (indexes: readonly number[], count: number): readonly number[] => {
  if (count <= 0 || indexes.length === 0) return []
  if (count >= indexes.length) return indexes
  if (count === 1) {
    const last = indexes.at(-1)
    return last === undefined ? [] : [last]
  }
  return Array.from({ length: count }, (_, index) => {
    const candidate = indexes[Math.round((index * (indexes.length - 1)) / (count - 1))]
    return candidate
  }).filter((index): index is number => index !== undefined)
}

/** Keep history reads bounded while retaining the detail used by the page. */
const boundUsageHistoryPoints = (points: readonly QuotaSnapshot[]): readonly QuotaSnapshot[] => {
  const ordered = [...points].sort((left, right) => left.at - right.at)
  if (ordered.length <= MAX_USAGE_HISTORY_POINTS) return ordered

  const bankChanges: number[] = []
  const resetBoundaries = new Set<number>()
  const seenResetLabels = new Set<string>()
  const previousResets = new Map<string, number | undefined>()
  let previousBankSignature: string | undefined

  for (const [index, point] of ordered.entries()) {
    const bankSignature = JSON.stringify({
      balance: point.bankedResets,
      expiries: (point.bankedResetExpiries ?? []).map(value => value ?? null),
    })
    if (bankSignature !== previousBankSignature) bankChanges.push(index)
    previousBankSignature = bankSignature

    for (const label of Object.keys(point.windows)) {
      const reset = point.resetsAt[label]
      if (seenResetLabels.has(label) && previousResets.get(label) !== reset) resetBoundaries.add(index)
      seenResetLabels.add(label)
      previousResets.set(label, reset)
    }
  }

  const selected = new Set<number>([0, ordered.length - 1])
  for (const index of bankChanges.slice(-BANK_CHANGE_POINT_COUNT)) selected.add(index)
  for (let index = Math.max(0, ordered.length - FORECAST_POINT_COUNT); index < ordered.length; index += 1) selected.add(index)

  const resetIndexes = [...resetBoundaries].filter(index => !selected.has(index)).sort((left, right) => left - right)
  for (const index of spreadIndexes(resetIndexes, MAX_USAGE_HISTORY_POINTS - selected.size)) selected.add(index)

  const remainingIndexes = ordered.map((_, index) => index).filter(index => !selected.has(index))
  const remainingSlots = MAX_USAGE_HISTORY_POINTS - selected.size
  for (const index of spreadIndexes(remainingIndexes, remainingSlots)) selected.add(index)

  return [...selected]
    .sort((left, right) => left - right)
    .map(index => ordered[index])
    .filter((point): point is QuotaSnapshot => point !== undefined)
}

/**
 * One reading per bucket (its last), plus every reading where a reset time or
 * the set of spent windows changes, so a thinned series still shows when an
 * account ran out and when it came back.
 */
const thinUsageHistoryPoints = (points: readonly QuotaSnapshot[], bucketMinutes: number): readonly QuotaSnapshot[] => {
  const ordered = [...points].sort((left, right) => left.at - right.at)
  const bucketOf = (at: number): number => Math.floor(at / (bucketMinutes * MINUTE_MS))
  const signatureOf = (point: QuotaSnapshot): string =>
    JSON.stringify([
      Object.entries(point.resetsAt).sort(([left], [right]) => left.localeCompare(right)),
      Object.entries(point.windows)
        .filter(([, remaining]) => remaining <= 0.5)
        .map(([label]) => label)
        .sort(),
    ])
  return ordered.filter((point, index) => {
    const next = ordered[index + 1]
    const previous = ordered[index - 1]
    if (next === undefined || previous === undefined || bucketOf(next.at) !== bucketOf(point.at)) return true
    return signatureOf(previous) !== signatureOf(point)
  })
}

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
const usageBucketKey = (instanceId: string, at: number, intervalMinutes: number): string =>
  `v2:${encodeURIComponent(instanceId)}:${String(intervalMinutes)}:${String(Math.floor(at / (intervalMinutes * MINUTE_MS)))}`

const parseUsageBucketKey = (key: string): { readonly instanceId: string; readonly bucket: number; readonly intervalMinutes: number } | null => {
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
      instanceId.length === 0 ||
      !Number.isInteger(intervalMinutes) ||
      intervalMinutes < 1 ||
      intervalMinutes > 60 ||
      !Number.isSafeInteger(bucket) ||
      bucket < 0
    )
      return null
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

export class UsageHistoryModel {
  static readonly boundPoints = boundUsageHistoryPoints
  static readonly bucketKey = usageBucketKey
  static readonly parseBucketKey = parseUsageBucketKey
  static readonly thinPoints = thinUsageHistoryPoints
}
