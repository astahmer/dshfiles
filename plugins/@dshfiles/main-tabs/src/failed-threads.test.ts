import { describe, expect, it } from 'vitest'
import { FailedThreads } from './failed-threads.js'

describe('FailedThreads.ids', () => {
  it('keeps a read failure from the Host record and an unread failure an older Host only reports as a finish', () => {
    const ids = FailedThreads.ids(
      [
        { sessionId: 'unread-error', finishedReason: 'error' },
        { sessionId: 'unread-limit', finishedReason: 'max-tokens' },
        { sessionId: 'unread-done', finishedReason: 'completed' },
        { sessionId: 'marked-unread', finishedReason: null },
      ],
      ['read-error'],
    )
    expect([...ids].toSorted()).toEqual(['read-error', 'unread-error', 'unread-limit'])
  })
})
