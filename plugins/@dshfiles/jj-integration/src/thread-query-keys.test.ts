import { describe, expect, it } from 'vitest'
import { threadAtQueryKey } from './thread-query-keys.js'

describe('thread status query keys', () => {
  it('gives a session-scoped status one stable shared key', () => {
    expect(threadAtQueryKey('/repo-threads/thread-a', 'session-a')).toEqual(['jj-integration', 'thread', '/repo-threads/thread-a', 'session-a'])
  })

  it('keeps each session view distinct under a path-wide invalidation prefix', () => {
    expect(threadAtQueryKey('/repo-threads/thread-a', 'session-a')).not.toEqual(threadAtQueryKey('/repo-threads/thread-a', 'session-b'))
    expect(threadAtQueryKey('/repo-threads/thread-a', 'session-a').slice(0, 3)).toEqual(threadAtQueryKey('/repo-threads/thread-a'))
  })
})
