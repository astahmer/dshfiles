// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { PANEL_ASIDE_EVENT, requestPanelAside } from './panel-aside.js'

const requests: { readonly detail: unknown; readonly cancelable: boolean }[] = []
const onRequest = (event: Event): void => {
  requests.push({ detail: event instanceof CustomEvent ? event.detail : undefined, cancelable: event.cancelable })
  event.preventDefault()
}

afterEach(() => {
  window.removeEventListener(PANEL_ASIDE_EVENT, onRequest)
  requests.length = 0
})

describe('panel aside requests', () => {
  it('asks for one panel and reports that its plugin took it', () => {
    window.addEventListener(PANEL_ASIDE_EVENT, onRequest)

    expect(requestPanelAside('dshfiles-workbench')).toBe(true)
    expect(requests).toEqual([{ detail: { panelId: 'dshfiles-workbench' }, cancelable: true }])
  })

  it('reports a request nobody took, so the strip keeps its tab', () => {
    expect(requestPanelAside('dshfiles-workbench')).toBe(false)
  })
})
