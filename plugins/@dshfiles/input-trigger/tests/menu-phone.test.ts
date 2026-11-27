import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Vitest runs each package from its root.
const css = readFileSync(join(process.cwd(), 'src/client/MenuView.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')

/** Declaration blocks inside every `@media <query>` block whose selector list names `selector`. */
const inMedia = (query: string, selector: string): string[] => {
  const blocks: string[] = []
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  for (const media of css.matchAll(new RegExp(`@media ${escaped}\\s*\\{((?:[^{}]*\\{[^{}]*\\})*)[^{}]*\\}`, 'gu'))) {
    for (const rule of (media[1] ?? '').matchAll(/([^{}]+)\{([^{}]*)\}/gu)) {
      if ((rule[1] ?? '').split(',').some(part => part.trim() === selector)) blocks.push(rule[2] ?? '')
    }
  }
  return blocks.map(block => block.replace(/\s+/gu, ' '))
}

const coarse = '(pointer: coarse)'

describe('the +, @ and / lists on a phone (unslop phone 3, U7)', () => {
  it('gives every row a 44px touch row at the comfortable text size', () => {
    const item = inMedia(coarse, '.item').join(' ')
    expect(item).toContain('min-height: 44px')
    expect(item).toContain('font-size: var(--dshx-density-text-ui, 15px)')
  })

  it('reads section labels, group titles, crumbs and descriptions as 13px meta, never 10-11px', () => {
    for (const selector of ['.sectionTitle', '.groupTitle', '.crumb', '.itemDescription', '.itemAlias']) {
      expect(inMedia(coarse, selector).join(' '), selector).toContain('font-size: var(--dshx-density-text-meta, 13px)')
    }
  })

  it('drops the Tab key hint on touch', () => {
    for (const selector of ['.item.active .drillHintText', '.item.active .drillHint']) {
      expect(inMedia(coarse, selector).join(' '), selector).toContain('display: none')
    }
  })

  it('draws the list with the 16px sheet radius under the phone shell, sideways too', () => {
    const menu = inMedia('(max-width: 639.98px), (pointer: coarse) and (max-height: 500px)', ':global(html[data-shell-phone-nav]) .menu').join(' ')
    expect(menu).toContain('border-radius: var(--dsw-radius-panel, 16px)')
  })

  // A short description sat at the row's right edge while a long one, truncated, started after the title: two
  // alignments in one list. Every description starts after its title.
  it('starts every description after its title, short or truncated', () => {
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].filter(rule => (rule[1] ?? '').split(',').some(part => part.trim() === '.itemDescription'))
    const alignments = rules.flatMap(rule => [...(rule[2] ?? '').matchAll(/text-align:\s*([^;]+);/gu)].map(match => match[1]?.trim()))
    expect(alignments).toEqual(['left'])
  })
})
