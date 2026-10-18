import { describe, expect, it } from 'vitest'
import { MemoryFocusModel } from './memory-focus.ts'

describe('memory focus', () => {
  it('tells the panel which note or digest a reference names', () => {
    expect(MemoryFocusModel.noteIdOf({ id: 'n:12' })).toBe(12)
    expect(MemoryFocusModel.noteIdOf({ id: 'n:0' })).toBeUndefined()
    expect(MemoryFocusModel.noteIdOf({ id: 't:9356abc7' })).toBeUndefined()
    expect(MemoryFocusModel.threadIdOf({ id: 't:9356abc7' })).toBe('9356abc7')
    expect(MemoryFocusModel.threadIdOf({ id: 't:session-9356abc7' })).toBe('9356abc7')
    expect(MemoryFocusModel.threadIdOf({ id: 'n:12' })).toBeUndefined()
    expect(MemoryFocusModel.threadIdOf(null)).toBeUndefined()
  })

  it('carries one request to every subscriber and drops it once consumed', () => {
    let seen = 0
    const stop = MemoryFocusModel.subscribe(() => {
      seen += 1
    })
    MemoryFocusModel.request({ id: 'n:3', range: '42' })
    expect(MemoryFocusModel.read()).toEqual({ id: 'n:3', range: '42' })
    expect(seen).toBe(1)

    MemoryFocusModel.clear()
    expect(MemoryFocusModel.read()).toBeNull()
    expect(seen).toBe(2)

    stop()
    MemoryFocusModel.request({ id: 'n:4' })
    expect(seen).toBe(2)
  })
})
