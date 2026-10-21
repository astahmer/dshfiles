import { describe, expect, test } from 'vitest'
import { moveHostId, shiftHostId } from './host-order.js'

describe('host order', () => {
  test('moves one id to the drop index and keeps the rest in order', () => {
    expect(moveHostId({ ids: ['a', 'b', 'c', 'd'], id: 'd', toIndex: 1 })).toEqual(['a', 'd', 'b', 'c'])
    expect(moveHostId({ ids: ['a', 'b', 'c'], id: 'a', toIndex: 2 })).toEqual(['b', 'c', 'a'])
    expect(moveHostId({ ids: ['a', 'b', 'c'], id: 'b', toIndex: 9 })).toEqual(['a', 'c', 'b'])
  })

  test('an unknown id or an unchanged index leaves the order alone', () => {
    const ids = ['a', 'b']
    expect(moveHostId({ ids, id: 'missing', toIndex: 0 })).toBe(ids)
    expect(moveHostId({ ids, id: 'a', toIndex: 0 })).toBe(ids)
  })

  test('shifts one slot and stops at the ends', () => {
    const ids = ['a', 'b', 'c']
    expect(shiftHostId({ ids, id: 'c', direction: 'up' })).toEqual(['a', 'c', 'b'])
    expect(shiftHostId({ ids, id: 'a', direction: 'down' })).toEqual(['b', 'a', 'c'])
    expect(shiftHostId({ ids, id: 'a', direction: 'up' })).toBe(ids)
    expect(shiftHostId({ ids, id: 'c', direction: 'down' })).toBe(ids)
  })
})
