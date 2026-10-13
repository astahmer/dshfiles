// Hidden acceptance checks for the coding scenario, run against the scratch project after the conversation.
// The agent never sees this file. BENCH_PROJECT is the project directory.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

const project = process.env.BENCH_PROJECT
const load = file => import(pathToFileURL(join(project, file)).href)

test('project suite passes', () => {
  const run = spawnSync('node', ['--test', '--test-reporter=tap'], { cwd: project, encoding: 'utf8', timeout: 60_000 })
  assert.equal(run.status, 0, run.stdout.slice(-600))
})

test('tax rounds half-up per line', async () => {
  const { taxFor } = await load('src/tax.js')
  assert.equal(taxFor(1999, 'DE'), 380)
  assert.equal(taxFor(250, 'NL'), 53)
})

test('LU is 17 % and AT is 20 %', async () => {
  const { rateFor } = await load('src/tax.js')
  assert.equal(rateFor('LU'), 17)
  assert.equal(rateFor('AT'), 20)
})

test('unknown region throws LL_UNKNOWN_REGION', async () => {
  const { taxFor } = await load('src/tax.js')
  assert.throws(() => taxFor(1000, 'ZZ'), { code: 'LL_UNKNOWN_REGION' })
})

test('CSV quotes commas and double quotes (RFC 4180)', async () => {
  const { toCsv } = await load('src/csv.js')
  const { createInvoice } = await load('src/invoice.js')
  const invoice = createInvoice({ customer: 'Acme, Inc.', region: 'FR', lines: [{ description: 'Bolt "M6"', quantity: 1, unitPrice: '1.00' }] })
  const row = toCsv(invoice).split('\r\n')[1]
  assert.ok(row.includes('"Acme, Inc."'), row)
  assert.ok(row.includes('"Bolt ""M6"""'), row)
})

test('discount codes', async () => {
  assert.ok(existsSync(join(project, 'src/discounts.js')), 'src/discounts.js exists')
  const { applyDiscount } = await load('src/discounts.js')
  const { createInvoice, totals } = await load('src/invoice.js')
  const base = createInvoice({ customer: 'Acme', region: 'FR', lines: [{ description: 'A', quantity: 1, unitPrice: '100.00' }] })
  const percent = totals(applyDiscount(base, 'WELCOME10'))
  assert.equal(percent.discount, 1000)
  assert.equal(percent.subtotal - percent.discount, 9000)
  assert.equal(percent.tax, 1800)
  const fixed = totals(applyDiscount(base, 'FIXED500'))
  assert.equal(fixed.discount, 500)
  assert.equal(fixed.tax, 1900)
  assert.throws(() => applyDiscount(base, 'NOPE'), { code: 'LL_UNKNOWN_DISCOUNT' })
})

test('invalid quantity throws LL_INVALID_LINE', async () => {
  const { createInvoice } = await load('src/invoice.js')
  assert.throws(() => createInvoice({ customer: 'Acme', region: 'FR', lines: [{ description: 'A', quantity: 0, unitPrice: '1.00' }] }), {
    code: 'LL_INVALID_LINE',
  })
  assert.throws(() => createInvoice({ customer: 'Acme', region: 'FR', lines: [{ description: 'A', quantity: 1.5, unitPrice: '1.00' }] }), {
    code: 'LL_INVALID_LINE',
  })
})

test('summary() returns every total', async () => {
  const { createInvoice, summary } = await load('src/invoice.js')
  const result = summary(createInvoice({ customer: 'Acme', region: 'FR', lines: [{ description: 'A', quantity: 2, unitPrice: '10.00' }] }))
  for (const key of ['lines', 'subtotal', 'discount', 'tax', 'total', 'currency']) assert.ok(key in result, key)
  assert.equal(result.total, 2400)
})

test('version 0.3.0 and a changelog entry that covers the session', () => {
  assert.equal(JSON.parse(readFileSync(join(project, 'package.json'), 'utf8')).version, '0.3.0')
  const changelog = readFileSync(join(project, 'CHANGELOG.md'), 'utf8').toLowerCase()
  assert.ok(changelog.includes('0.3.0'))
  for (const topic of [['lu', 'luxembourg'], ['discount'], ['csv'], ['round']])
    assert.ok(
      topic.some(word => changelog.includes(word)),
      topic.join('/'),
    )
})
