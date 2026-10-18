import assert from 'node:assert/strict'
import { test } from 'vitest'
import { StableValueModel } from './stable-value.js'

test('sameSet compares by membership, not identity', () => {
  assert.equal(StableValueModel.sameSet(new Set(['a', 'b']), new Set(['b', 'a'])), true)
  assert.equal(StableValueModel.sameSet(new Set(['a']), new Set(['a', 'b'])), false)
  assert.equal(StableValueModel.sameSet(new Set<string>(), new Set<string>()), true)
})

test('sameMap compares keys and member identity', () => {
  const shared = { label: 'x' }
  assert.equal(StableValueModel.sameMap(new Map([['a', shared]]), new Map([['a', shared]])), true)
  assert.equal(StableValueModel.sameMap(new Map([['a', shared]]), new Map([['a', { label: 'x' }]])), false)
  assert.equal(StableValueModel.sameMap(new Map([['a', 1]]), new Map([['b', 1]])), false)
})

test('keepStable reuses the previous value while the content is equal', () => {
  const previous = new Set(['a'])
  assert.equal(StableValueModel.keepStable(previous, new Set(['a']), StableValueModel.sameSet), previous)
  const next = new Set(['b'])
  assert.equal(StableValueModel.keepStable(previous, next, StableValueModel.sameSet), next)
})

test('keepStable has no previous value on the first pass', () => {
  const next = new Set(['a'])
  assert.equal(StableValueModel.keepStable(undefined, next, StableValueModel.sameSet), next)
})
