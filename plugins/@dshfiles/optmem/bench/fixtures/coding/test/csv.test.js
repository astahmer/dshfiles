import assert from 'node:assert/strict'
import { test } from 'node:test'
import { toCsv } from '../src/csv.js'
import { createInvoice } from '../src/invoice.js'

test('toCsv writes a header and one row per line', () => {
  const invoice = createInvoice({ customer: 'Acme', region: 'FR', lines: [{ description: 'Widget', quantity: 2, unitPrice: '10.00' }] })
  const [header, row] = toCsv(invoice).split('\r\n')
  assert.equal(header, 'invoice,customer,description,quantity,unit_price,amount,tax,currency')
  assert.match(row, /^INV-\d{5},Acme,Widget,2,10\.00,20\.00,4\.00,EUR$/)
})
