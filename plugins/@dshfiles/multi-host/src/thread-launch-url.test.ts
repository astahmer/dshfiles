import { describe, expect, test } from 'vitest'
import { threadLaunchUrl } from './thread-launch-url.js'

describe('thread launch URL', () => {
  test('keeps the sign-in token and selects the thread', () => {
    const url = new URL(threadLaunchUrl({ launchUrl: 'http://127.0.0.1:4100/?token=abc', sessionId: 'session-1 x' }))
    expect(url.searchParams.get('token')).toBe('abc')
    expect(url.searchParams.get('thread')).toBe('session-1 x')
  })

  test('replaces a thread the launch URL already names', () => {
    const url = new URL(threadLaunchUrl({ launchUrl: 'http://127.0.0.1:4100/?thread=old', sessionId: 'session-2' }))
    expect(url.searchParams.getAll('thread')).toEqual(['session-2'])
  })
})
