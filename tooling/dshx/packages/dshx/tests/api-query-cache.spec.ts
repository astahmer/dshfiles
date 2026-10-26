import assert from 'node:assert/strict'
import { beforeEach, describe, it } from 'vitest'
import { ApiQueryCache } from '../src/api/query-cache.js'

describe('api query cache', () => {
  beforeEach(() => {
    ApiQueryCache.clear()
  })

  it('serves a value only inside its stale window', () => {
    ApiQueryCache.write('state', { revision: 1 }, 1_000)
    assert.deepEqual(ApiQueryCache.read('state', 5_000, 5_999), { revision: 1 })
    assert.equal(ApiQueryCache.read('state', 5_000, 6_000), undefined)
    assert.equal(ApiQueryCache.read('missing', 5_000, 2_000), undefined)
  })

  it('keeps distinct keys apart', () => {
    ApiQueryCache.write('a', 1, 1_000)
    ApiQueryCache.write('b', 2, 1_000)
    assert.equal(ApiQueryCache.read('a', 5_000, 1_500), 1)
    assert.equal(ApiQueryCache.read('b', 5_000, 1_500), 2)
  })

  it('drops the oldest entry once the cache is full', () => {
    for (let index = 0; index < 501; index += 1) ApiQueryCache.write(`key-${String(index)}`, index, 1_000)
    assert.equal(ApiQueryCache.read('key-0', 5_000, 1_500), undefined)
    assert.equal(ApiQueryCache.read('key-500', 5_000, 1_500), 500)
  })
})
