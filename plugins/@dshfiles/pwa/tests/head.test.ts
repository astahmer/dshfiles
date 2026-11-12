import { describe, expect, test } from 'vitest'
import { headTags, injectHead } from '../src/head.ts'

const tags = headTags({ shortName: 'DSH' })
const document = (): string =>
  '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div></body></html>'

describe('iOS home-screen head tags', () => {
  test('declares the touch icon, standalone mode, label and status bar style', () => {
    expect(tags).toContain('<link rel="apple-touch-icon" sizes="180x180" href="/pwa/apple-touch-icon-180.png">')
    expect(tags).toContain('<meta name="apple-mobile-web-app-capable" content="yes">')
    expect(tags).toContain('<meta name="apple-mobile-web-app-title" content="DSH">')
    expect(tags).toContain('<meta name="apple-mobile-web-app-status-bar-style" content="black">')
  })

  test('escapes a configured label instead of ending the attribute', () => {
    expect(headTags({ shortName: 'a"b<c&d' })).toContain('content="a&quot;b&lt;c&amp;d"')
  })
})

describe('index injection', () => {
  test('adds the tags inside the head, before anything the app renders', () => {
    const injected = injectHead(document(), tags)
    expect(injected).toContain(`    ${tags}\n  </head>`)
    expect(injected.indexOf(tags)).toBeLessThan(injected.indexOf('</head>'))
    expect(injected).toContain('<div id="root"></div>')
  })

  test('is idempotent for a document that already carries them', () => {
    const once = injectHead(document(), tags)
    expect(injectHead(once, tags)).toBe(once)
  })

  test('leaves a document without a head untouched', () => {
    expect(injectHead('<div></div>', tags)).toBe('<div></div>')
  })
})
