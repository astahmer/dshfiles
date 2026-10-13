import { fromCents } from './money.js'
import { lineAmount } from './invoice.js'
import { taxFor } from './tax.js'

const HEADER = ['invoice', 'customer', 'description', 'quantity', 'unit_price', 'amount', 'tax', 'currency']

/** One CSV row per invoice line, with a header row, CRLF line endings (accounting import format). */
export const toCsv = invoice => {
  const rows = invoice.lines.map(line => {
    const amount = lineAmount(line)
    return [
      invoice.number,
      invoice.customer,
      line.description,
      String(line.quantity),
      fromCents(line.unitCents),
      fromCents(amount),
      fromCents(taxFor(amount, invoice.region)),
      invoice.currency,
    ]
  })
  return [HEADER, ...rows].map(row => row.join(',')).join('\r\n')
}
