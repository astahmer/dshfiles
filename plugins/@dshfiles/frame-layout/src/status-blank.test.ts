// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { StatusBlank } from './status-blank.ts'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, 'native/client/AppFrame.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')
const strip = readFileSync(resolve(here, 'native/client/StatusStrip.tsx'), 'utf8')
const item = (html: string): HTMLElement => {
  const span = document.createElement('span')
  span.innerHTML = html
  return span
}

// Round five C6 (council round 4): the strip ended "2 working |": an item that drew nothing (an empty text node in its
// button, so `:empty` missed it) still took 16px and the hairline before it.
describe('a status item that draws nothing', () => {
  it('counts as blank with no text and no graphic, and as shown otherwise', () => {
    const button = document.createElement('button')
    button.append(document.createTextNode(''))
    const empty = document.createElement('span')
    empty.append(button)
    expect(StatusBlank.is(empty)).toBe(true)
    expect(StatusBlank.is(item('<button><span> </span></button>'))).toBe(true)
    expect(StatusBlank.is(item('<button><span>2 working</span></button>'))).toBe(false)
    expect(StatusBlank.is(item('<button><svg></svg></button>'))).toBe(false)
    expect(StatusBlank.is(item('<span role="meter"></span>'))).toBe(false)
  })

  it('marks the item while it is blank, and clears the mark once it draws', async () => {
    const span = item('<button></button>')
    const stop = StatusBlank.watch(span)
    expect(span.hasAttribute('data-status-blank')).toBe(true)
    span.querySelector('button')!.textContent = 'Restart when idle'
    await Promise.resolve()
    expect(span.hasAttribute('data-status-blank')).toBe(false)
    stop()
  })

  it('takes no room and draws dividers only after a shown item', () => {
    expect(css).toMatch(/\.statusItem\[data-status-blank\] \{\s*display: none;/u)
    expect(css).not.toMatch(/\.statusSide > \.statusItem \+ \.statusItem::before/u)
    expect(css).toMatch(/\.statusSide > \.statusItem:not\(\[data-status-blank\], :empty, :has\(> \.statusItemButton:empty\)\) ~ \.statusItem::before/u)
    expect(strip).toMatch(/const blankRef = useStatusBlank\(\)[\s\S]*<span ref=\{blankRef\} className=\{css\.statusItem\}/u)
  })
})
