import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addLine, createInvoice, totals } from '../src/invoice.js'

test('createInvoice normalizes lines', () => {
  const invoice = createInvoice({ customer: ' Acme ', region: 'fr', lines: [{ description: 'Widget', quantity: 2, unitPrice: '10.00' }] })
  assert.equal(invoice.customer, 'Acme')
  assert.equal(invoice.region, 'FR')
  assert.equal(invoice.lines[0].unitCents, 1000)
})

test('totals sums per-line tax', () => {
  let invoice = createInvoice({ customer: 'Acme', region: 'FR', lines: [{ description: 'A', quantity: 1, unitPrice: '10.00' }] })
  invoice = addLine(invoice, { description: 'B', quantity: 3, unitPrice: '2.50' })
  assert.deepEqual(totals(invoice), { subtotal: 1750, tax: 350, total: 2100 })
})

test('createInvoice requires a customer', () => {
  assert.throws(() => createInvoice({ customer: '', region: 'FR' }), { code: 'LL_MISSING_CUSTOMER' })
})
