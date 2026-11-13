import { describe, expect, it } from 'vitest'
import { linkBackNeedsPlainHttpConsent, needsPlainHttpConsent } from './link-urls.js'

describe('needsPlainHttpConsent', () => {
  it.each([
    ['http://192.168.1.44:3090/link#code=abc', true],
    ['http://box.lan:3090', true],
    ['http://100.64.0.1:3090/link#code=abc', false],
    ['http://100.127.255.255:3090', false],
    ['http://100.128.0.1:3090', true],
    ['http://mac.tail1234.ts.net:3090', false],
    ['http://127.0.0.1:3090', false],
    ['http://localhost:3090', false],
    ['http://[::1]:3090', false],
    ['https://192.168.1.44:3090', false],
    ['not a url', false],
  ])('%s → %s', (link, expected) => {
    expect(needsPlainHttpConsent(link)).toBe(expected)
  })
})

describe('linkBackNeedsPlainHttpConsent', () => {
  it.each([
    [['http://192.168.1.44:3459'], true],
    [['http://192.168.1.44:3459', 'http://10.0.0.2:3459'], true],
    [['http://100.101.2.3:3459', 'http://192.168.1.44:3459'], false],
    [['https://box.example.com', 'http://192.168.1.44:3459'], false],
    [[], false],
  ])('%j → %s', (urls, expected) => {
    expect(linkBackNeedsPlainHttpConsent(urls)).toBe(expected)
  })
})
