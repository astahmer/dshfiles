import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppServicesModel } from '../src/client/app-services.js'
import { BrowserBroker } from '../src/client/broker.js'
import { LinkHandler, MarkdownLinks, type LinkTarget } from '../src/client/links.js'

beforeEach(() => BrowserBroker.reset())
afterEach(() => {
  BrowserBroker.reset()
  vi.unstubAllGlobals()
})

const claim = (scheme: string, id = scheme): LinkTarget[] => {
  const opened: LinkTarget[] = []
  BrowserBroker.add(LinkHandler, { id, scheme, open: link => opened.push(link) }, '@test/links')
  return opened
}

describe('MarkdownLinks.rewrite', () => {
  it('rewrites inline links and autolinks of claimed schemes only', () => {
    claim('jj')
    expect(MarkdownLinks.rewrite('See [main](jj:main), <jj:abc/def> and [x](zz:1)')).toBe(
      'See [main](https://dshx-link.invalid/jj/main), [jj:abc/def](https://dshx-link.invalid/jj/abc%2Fdef) and [x](zz:1)',
    )
  })

  it('keeps code spans and fenced blocks as written', () => {
    claim('jj')
    const text = ['`[a](jj:a)` [b](jj:b)', '```md', '[c](jj:c)', '```', '[d](jj:d)'].join('\n')
    expect(MarkdownLinks.rewrite(text)).toBe(
      ['`[a](jj:a)` [b](https://dshx-link.invalid/jj/b)', '```md', '[c](jj:c)', '```', '[d](https://dshx-link.invalid/jj/d)'].join('\n'),
    )
  })

  it('leaves text alone without handlers and ignores reserved or invalid schemes', () => {
    expect(MarkdownLinks.rewrite('[a](jj:a)')).toBe('[a](jj:a)')
    claim('https')
    claim('Bad Scheme', 'bad')
    expect(MarkdownLinks.schemes()).toEqual([])
  })
})

describe('MarkdownLinks.open', () => {
  it('routes a written link and a rewritten href to the first handler of its scheme', () => {
    const opened = claim('jj')
    claim('jj', 'second')
    expect(MarkdownLinks.open('jj:main')).toBe(true)
    expect(MarkdownLinks.open('https://dshx-link.invalid/jj/abc%2Fdef')).toBe(true)
    expect(opened).toEqual([
      { href: 'jj:main', scheme: 'jj', target: 'main' },
      { href: 'jj:abc/def', scheme: 'jj', target: 'abc/def' },
    ])
    expect(MarkdownLinks.open('b:12')).toBe(false)
    expect(MarkdownLinks.isRewritten('https://dshx-link.invalid/jj/x')).toBe(true)
  })

  it('lets system.openLink fall back to an external tab for http(s)', () => {
    const open = vi.fn()
    vi.stubGlobal('window', { open })
    const opened = claim('b')
    expect(AppServicesModel.system.openLink('b:12')).toBe(true)
    expect(AppServicesModel.system.openLink('https://example.com')).toBe(true)
    expect(AppServicesModel.system.openLink('zz:1')).toBe(false)
    expect(opened.map(link => link.target)).toEqual(['12'])
    expect(open).toHaveBeenCalledWith('https://example.com', '_blank', 'noopener,noreferrer')
  })
})
