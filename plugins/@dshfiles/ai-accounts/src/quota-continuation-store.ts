import { defineDomain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import { asZodSchema } from './effect-zod-schema.js'
import { quotaContinuationRecordSchema, type QuotaContinuationRecord } from './quota-continuation-model.js'

export type QuotaContinuationTable = KvTable<string, QuotaContinuationRecord>

export const quotaContinuationDomain = defineDomain({
  name: 'dshfiles_ai_accounts_quota_continuations',
  version: 1,
  layout: 'per-record',
  tables: {
    continuations: {
      valueSchema: asZodSchema(quotaContinuationRecordSchema),
      __key: 'continuations',
    },
  },
})
