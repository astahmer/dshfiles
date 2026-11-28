import { describe, expect, it } from 'vitest'
import { threadTabStatus } from './tab-strip.js'

describe('threadTabStatus', () => {
  it('shows the most urgent thread state: needs you, then working, then unread', () => {
    expect(threadTabStatus({ needsYou: true, running: true, unread: true })).toBe('needsYou')
    expect(threadTabStatus({ needsYou: false, running: true, unread: true })).toBe('running')
    expect(threadTabStatus({ needsYou: false, running: false, unread: true })).toBe('unread')
    expect(threadTabStatus({ needsYou: false, running: false, unread: false })).toBeNull()
  })

  it('keeps a failed last turn Failed, read or not, until the thread works again', () => {
    expect(threadTabStatus({ needsYou: false, running: false, failed: true, unread: true })).toBe('failed')
    expect(threadTabStatus({ needsYou: false, running: false, failed: true, unread: false })).toBe('failed')
    expect(threadTabStatus({ needsYou: false, running: true, failed: true, unread: false })).toBe('running')
    expect(threadTabStatus({ needsYou: true, running: false, failed: true, unread: false })).toBe('needsYou')
  })

  it("takes the thread list's rolled-up status when the list publishes one", () => {
    // The parent's own turn ended and its subagent still works: the list says Working, the tab said Finished, unread.
    expect(threadTabStatus({ needsYou: false, running: false, unread: true, listed: 'working' })).toBe('running')
    expect(threadTabStatus({ needsYou: false, running: true, unread: false, listed: 'needs-you' })).toBe('needsYou')
    expect(threadTabStatus({ needsYou: false, running: false, unread: false, listed: 'failed' })).toBe('failed')
    expect(threadTabStatus({ needsYou: false, running: false, unread: true, listed: 'ready' })).toBe('unread')
    // Ready for work to land is not a finished turn to read.
    expect(threadTabStatus({ needsYou: false, running: false, unread: false, listed: 'ready' })).toBeNull()
    expect(threadTabStatus({ needsYou: false, running: false, unread: true, listed: 'idle' })).toBeNull()
  })
})
