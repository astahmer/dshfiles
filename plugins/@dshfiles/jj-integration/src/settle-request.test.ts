// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { requestThreadSettle, SETTLE_THREAD_EVENT } from './settle-request.js'

const requestSchema = z.object({ sessionId: z.string() })
const listeners: EventListener[] = []

const listenForRequest = (handle: (detail: { readonly sessionId: string }, cancelable: boolean) => void): void => {
  const handler = (event: Event): void => {
    handle(requestSchema.parse(event instanceof CustomEvent ? event.detail : undefined), event.cancelable)
  }
  window.addEventListener(SETTLE_THREAD_EVENT, handler)
  listeners.push(handler)
}

afterEach(() => {
  for (const listener of listeners.splice(0)) window.removeEventListener(SETTLE_THREAD_EVENT, listener)
})

describe('settle requests from the integration notice', () => {
  it('asks for one thread through a cancelable window event and stays unanswered without a sidebar to take it', () => {
    let asked: { readonly sessionId: string } | undefined
    let cancelable = false
    listenForRequest((detail, eventCancelable) => {
      asked = detail
      cancelable = eventCancelable
    })

    expect(requestThreadSettle('session-1')).toBe(false)
    expect(asked).toEqual({ sessionId: 'session-1' })
    expect(cancelable).toBe(true)
  })

  it('reports the sidebar as taking the thread when the request comes back cancelled', () => {
    const cancel = (event: Event): void => event.preventDefault()
    window.addEventListener(SETTLE_THREAD_EVENT, cancel)
    listeners.push(cancel)

    expect(requestThreadSettle('session-1')).toBe(true)
  })
})
