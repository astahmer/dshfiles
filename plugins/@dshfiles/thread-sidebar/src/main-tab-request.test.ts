// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OPEN_THREAD_IN_MAIN_TAB_EVENT, openThreadInMain, requestThreadMainTab } from './main-tab-request.js'

const requests: { readonly detail: unknown; readonly cancelable: boolean }[] = []
const onRequest = (event: Event): void => {
  requests.push({ detail: event instanceof CustomEvent ? event.detail : undefined, cancelable: event.cancelable })
  event.preventDefault()
}

afterEach(() => {
  window.removeEventListener(OPEN_THREAD_IN_MAIN_TAB_EVENT, onRequest)
  requests.length = 0
})

describe('thread main tab requests', () => {
  it('asks the main tab strip for a kept tab and reports that it took the thread', () => {
    window.addEventListener(OPEN_THREAD_IN_MAIN_TAB_EVENT, onRequest)

    expect(requestThreadMainTab('session-1')).toBe(true)
    expect(requests).toEqual([{ detail: { sessionId: 'session-1', newTab: true }, cancelable: true }])
  })

  it('reports a request nobody took, so the side panel keeps its tab', () => {
    expect(requestThreadMainTab('session-1')).toBe(false)
  })

  it('preserves ordinary native preview intent and falls back only when no tab owner accepts', () => {
    const nativeOpen = vi.fn()
    openThreadInMain('session-1', nativeOpen)
    expect(nativeOpen).toHaveBeenCalledExactlyOnceWith('session-1')
    window.addEventListener(OPEN_THREAD_IN_MAIN_TAB_EVENT, onRequest)
    nativeOpen.mockClear()
    openThreadInMain('session-1', nativeOpen)
    expect(requests).toEqual([{ detail: { sessionId: 'session-1', newTab: false }, cancelable: true }])
    expect(nativeOpen).not.toHaveBeenCalled()
  })

  it('delivers repeated same-Session sidebar intent even when native navigation would not change', () => {
    window.addEventListener(OPEN_THREAD_IN_MAIN_TAB_EVENT, onRequest)
    const nativeOpen = vi.fn()
    openThreadInMain('session-1', nativeOpen)
    openThreadInMain('session-1', nativeOpen)
    expect(requests).toEqual([
      { detail: { sessionId: 'session-1', newTab: false }, cancelable: true },
      { detail: { sessionId: 'session-1', newTab: false }, cancelable: true },
    ])
    expect(nativeOpen).not.toHaveBeenCalled()
  })
})
