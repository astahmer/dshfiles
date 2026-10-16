// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { clipboardHtmlToText, clipboardText } from '../src/clipboard-text.js'

const sessionUri = `dsh-session:${btoa(JSON.stringify('session-42')).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')}`

describe('composer clipboard text', () => {
  it('prefers canonical plain text when available', () => {
    const data = { getData: (format: string) => (format === 'text/plain' ? 'plain wire text' : '<b>rich</b>') }
    expect(clipboardText(data)).toBe('plain wire text')
  })

  it('keeps rich text structure as safe text and exports session links as mention wire text', () => {
    const html = `<p>Look at <a href="${sessionUri}">the thread</a>.</p><p>Continue here.</p>`
    expect(clipboardHtmlToText(html)).toBe(`Look at @[the thread](${sessionUri}).\nContinue here.\n`)
  })

  it('omits executable markup while preserving its surrounding text', () => {
    expect(clipboardHtmlToText('<p>before<script>alert(1)</script>after</p>')).toBe('beforeafter\n')
  })
})
