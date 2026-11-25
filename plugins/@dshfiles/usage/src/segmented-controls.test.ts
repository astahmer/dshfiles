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
    const segmented = COST_TAB_SOURCES.flatMap(name =>
      [...read(name).matchAll(/<SlidingSegments(?:<[^>\n]*>)?\s+(?:size="sm"\s+)?aria-label="([^"]+)"/gu)].map(match => match[1]),
    )
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

  it('picks the chart grouping from a select on the filter row, not on the chart card', () => {
    const panel = read('panel.tsx')
    const row = panel.slice(panel.indexOf('aria-label="Filters"'), panel.indexOf("preferences.tab === 'log' ?"))
    expect(row).toMatch(/<SelectTrigger size="sm" aria-label="Group by"/u)
    expect(read('charts.tsx')).not.toContain('aria-label="Group by"')
  })

  it('hides "Where it went" while the range cost nothing', () => {
    expect(read('charts.tsx')).toMatch(/view\.summary\.cost > 0 \? \(\s*<UsageSpendMap/u)
  })
})

describe('Usage page sections and chart toolbar (council round 3, D1)', () => {
  it('names the first section Overview: it shows cost, tokens and requests', () => {
    const panel = read('panel.tsx')
    const tabs = panel.slice(panel.indexOf('const USAGE_TAB_ITEMS'), panel.indexOf('const withFallback'))
    const labels = [...tabs.matchAll(/\{ value: '(\w+)', label: '([^']+)' \}/gu)].map(match => `${match[1]}:${match[2]}`)
    expect(labels).toEqual(['charts:Overview', 'quota:Quota', 'log:Requests', 'activity:Tools'])
  })
})

describe('Usage control row and chart header (council round 4, D1)', () => {
  it('offers four range segments and keeps Custom in its own popover, so the filters fit one row', () => {
    const panel = read('panel.tsx')
    const presets = panel.slice(panel.indexOf('const PRESET_OPTIONS'), panel.indexOf('const GROUP_BY_OPTIONS'))
    expect([...presets.matchAll(/value: '(\w+)'/gu)].map(match => match[1])).toEqual(['today', '7d', '30d', '365d'])
    const row = panel.slice(panel.indexOf('aria-label="Filters"'), panel.indexOf("preferences.tab === 'log' ?"))
    expect(row).toMatch(/<PopoverTrigger asChild>\s*<Button[^>]*aria-pressed=\{preferences\.preset === 'custom'\}/u)
    expect(row).toMatch(/<PopoverContent[\s\S]*aria-label="From date"[\s\S]*aria-label="To date"[\s\S]*<\/PopoverContent>/u)
  })

  it("puts the metric switch beside the chart card's title, not across the card (council round 5, D1)", () => {
    const charts = read('charts.tsx')
    expect(charts).not.toContain('role="toolbar" aria-label="Chart options"')
    const header = /<header className="([^"]*)" data-usage-chart-header>([\s\S]*?)<\/header>/u.exec(charts)
    expect(header?.[1]).not.toContain('dshx:justify-between')
    const titleRow = /<span className="[^"]*" data-usage-chart-title-row>([\s\S]*?)<\/span>\s*<span className="dshx:text-xs">/u.exec(header?.[2] ?? '')
    expect(titleRow?.[1]).toContain('over time')
    expect(titleRow?.[1]).toContain('<SlidingSegments size="sm" aria-label="Usage measure"')
    // The stats card's edge already parts it from the chart: no second hairline right under the card.
    expect(charts).toMatch(/<Panel className="dshx:border-t-0 dshx:pt-1">\s*\{\/\*[\s\S]*?\*\/\}\s*<header className="[^"]*" data-usage-chart-header>/u)
  })
})

describe('Usage page width (council round 5 A2)', () => {
  it('sits on the wide data frame and marks the current section with the kit accent', () => {
    expect(read('panel.tsx')).toMatch(/<Page\s+scroll\s+(?:\/\/[^\n]*\n\s*)?width="wide"/u)
    expect(read('panel.tsx')).toContain('dshx:after:bg-(--dsw-alias-state-business-primary)')
  })
})
