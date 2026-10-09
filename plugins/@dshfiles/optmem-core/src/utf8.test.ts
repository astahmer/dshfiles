import { describe, expect, it } from 'vitest'

import { Utf8 } from './utf8.ts'

describe('Utf8', () => {
  it('counts bytes like a UTF-8 encoder', () => {
    const samples: readonly (readonly [string, number])[] = [
      ['abc', 3],
      ['é', 2],
      ['€', 3],
      ['😀', 4],
      ['a😀é€\u{10FFFF}', 14],
      ['\uD800', 3],
    ]
    for (const [sample, bytes] of samples) expect(Utf8.byteLength(sample)).toBe(bytes)
  })

  it('never splits a code point when clipping', () => {
    const text = '😀'.repeat(10)
    const clipped = Utf8.clip(text, 13)
    expect(Utf8.byteLength(clipped)).toBeLessThanOrEqual(13)
    expect(clipped).toBe('😀😀…')
    expect(Utf8.head('é'.repeat(3), 5)).toBe('éé')
    expect(Utf8.tail('é'.repeat(3), 5)).toBe('éé')
  })

  it('bounds text with an explicit truncation marker', () => {
    const bounded = Utf8.boundHeadTail(`HEAD${'x'.repeat(10_000)}TAIL`, 200)
    expect(Utf8.byteLength(bounded.text)).toBeLessThanOrEqual(200)
    expect(bounded.text.startsWith('HEAD')).toBe(true)
    expect(bounded.text.endsWith('TAIL')).toBe(true)
    expect(bounded.text).toContain(`…[truncated ${bounded.truncatedBytes} bytes]…`)
    expect(Utf8.boundHeadTail('short', 200)).toEqual({ text: 'short', truncatedBytes: 0 })
  })

  it('paginates by bytes without losing text', () => {
    const text = 'aé😀'.repeat(100)
    const pages = Utf8.pages(text, 64)
    expect(pages.join('')).toBe(text)
    expect(pages.every(page => Utf8.byteLength(page) <= 64)).toBe(true)
  })
})
