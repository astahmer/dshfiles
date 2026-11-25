import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

/** The Cost tab's surfaces: the page with its filter row, the charts, the spend map and the history blocks. */
const COST_TAB_SOURCES = ['panel.tsx', 'charts.tsx', 'usage-spend-map.tsx', 'usage-history.tsx'] as const

describe('Usage controls', () => {
  it('uses no ToggleGroup: a single choice is a segmented control or a select', () => {
    for (const name of [...COST_TAB_SOURCES, 'tools-tab.tsx', 'quota-tab.tsx']) expect(read(name), name).not.toContain('<ToggleGroup')
  })

  // Council round 2, D1: at most two segmented controls on the page; the range and the chart's metric.
  it('draws at most two segmented controls on the Cost tab: the range and the chart metric', () => {
    const segmented = COST_TAB_SOURCES.flatMap(name => [...read(name).matchAll(/<SlidingSegments\s+aria-label="([^"]+)"/gu)].map(match => match[1]))
    expect(segmented).toEqual(['Time range', 'Usage measure'])
    // The spend map's own Measure switch is off: it follows the chart's metric.
    expect(read('usage-spend-map.tsx')).not.toMatch(/\bmetrics=/u)
    expect(read('charts.tsx')).toMatch(/<UsageSpendMap[^>]*metric=\{trendMetric\}/u)
    expect(read('charts.tsx')).toMatch(/<UsageCalendar[^>]*metric=\{trendMetric\}/u)
  })

  it('shows the page sections as underline tabs, not a second segmented track', () => {
    const panel = read('panel.tsx')
    expect(panel).not.toMatch(/\btabs=\{\{/u)
    expect(panel).toMatch(/<TabsList variant="line" aria-label="Usage views"/u)
  })

  it('keeps range, granularity and the named Purpose menu on one compact row', () => {
    const panel = read('panel.tsx')
    const row = panel.slice(panel.indexOf('aria-label="Filters"'), panel.indexOf("preferences.tab === 'log' ?"))
    expect(row).toContain('aria-label="Time range"')
    expect(row).toMatch(/<SelectTrigger size="sm" aria-label="Group by time"/u)
    expect(row).toContain('<DropdownMenuCheckboxItem')
    expect(row).toMatch(/aria-label=\{`Purpose: \$\{purposeSummary\}`\}/u)
    expect(row).not.toContain('>Purpose</span>')
  })

  it('picks the chart grouping from a select on the chart card', () => {
    expect(read('charts.tsx')).toMatch(/<SelectTrigger size="sm" aria-label="Group by"/u)
  })

  it('hides "Where it went" while the range cost nothing', () => {
    expect(read('charts.tsx')).toMatch(/view\.summary\.cost > 0 \? \(\s*<UsageSpendMap/u)
  })
})
