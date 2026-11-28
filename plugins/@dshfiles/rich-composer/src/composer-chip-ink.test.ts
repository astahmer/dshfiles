import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(resolve(here, 'native/skeleton/InputBar.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const chip = readFileSync(resolve(here, 'mode-chip.tsx'), 'utf8')

/** Rule bodies for `selector` inside every block that opens with `media` (or at the top level when `media` is ''). */
const rules = (media: string, selector: string): string => {
  const scopes: string[] = []
  if (media === '') scopes.push(css)
  for (let from = media === '' ? -1 : css.indexOf(media); from >= 0; from = css.indexOf(media, from + 1)) {
    const open = css.indexOf('{', from)
    let depth = 0
    for (let index = open; index < css.length; index += 1) {
      if (css[index] === '{') depth += 1
      if (css[index] === '}') depth -= 1
      if (depth === 0) {
        scopes.push(css.slice(open + 1, index))
        break
      }
    }
  }
  return scopes.flatMap(scope => [...scope.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(match => (match[1] ?? '').trim() === selector).map(match => match[2] ?? '')).join('\n')
}

describe('one rule for the bar\'s chips (council round 10 C3)', () => {
  it('sets the mode chip\'s and the model chip\'s values at the run pickers\' 13px, 500', () => {
    const rule = rules('', '.row :is(:global([data-composer-mode-chip]), :global([data-model-trigger]))')
    expect(rule).toMatch(/font-size: var\(--dsh-content-font-size-secondary, 13px\);/)
    expect(rule).toMatch(/font-weight: 500;/)
  })

  it('draws "Can edit" in ink with a secondary glyph, so it no longer reads as disabled', () => {
    const classes = chip.slice(chip.indexOf("'dshx-root dshx:h-7"), chip.indexOf('data-composer-mode-chip=""'))
    expect(classes).toContain('dshx:text-foreground')
    expect(classes).not.toContain('dshx:text-muted-foreground dshx:hover:text-foreground')
    expect(classes).toContain('dshx:[&>svg]:text-muted-foreground')
  })
})
