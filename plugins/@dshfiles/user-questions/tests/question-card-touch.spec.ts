import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../src/native/QuestionComposer.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Innermost declaration blocks with their selector and the at-rules still open around them. */
const blocks = (): readonly { readonly selector: string; readonly body: string; readonly context: string }[] => {
  const found: { selector: string; body: string; context: string }[] = []
  const rule = /([^{}]+)\{([^{}]*)\}/g
  for (let match = rule.exec(css); match !== null; match = rule.exec(css)) {
    const open: string[] = []
    for (const token of css.slice(0, match.index).matchAll(/([^{}]*)([{}])/g)) {
      if (token[2] === '{') open.push((token[1] ?? '').trim())
      else open.pop()
    }
    found.push({ selector: (match[1] ?? '').trim(), body: match[2] ?? '', context: open.filter(prelude => prelude.startsWith('@')).join(' ') })
  }
  return found
}

describe('question card on touch, and its Recommended chip', () => {
  // F11: Collapse was 28x39 effective on an iPhone: the body's positioned rows covered its lower area and the icon 4px
  // to its right took the rest.
  test('header icons stand apart and win the strips they share with the body', () => {
    const coarse = blocks().filter(block => block.context.includes('(pointer: coarse)'))
    const gap = coarse.find(block => block.selector === '.headerActions')?.body.match(/column-gap:\s*(\d+)px/)
    expect(Number(gap?.[1] ?? 0)).toBeGreaterThanOrEqual(20)
    expect(coarse.some(block => block.selector === '.headerActions :where(button)' && /z-index:\s*1/.test(block.body))).toBe(true)
  })

  // C14: indigo is interaction and Needs you, so a recommendation is a muted chip.
  test('Recommended is muted, not indigo', () => {
    const badge = blocks().filter(block => block.selector === '.badge')
    expect(badge).toHaveLength(1)
    expect(badge[0]?.body).not.toMatch(/button-info|nav-item-active-accent|indigo|--dsw-alias-accent/)
    expect(badge[0]?.body).toMatch(/color:\s*var\(--dsw-alias-label-secondary\)/)
  })
})
