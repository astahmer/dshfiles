import { describe, expect, it } from 'vitest'
import { NextWaiting } from './next-waiting.js'

const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

describe('NextWaiting', () => {
  it('starts at the first item and cycles through Needs you, wrapping at the end', () => {
    expect(NextWaiting.next({ items, lastId: null })).toBe(0)
    expect(NextWaiting.next({ items, lastId: 'a' })).toBe(1)
    expect(NextWaiting.next({ items, lastId: 'c' })).toBe(0)
  })

  it('restarts at the top when the last item left the list, and has nothing when nothing waits', () => {
    expect(NextWaiting.next({ items, lastId: 'gone' })).toBe(0)
    expect(NextWaiting.next({ items: [], lastId: 'a' })).toBeNull()
  })
})
