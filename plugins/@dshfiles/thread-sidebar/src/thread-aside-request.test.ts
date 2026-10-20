// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { OPEN_THREAD_ASIDE_EVENT, readThreadAsideRequest } from './thread-aside-request.js'

const request = (detail: { readonly sessionId: string; readonly extra?: boolean } | string, cancelable = true): Event =>
  new CustomEvent(OPEN_THREAD_ASIDE_EVENT, { detail, cancelable })

describe('thread aside requests', () => {
  it('reads the session one cancelable request names', () => {
    const event = request({ sessionId: 'session-1' })

    expect(readThreadAsideRequest(event)).toBe('session-1')
    event.preventDefault()
    expect(event.defaultPrevented).toBe(true)
  })

  it('ignores another event, a malformed detail and an empty session', () => {
    expect(readThreadAsideRequest(new Event(OPEN_THREAD_ASIDE_EVENT))).toBeUndefined()
    expect(readThreadAsideRequest(request({ sessionId: 'session-1', extra: true }))).toBeUndefined()
    expect(readThreadAsideRequest(request({ sessionId: '' }))).toBeUndefined()
    expect(readThreadAsideRequest(request('session-1'))).toBeUndefined()
  })
})
