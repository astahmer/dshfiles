import { LedgerError } from './errors.js'
import { addMoney, toCents } from './money.js'
import { taxFor } from './tax.js'

let sequence = 0

/**
 * Build an invoice. `lines` are `{ description, quantity, unitPrice }` where unitPrice is a decimal string ("19.99")
 * or integer cents via `unitCents`.
 */
export const createInvoice = ({ customer, region, currency = 'EUR', lines = [], issuedAt = new Date() }) => {
  if (typeof customer !== 'string' || customer.trim() === '') throw new LedgerError('LL_MISSING_CUSTOMER', 'An invoice needs a customer.')
  sequence += 1
  return {
    number: `INV-${String(sequence).padStart(5, '0')}`,
    customer: customer.trim(),
    region: String(region).toUpperCase(),
    currency,
    issuedAt: new Date(issuedAt).toISOString(),
    lines: lines.map(normalizeLine),
  }
}

const normalizeLine = line => ({
  description: String(line.description ?? ''),
  quantity: line.quantity ?? 1,
  unitCents: line.unitCents ?? toCents(line.unitPrice ?? '0'),
})

/** Return a new invoice with one more line. */
export const addLine = (invoice, line) => ({ ...invoice, lines: [...invoice.lines, normalizeLine(line)] })

/** Amount of one line before tax, in cents. */
export const lineAmount = line => line.quantity * line.unitCents

/**
 * Totals in integer cents: `{ subtotal, tax, total }`. Tax is computed per line (finance rule) and then summed, so it
 * can differ by a cent from tax computed on the subtotal.
 */
export const totals = invoice => {
  const amounts = invoice.lines.map(lineAmount)
  const subtotal = addMoney(...amounts)
  const tax = addMoney(...amounts.map(amount => taxFor(amount, invoice.region)))
  return { subtotal, tax, total: subtotal + tax }
}
