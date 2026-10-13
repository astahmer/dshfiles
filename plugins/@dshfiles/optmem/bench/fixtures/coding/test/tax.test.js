import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rateFor, taxFor } from '../src/tax.js'

test('rateFor is case-insensitive', () => {
  assert.equal(rateFor('fr'), 20)
  assert.equal(rateFor('DE'), 19)
})

test('taxFor rounds half-up per line', () => {
  assert.equal(taxFor(1000, 'FR'), 200)
  assert.equal(taxFor(1999, 'DE'), 380)
  assert.equal(taxFor(250, 'NL'), 53)
})
