/** Error thrown by every ledgerline module; `code` is stable and machine-readable. */
export class LedgerError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'LedgerError'
    this.code = code
    this.details = details
  }
}
