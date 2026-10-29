// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { HTML_PAGE_CSP, SandboxedDocument } from './sandboxed-document.js'

const fallbackTokens = SandboxedDocument.fallbackTokens

const reparse = (html: string): Document => new DOMParser().parseFromString(html, 'text/html')

describe('SandboxedDocument.build', () => {
  it('puts the no-network policy first in the head and drops base and http-equiv elements', () => {
    const html = [
      '<!doctype html><html lang="en"><head>',
      '<meta http-equiv="refresh" content="0;url=https://example.com">',
      '<meta http-equiv="Content-Security-Policy" content="default-src *">',
      '<base href="https://example.com/">',
      '<style>h1{color:red}</style></head>',
      '<body><h1>Hi</h1><script>window.x = 1</script></body></html>',
    ].join('')
    const page = reparse(SandboxedDocument.build({ html, scheme: 'dark', tokens: fallbackTokens.dark }))
    const first = page.head.firstElementChild
    expect(first?.getAttribute('http-equiv')).toBe('Content-Security-Policy')
    expect(first?.getAttribute('content')).toBe(HTML_PAGE_CSP)
    expect(page.querySelectorAll('meta[http-equiv]')).toHaveLength(1)
    expect(page.querySelector('base')).toBeNull()
    expect(page.querySelector('script')?.textContent).toBe('window.x = 1')
    expect(page.querySelector('style[data-dsh-theme]')?.textContent).toContain('color-scheme:dark')
    expect(page.documentElement.lang).toBe('en')
  })

  it('wraps a body fragment into a full document', () => {
    const page = reparse(SandboxedDocument.build({ html: '<p>fragment</p>', scheme: 'light', tokens: fallbackTokens.light }))
    expect(page.head.firstElementChild?.getAttribute('http-equiv')).toBe('Content-Security-Policy')
    expect(page.body.textContent).toBe('fragment')
  })
})

describe('SandboxedDocument.resolveTheme', () => {
  it('reads live Host tokens in auto mode and refuses values that could escape the stylesheet', () => {
    const host = new Map([
      ['--dsw-alias-bg-base', ' #101010 '],
      ['--dsw-alias-label-primary', 'red;} body{display:none'],
    ])
    const resolved = SandboxedDocument.resolveTheme({ theme: 'auto', hostScheme: 'dark', readHostToken: name => host.get(name) ?? '' })
    expect(resolved.scheme).toBe('dark')
    expect(resolved.tokens.bg).toBe('#101010')
    expect(resolved.tokens.fg).toBe(fallbackTokens.dark.fg)
  })

  it('pins the palette for an explicit theme', () => {
    expect(SandboxedDocument.resolveTheme({ theme: 'light', hostScheme: 'dark', readHostToken: () => '#000' })).toEqual({
      scheme: 'light',
      tokens: fallbackTokens.light,
    })
  })
})

describe('SandboxedDocument.standalone', () => {
  it('keeps the page inside a sandboxed srcdoc frame whatever its markup contains', () => {
    const document = SandboxedDocument.build({ html: '<p title="a&quot;b">"quoted" & <b>bold</b></p>', scheme: 'light', tokens: fallbackTokens.light })
    const shell = reparse(SandboxedDocument.standalone({ title: '</title><script>alert(1)</script>', document, scheme: 'light', background: '#fff' }))
    expect(shell.querySelectorAll('script')).toHaveLength(0)
    const frames = shell.querySelectorAll('iframe')
    expect(frames).toHaveLength(1)
    expect(frames[0]?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frames[0]?.getAttribute('srcdoc')).toBe(document)
    expect(shell.title).toBe('</title><script>alert(1)</script>')
  })
})
