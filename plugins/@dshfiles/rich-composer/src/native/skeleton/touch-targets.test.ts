import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'InputBar.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

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

const coarse = (selector: string, context = '') =>
  blocks().filter(block => block.selector === selector && block.context.includes('(pointer: coarse)') && block.context.includes(context))

// F11: on the phone thread screen the composer + was 40x36 effective (the narrow bar, a scroll container, clipped its
// 44pt area at the bar's top edge and the next chip took its right side) and the meter line's ⋯ was 24x22.
describe('composer touch targets on a coarse pointer', () => {
  it('leaves room above the chips inside the scrolling bar without moving it', () => {
    const row = coarse('.row', '(max-width: 560px)')
    expect(row.some(block => /padding-top:\s*8px/.test(block.body) && /margin-top:\s*-8px/.test(block.body))).toBe(true)
  })

  it('lets + win the strip it shares with the chip beside it', () => {
    expect(coarse('.add').some(block => /z-index:\s*1/.test(block.body))).toBe(true)
  })

  it('gives the meter line ⋯ a 44pt area that stays on screen', () => {
    const area = coarse('.meterMore::after')
    expect(area).toHaveLength(1)
    // 20px drawn + 7px up + 17px down.
    expect(area[0]?.body).toMatch(/inset:\s*-7px .+ -17px/)
    expect(coarse('.meterMore').some(block => /position:\s*relative/.test(block.body))).toBe(true)
    expect(coarse('.dock:not([data-meter-expanded])', '(max-width: 560px)').some(block => /overflow:\s*visible/.test(block.body))).toBe(true)
    expect(coarse('.root:not(.hero)').some(block => /padding-bottom:\s*10px/.test(block.body))).toBe(true)
  })

  it('keeps the desktop bar unchanged', () => {
    for (const block of blocks().filter(candidate => ['.add', '.meterMore', '.row'].includes(candidate.selector) && candidate.context === '')) {
      expect(block.body).not.toMatch(/z-index|margin-top:\s*-/)
    }
  })
})
