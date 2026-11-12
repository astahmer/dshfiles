import { describe, expect, it } from 'vitest'
import { isSessionNotFound, selectionFailureNotice } from '../src/session-presence.js'

describe('a Session the Host does not have', () => {
  it('reads the Host refusal for an identity it has not created yet, or no longer has', () => {
    expect(isSessionNotFound('session/not-found: session "session-1" not found')).toBe(true)
    expect(isSessionNotFound('session "session-abc" not found')).toBe(true)
    expect(isSessionNotFound('session/writer-held: Session is in use')).toBe(false)
    expect(isSessionNotFound('remote catalog unavailable')).toBe(false)
  })

  it('leaves no notice for it, and keeps one for every other failure', () => {
    expect(selectionFailureNotice('session/not-found: session "session-1" not found')).toBeNull()
    expect(selectionFailureNotice('provider/rate-limited: slow down')).toBe('provider/rate-limited: slow down')
  })
})
