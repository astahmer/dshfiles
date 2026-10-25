// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { REPLACE_THREAD_TAB_EVENT, requestReplaceThreadTab } from './main-tab-replacement.js'

const requests: { readonly detail: unknown; readonly cancelable: boolean }[] = []
const onRequest = (event: Event): void => {
  requests.push({ detail: event instanceof CustomEvent ? event.detail : undefined, cancelable: event.cancelable })
  event.preventDefault()
}

afterEach(() => {
  window.removeEventListener(REPLACE_THREAD_TAB_EVENT, onRequest)
  requests.length = 0
})

describe('first-send main-tab replacement request', () => {
  it('asks the main tab strip to replace the draft Session tab with its isolated destination', () => {
    window.addEventListener(REPLACE_THREAD_TAB_EVENT, onRequest)

    expect(requestReplaceThreadTab('draft-session', 'isolated-session')).toBe(true)
    expect(requests).toEqual([
      {
        detail: { sourceSessionId: 'draft-session', sessionId: 'isolated-session' },
        cancelable: true,
      },
    ])
  })

  it('leaves navigation to the caller when main tabs did not take the request', () => {
    expect(requestReplaceThreadTab('draft-session', 'isolated-session')).toBe(false)
  })
})
