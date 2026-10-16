import { describe, expect, it } from 'vitest'
import { composerSessionCwd } from './composer-context-session.js'

describe('composerSessionCwd', () => {
  it('uses the associated isolated workspace instead of the unchanged Session cwd', () => {
    expect(composerSessionCwd('session-1', '/repo', [{ path: '/repo-threads/thread-1', sessionIds: ['session-1'] }])).toBe('/repo-threads/thread-1')
  })

  it('falls back to the Session cwd when no workspace association exists', () => {
    expect(composerSessionCwd('session-1', '/repo', [{ path: '/other', sessionIds: ['session-2'] }])).toBe('/repo')
    expect(composerSessionCwd('session-1', undefined, [])).toBeNull()
  })
})
