// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { answerSettleRequests, readSettleThreadRequest, SETTLE_THREAD_EVENT } from './settle-request.js'

const requestEvent = (detail: { readonly sessionId: string }): Event => new CustomEvent(SETTLE_THREAD_EVENT, { detail, cancelable: true })

describe('settle requests', () => {
  it('reads the one session a settle request names', () => {
    expect(readSettleThreadRequest(requestEvent({ sessionId: 'session-1' }))).toBe('session-1')
  })

  it('ignores another event, a malformed payload and an extra field', () => {
    expect(readSettleThreadRequest(new Event('dshfiles:open-thread-aside'))).toBeUndefined()
    expect(readSettleThreadRequest(requestEvent({ sessionId: '' }))).toBeUndefined()
    expect(
      readSettleThreadRequest(new CustomEvent(SETTLE_THREAD_EVENT, { detail: { sessionId: 'session-1', archive: true }, cancelable: true })),
    ).toBeUndefined()
  })
})

describe('answering settle requests', () => {
  it('settles the requested thread and reports the request as handled', () => {
    const settled: string[] = []
    const stop = answerSettleRequests(sessionId => settled.push(sessionId))

    const handled = !window.dispatchEvent(requestEvent({ sessionId: 'session-1' }))
    stop()

    expect(settled).toEqual(['session-1'])
    expect(handled).toBe(true)
  })

  it('leaves another session event and any request alone after the cleanup runs', () => {
    const settled: string[] = []
    const stop = answerSettleRequests(sessionId => settled.push(sessionId))
    window.dispatchEvent(new Event('dshfiles:open-thread-aside'))
    stop()

    expect(settled).toEqual([])
    expect(window.dispatchEvent(requestEvent({ sessionId: 'session-2' }))).toBe(true)
  })
})
