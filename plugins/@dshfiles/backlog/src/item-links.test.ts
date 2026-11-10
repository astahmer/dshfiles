import { describe, expect, it } from 'vitest'

import { BacklogItems } from './item.js'

describe('thread link extraction', () => {
  it('links a session id mentioned in the text', () => {
    expect(BacklogItems.triage('Seen in session-9f8e7d6c after the crash').links).toEqual([
      { type: 'thread', target: 'session-9f8e7d6c', provenance: 'extracted' },
    ])
  })

  it('does not link a package name that only looks like a thread reference', () => {
    const triaged = BacklogItems.triage('fork the whole package as `chat` and `session-controller` (Host side included)')

    expect(triaged.links).toEqual([])
  })

  it('does not link a prose word after "session-"', () => {
    expect(BacklogItems.triage('the session-history panel and its session-search box').links).toEqual([])
  })

  it('accepts a bare or prefixed session id and rejects a word', () => {
    expect(BacklogItems.isSessionId('9e185ebf-1a7e-488f-b8a4-b9c877a4d724')).toBe(true)
    expect(BacklogItems.isSessionId('session-9e185ebf')).toBe(true)
    expect(BacklogItems.isSessionId('session-controller')).toBe(false)
  })
})
