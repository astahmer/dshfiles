import { describe, expect, it } from 'vitest'
import type { BrowserService } from '@dshfiles/dshx/client'
import { PreviewOpener } from './preview-opener.js'

const pane = (accepts: boolean): BrowserService & { readonly opened: string[] } => {
  const opened: string[] = []
  return {
    opened,
    available: { get: () => accepts, subscribe: () => () => {} },
    open: url => {
      if (accepts) opened.push(url)
      return accepts
    },
  }
}

describe('PreviewOpener.open', () => {
  it('opens in the pane when it accepts the URL', () => {
    const tabs: string[] = []
    const browser = pane(true)
    expect(PreviewOpener.open({ pane: browser, url: 'http://localhost:5173/', newTab: url => tabs.push(url) })).toBe('pane')
    expect(browser.opened).toEqual(['http://localhost:5173/'])
    expect(tabs).toEqual([])
  })

  it('falls back to a new tab when the pane refuses', () => {
    const tabs: string[] = []
    expect(PreviewOpener.open({ pane: pane(false), url: 'http://localhost:5173/', newTab: url => tabs.push(url) })).toBe('tab')
    expect(tabs).toEqual(['http://localhost:5173/'])
  })

  it('falls back to a new tab without a pane provider', () => {
    const tabs: string[] = []
    expect(PreviewOpener.open({ pane: undefined, url: 'http://127.0.0.1:3000/', newTab: url => tabs.push(url) })).toBe('tab')
    expect(tabs).toEqual(['http://127.0.0.1:3000/'])
  })
})
