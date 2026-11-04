import { describe, expect, test } from 'vitest'
import { threadViewUrl } from './thread-launch-url.js'

describe('thread view URL', () => {
  test('drops the sign-in token and selects the thread', () => {
    const url = new URL(threadViewUrl({ launchUrl: 'http://127.0.0.1:4100/?token=abc#x', sessionId: 'session-1 x' }))
    expect(url.searchParams.get('token')).toBeNull()
    expect(url.hash).toBe('')
    expect(url.origin).toBe('http://127.0.0.1:4100')
    expect(url.searchParams.get('thread')).toBe('session-1 x')
  })
})
