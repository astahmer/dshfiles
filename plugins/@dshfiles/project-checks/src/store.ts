import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
import { receiptSchema } from './api.js'

const storedReceiptSchema = receiptSchema.omit({ freshness: true })

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
