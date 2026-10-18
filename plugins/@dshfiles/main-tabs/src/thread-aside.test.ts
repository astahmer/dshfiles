// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { OPEN_THREAD_ASIDE_EVENT, requestThreadAside } from './thread-aside.js'

const listeners: EventListener[] = []

const listenForRequest = (handle: (event: CustomEvent) => void): void => {
  const handler = (event: Event): void => handle(event as CustomEvent)
  window.addEventListener(OPEN_THREAD_ASIDE_EVENT, handler)
  listeners.push(handler)
}

afterEach(() => {
  for (const listener of listeners.splice(0)) window.removeEventListener(OPEN_THREAD_ASIDE_EVENT, listener)
})

describe('thread aside requests', () => {
  it('asks for one thread through a cancelable window event and stays unanswered without a listener to take it', () => {
    let detail: unknown
    let cancelable = false
    listenForRequest(event => {
      detail = event.detail
      cancelable = event.cancelable
    })

    expect(requestThreadAside('session-1')).toBe(false)
    expect(detail).toEqual({ sessionId: 'session-1' })
    expect(cancelable).toBe(true)
  })

  it('reports the side panel as taking the thread when the request comes back cancelled', () => {
    listenForRequest(event => event.preventDefault())

    expect(requestThreadAside('session-1')).toBe(true)
  })
})
