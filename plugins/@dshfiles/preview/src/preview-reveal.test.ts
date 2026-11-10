import { describe, expect, it } from 'vitest'
import type { DevServerView, PreviewPageView } from './api.js'
import { PreviewReveal } from './preview-reveal.js'

const page = (input: { readonly pageId: string; readonly revealRequestedAt: number | null }): PreviewPageView => ({
  pageId: input.pageId,
  url: `http://localhost:5173/${input.pageId}`,
  title: '',
  openedAt: 0,
  revealRequestedAt: input.revealRequestedAt,
})

const pane = (accepts: readonly boolean[]) => {
  const opened: string[] = []
  let call = 0
  return {
    opened,
    open: (url: string): boolean => {
      const accepted = accepts[call++] ?? false
      if (accepted) opened.push(url)
      return accepted
    },
  }
}

describe('PreviewReveal.attempt', () => {
  it('shows a reveal whose event was missed once the page list carries it', () => {
    const browser = pane([true])
    const result = PreviewReveal.attempt({
      sessionId: 's',
      pushed: null,
      pages: [page({ pageId: 'p1', revealRequestedAt: 10 })],
      shown: new Set(),
      onScreen: true,
      open: browser.open,
    })
    expect(browser.opened).toEqual(['http://localhost:5173/p1'])
    expect(result.shown).toBe('reveal:s:p1:10')
  })

  it('keeps a reveal the pane refused and shows it on the next attempt', () => {
    const browser = pane([false, true])
    const input = {
      sessionId: 's',
      pushed: { pageId: 'p2', url: 'http://localhost:5173/p2', requestedAt: 20 },
      pages: [],
      shown: new Set<string>(),
      onScreen: true,
      open: browser.open,
    }
    expect(PreviewReveal.attempt(input)).toEqual({ shown: undefined, retry: true })
    expect(PreviewReveal.attempt(input)).toEqual({ shown: 'reveal:s:p2:20', retry: false })
    expect(browser.opened).toEqual(['http://localhost:5173/p2'])
  })

  it('waits while the thread is off screen', () => {
    const browser = pane([true])
    const result = PreviewReveal.attempt({
      sessionId: 's',
      pushed: { pageId: 'p1', url: 'http://localhost:5173/p1', requestedAt: 5 },
      pages: [],
      shown: new Set(),
      onScreen: false,
      open: browser.open,
    })
    expect(result).toEqual({ shown: undefined, retry: false })
    expect(browser.opened).toEqual([])
  })

  it('shows only the newest unshown request, once', () => {
    const browser = pane([true, true])
    const pages = [page({ pageId: 'p1', revealRequestedAt: 10 }), page({ pageId: 'p2', revealRequestedAt: 30 })]
    const pushed = { pageId: 'p1', url: 'http://localhost:5173/p1', requestedAt: 10 }
    const first = PreviewReveal.attempt({ sessionId: 's', pushed, pages, shown: new Set(), onScreen: true, open: browser.open })
    expect(first.shown).toBe('reveal:s:p2:30')
    const second = PreviewReveal.attempt({ sessionId: 's', pushed, pages, shown: new Set(['reveal:s:p2:30']), onScreen: true, open: browser.open })
    expect(second.shown).toBeUndefined()
    expect(browser.opened).toEqual(['http://localhost:5173/p2'])
  })
})

const server = (input: { readonly pid: number; readonly port: number | null }): DevServerView => ({
  pid: input.pid,
  startedAt: 100,
  name: 'vite',
  command: 'vite',
  cwd: '/repo',
  ports: input.port === null ? [] : [{ address: '127.0.0.1', port: input.port, url: `http://127.0.0.1:${String(input.port)}/` }],
  sessionIds: ['s'],
  attribution: 'job',
  jobId: null,
})

describe('PreviewReveal.offer', () => {
  it('offers the first dev server with a port that was not handled yet', () => {
    const servers = [server({ pid: 1, port: null }), server({ pid: 2, port: 5173 }), server({ pid: 3, port: 3000 })]
    expect(PreviewReveal.offer({ sessionId: 's', servers, handled: new Set() })).toEqual({ key: 'server:s:2:100', url: 'http://127.0.0.1:5173/' })
    expect(PreviewReveal.offer({ sessionId: 's', servers, handled: new Set(['server:s:2:100']) })).toEqual({
      key: 'server:s:3:100',
      url: 'http://127.0.0.1:3000/',
    })
  })

  it('offers nothing once every server was handled', () => {
    expect(PreviewReveal.offer({ sessionId: 's', servers: [server({ pid: 2, port: 5173 })], handled: new Set(['server:s:2:100']) })).toBeUndefined()
  })
})
