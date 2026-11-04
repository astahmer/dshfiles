import type { ProjectCheckReceipt } from './api.js'
import type { StoredReceipt } from './store.js'

/**
 * The receipt the panel and the `project_checks_receipts` tool read. Receipts stored before the
 * stage existed report `not-recorded`; the view never infers a stage from `automatic`.
 */
const receiptView = (receipt: StoredReceipt, freshness: ProjectCheckReceipt['freshness']): ProjectCheckReceipt => ({
  ...receipt,
  verificationStage: receipt.verificationStage ?? 'not-recorded',
  configurationFreshness: 'unknown',
  freshness,
})

export class ReceiptViewModel {
  static readonly of = receiptView
}
