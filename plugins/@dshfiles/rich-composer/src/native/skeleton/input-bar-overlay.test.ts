import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'InputBar.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Every declaration block whose selector list names exactly `selector`, at any nesting depth. */
const blocksOf = (selector: string): readonly string[] => {
  const blocks: string[] = []
  const rule = /([^{}]+)\{([^{}]*)\}/g
  for (let match = rule.exec(css); match !== null; match = rule.exec(css)) {
    const selectors = (match[1] ?? '').split(',').map(part => part.trim())
    if (selectors.includes(selector)) blocks.push(match[2] ?? '')
  }
  return blocks
}

const declares = (block: string, property: RegExp): boolean => block.split(';').some(declaration => property.test(declaration.split(':')[0]?.trim() ?? ''))

describe('composer card as the overlay anchor', () => {
  // The @, / and + menus hang above the card from `.overlayAnchor`, a child of the card. WebKit clips both axes of a
  // box that clips one (`overflow-x: clip` with a visible block axis), so on an iPhone a clipping card paints no menu
  // while its rows stay tappable.
  it('never clips, at any container width', () => {
    const cardBlocks = blocksOf('.card')
    expect(cardBlocks.length).toBeGreaterThan(0)
    for (const block of cardBlocks) {
      expect(declares(block, /^overflow(-x|-y|-inline|-block)?$/)).toBe(false)
      expect(declares(block, /^(contain|clip-path)$/)).toBe(false)
    }
  })

  it('keeps the chips inside the bar instead: the narrow row scrolls on its own', () => {
    const narrowRows = blocksOf('.row').filter(block => /overflow-x:\s*auto/.test(block))
    expect(narrowRows).toHaveLength(1)
  })
})
