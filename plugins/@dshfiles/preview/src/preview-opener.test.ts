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

describe('PreviewOpener.hostOnly', () => {
  it('marks a Host loopback URL host-only when the GUI runs on another machine', () => {
    expect(PreviewOpener.hostOnly({ guiHostname: 'mac.tailnet.ts.net', url: 'http://127.0.0.1:5173/' })).toBe(true)
    expect(PreviewOpener.hostOnly({ guiHostname: '192.168.1.20', url: 'http://localhost:3000/' })).toBe(true)
    expect(PreviewOpener.hostOnly({ guiHostname: '192.168.1.20', url: 'http://app.localhost:3000/' })).toBe(true)
  })

  it('opens directly from a loopback GUI or for a non-loopback URL', () => {
    expect(PreviewOpener.hostOnly({ guiHostname: '127.0.0.1', url: 'http://localhost:5173/' })).toBe(false)
    expect(PreviewOpener.hostOnly({ guiHostname: 'localhost', url: 'http://127.0.0.1:5173/' })).toBe(false)
    expect(PreviewOpener.hostOnly({ guiHostname: 'mac.tailnet.ts.net', url: 'http://mac.tailnet.ts.net:5173/' })).toBe(false)
    expect(PreviewOpener.hostOnly({ guiHostname: 'mac.tailnet.ts.net', url: 'not a url' })).toBe(false)
  })
})

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
