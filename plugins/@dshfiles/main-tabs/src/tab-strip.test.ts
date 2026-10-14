import { describe, expect, it } from 'vitest'
import { threadTabStatus } from './tab-strip.js'

describe('threadTabStatus', () => {
  it('shows the most urgent thread state: needs you, then working, then unread', () => {
    expect(threadTabStatus({ needsYou: true, running: true, unread: true })).toBe('needsYou')
    expect(threadTabStatus({ needsYou: false, running: true, unread: true })).toBe('running')
    expect(threadTabStatus({ needsYou: false, running: false, unread: true })).toBe('unread')
    expect(threadTabStatus({ needsYou: false, running: false, unread: false })).toBeNull()
  })
})
