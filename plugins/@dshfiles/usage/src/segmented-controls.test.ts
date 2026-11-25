import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

describe('Usage controls', () => {
  // DESIGN.md › Tabs — one style: a filter over one list is a ToggleGroup, never a row of plain text buttons.
  it('draws the Purpose filter as a ToggleGroup like the other filters', () => {
    const panel = read('panel.tsx')
    const purpose = panel.slice(panel.indexOf('>Purpose</span>'), panel.indexOf("preferences.tab === 'log'"))
    expect(purpose).toContain('<ToggleGroup')
    expect(purpose).not.toContain('aria-pressed=')
  })

  it('hides "Where it went" while the range cost nothing', () => {
    expect(read('charts.tsx')).toMatch(/view\.summary\.cost > 0 \? \(\s*<UsageSpendMap/u)
  })
})
