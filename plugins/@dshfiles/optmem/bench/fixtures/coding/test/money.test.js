import assert from 'node:assert/strict'
import { test } from 'node:test'
import { addMoney, allocate, fromCents, toCents } from '../src/money.js'

test('toCents parses decimal strings', () => {
  assert.equal(toCents('12.5'), 1250)
  assert.equal(toCents('-3.07'), -307)
  assert.equal(toCents(4), 400)
})

test('toCents rejects floats and garbage', () => {
  assert.throws(() => toCents(1.1), { code: 'LL_FLOAT_AMOUNT' })
  assert.throws(() => toCents('12,50'), { code: 'LL_INVALID_AMOUNT' })
})

test('fromCents renders two fraction digits', () => {
  assert.equal(fromCents(1234), '12.34')
  assert.equal(fromCents(-5), '-0.05')
})

test('addMoney sums integer cents', () => {
  assert.equal(addMoney(100, 250, -50), 300)
})

test('allocate keeps the total', () => {
  assert.deepEqual(allocate(100, [1, 1, 1]), [34, 33, 33])
  assert.equal(
    allocate(1001, [3, 5, 2]).reduce((a, b) => a + b, 0),
    1001,
  )
})
