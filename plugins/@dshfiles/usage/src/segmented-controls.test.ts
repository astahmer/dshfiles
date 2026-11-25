import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

/** Every Usage page surface that draws a segmented control. */
const PAGE_SOURCES = ['panel.tsx', 'charts.tsx', 'usage-history.tsx', 'tools-tab.tsx', 'quota-tab.tsx'] as const

describe('Usage controls', () => {
  // DESIGN.md › Tabs — one style: muted track and paper pill, like the page tabs and "Where it went".
  it('draws every single-choice control in the one segmented style', () => {
    for (const name of PAGE_SOURCES) {
      const source = read(name)
      expect(source, name).not.toContain('<ToggleGroup')
      expect(source, name).toContain('<SlidingSegments')
    }
  })

  it('keeps range, granularity and the named Purpose menu on one row', () => {
    const panel = read('panel.tsx')
    const row = panel.slice(panel.indexOf('aria-label="Filters"'), panel.indexOf("preferences.tab === 'log' ?"))
    expect(row).toContain('aria-label="Time range"')
    expect(row).toContain('aria-label="Group by time"')
    expect(row).toContain('<DropdownMenuCheckboxItem')
    expect(row).toMatch(/aria-label=\{`Purpose: \$\{purposeSummary\}`\}/u)
    expect(row).not.toContain('>Purpose</span>')
  })

  it('hides "Where it went" while the range cost nothing', () => {
    expect(read('charts.tsx')).toMatch(/view\.summary\.cost > 0 \? \(\s*<UsageSpendMap/u)
  })
})
