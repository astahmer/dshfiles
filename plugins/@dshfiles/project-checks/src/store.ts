import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { receiptSchema } from './api.js'

export const storedReceiptSchema = receiptSchema.omit({ freshness: true, configurationFreshness: true })

export const projectChecksDomain = defineDomain({
  name: 'project_checks',
  version: 1,
  tables: {
    receipts: { valueSchema: storedReceiptSchema, __key: 'receipts' },
  },
})

export type StoredReceipt = z.infer<typeof storedReceiptSchema>

export const receiptKey = (receipt: StoredReceipt): string =>
  `${encodeURIComponent(receipt.sessionId)}:${String(receipt.finishedAt).padStart(16, '0')}:${receipt.id}`

export const MAX_RECEIPTS_TOTAL = 2_000

export const receiptsAfter = (entries: readonly (readonly [string, StoredReceipt])[], since: number, requestedLimit: number): readonly StoredReceipt[] => {
  const limit = Math.max(0, Math.min(MAX_RECEIPTS_TOTAL, Math.trunc(requestedLimit)))
  if (limit === 0) return []
  return entries
    .map(([, receipt]) => receipt)
    .filter(receipt => receipt.finishedAt > since)
    .sort((left, right) => left.finishedAt - right.finishedAt || left.id.localeCompare(right.id))
    .slice(-limit)
}

export const trimReceiptRows = (
  entries: readonly (readonly [string, StoredReceipt])[],
  sessionId: string,
  perSessionLimit: number,
  totalLimit: number,
): readonly string[] => {
  const byNewest = [...entries].sort((left, right) => right[1].finishedAt - left[1].finishedAt)
  let sessionCount = 0
  const keptGlobal: string[] = []
  const remove: string[] = []

  for (const [key, receipt] of byNewest) {
    const belongsToSession = receipt.sessionId === sessionId
    if (belongsToSession) sessionCount += 1
    if (belongsToSession && sessionCount > perSessionLimit) {
      remove.push(key)
      continue
    }
    if (keptGlobal.length < totalLimit) {
      keptGlobal.push(key)
      continue
    }
    remove.push(key)
  }
  return remove
}
