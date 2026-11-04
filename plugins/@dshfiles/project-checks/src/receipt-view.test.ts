import { Schema } from 'effect'
import { describe, expect, it } from 'vitest'
import { receiptSchema, storedReceiptSchema } from './api.js'
import { ReceiptViewModel } from './receipt-view.js'
import type { StoredReceipt } from './store.js'

const revision = 'c'.repeat(40)
const legacy = {
  id: '00000000-0000-4000-8000-000000000009',
  sessionId: 'session-a',
  actionId: 'unit-check',
  label: 'Unit check',
  status: 'passed',
  failure: null,
  startedAt: 1,
  finishedAt: 2,
  durationMs: 1,
  exitCode: 0,
  sourceRevision: revision,
  verificationTurn: null,
  automatic: true,
  attempt: 1,
}

describe('Project Checks receipt view', () => {
  it('reports every stored verification stage through the read tool schema', () => {
    for (const stage of ['manual', 'completion', 'rebase'] as const) {
      const stored = Schema.decodeUnknownSync(storedReceiptSchema)({ ...legacy, verificationStage: stage })
      const view = Schema.decodeUnknownSync(receiptSchema)(ReceiptViewModel.of(stored, 'current'))
      expect(view.verificationStage).toBe(stage)
    }
  })

  it('reads a receipt stored before stages existed as not-recorded instead of inferring one', () => {
    const stored: StoredReceipt = Schema.decodeUnknownSync(storedReceiptSchema)(legacy)
    expect(stored.verificationStage).toBeUndefined()
    const view = Schema.decodeUnknownSync(receiptSchema)(ReceiptViewModel.of(stored, 'unknown'))
    expect(view.verificationStage).toBe('not-recorded')
    expect(Schema.decodeUnknownResult(storedReceiptSchema)({ ...legacy, verificationStage: 'not-recorded' })._tag).toBe('Failure')
  })
})
