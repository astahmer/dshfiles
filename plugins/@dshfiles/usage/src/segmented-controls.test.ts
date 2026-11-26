import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { trendCaption } from './trend-caption.js'

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
    expect(row).toMatch(/<SelectTrigger aria-label=\{`Grain: /u)
    expect(row).toContain('<DropdownMenuCheckboxItem')
    expect(row).toMatch(/aria-label=\{`Purpose: \$\{purposeSummary\}`\}/u)
    expect(row).not.toContain('>Purpose</span>')
  })

  it('picks the chart grouping from a select on the filter row, not on the chart card', () => {
    const panel = read('panel.tsx')
    const row = panel.slice(panel.indexOf('aria-label="Filters"'), panel.indexOf("preferences.tab === 'log' ?"))
    expect(row).toMatch(/<SelectTrigger aria-label=\{`Group: /u)
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
    const titleRow = /<span className="[^"]*" data-usage-chart-title-row>([\s\S]*?)<\/span>\s*<span className="[^"]*dshx:text-xs[^"]*">/u.exec(
      header?.[2] ?? '',
    )
    expect(titleRow?.[1]).toContain('Usage over time')
    expect(titleRow?.[1]).toContain('<SlidingSegments size="sm" aria-label="Usage measure"')
    // The chart is its own hairline card (council round 6, D1): no loose hairline right under the stats card.
    expect(charts).toMatch(/<ChartFrame className=\{TREND_CARD\}>\s*\{\/\*[\s\S]*?\*\/\}\s*<header className="[^"]*" data-usage-chart-header>/u)
  })
})

describe('Usage filter row (council round 5 A1/D1)', () => {
  it('draws Custom, the time grouping, By and Purpose at the kit control height, level with the range segments', () => {
    const panel = read('panel.tsx')
    const row = panel.slice(panel.indexOf('aria-label="Filters"'), panel.indexOf("{preferences.tab === 'log' ? ("))
    expect(row).toContain('<SlidingSegments')
    expect(row).not.toContain('size="sm"')
  })
})

describe('Usage page width (council round 5 A2)', () => {
  it('sits on the wide data frame and marks the current section with the kit ink bar (council round 7, D6)', () => {
    expect(read('panel.tsx')).toMatch(/<Page\s+scroll\s+(?:\/\/[^\n]*\n\s*)?width="wide"/u)
    expect(read('panel.tsx')).toContain('dshx:after:bg-foreground')
    expect(read('panel.tsx')).not.toContain('dshx:after:bg-(--dsw-alias-state-business-primary)')
  })
})

describe('Usage page title mark (council round 7, D1; round 18, D2)', () => {
  it("marks the h1 with Usage's own bar-chart glyph, the left column entry's, in the Observe nav tone", () => {
    const page = read('panel.tsx').slice(read('panel.tsx').indexOf('<Page'), read('panel.tsx').indexOf('heading="Usage"'))
    expect(page).toContain('mark={<UsageGlyph />}')
    expect(read('client.tsx')).toMatch(/const PanelGlyph = UsageGlyph\b/u)
    expect(page).toContain('markTone="observe"')
  })
})

describe('Usage filter triggers (council round 7, D3 / A4)', () => {
  it('draws Custom and Purpose, which show a value, in the field look of the selects beside them', () => {
    const panel = read('panel.tsx')
    const row = panel.slice(panel.indexOf('aria-label="Filters"'), panel.indexOf("{preferences.tab === 'log' ? ("))
    const custom = /<PopoverTrigger asChild>\s*<Button([^>]*?)>/u.exec(row)?.[1] ?? ''
    expect(custom).toContain('variant="field"')
    expect(custom).not.toContain('aria-pressed:border')
    const purpose = /<DropdownMenuTrigger asChild>\s*<Button([^>]*?)>/u.exec(row)?.[1] ?? ''
    expect(purpose).toContain('variant="field"')
    expect(row).not.toContain('variant="outline"')
  })

  it('ends Custom with the chevron its neighbours end with, so it reads as the same filled trigger (council round 14, D1)', () => {
    const panel = read('panel.tsx')
    const row = panel.slice(panel.indexOf('aria-label="Filters"'), panel.indexOf("{preferences.tab === 'log' ? ("))
    const custom = /<PopoverTrigger asChild>([\s\S]*?)<\/PopoverTrigger>/u.exec(row)?.[1] ?? ''
    expect(custom).toMatch(/'Custom'\}\s*<ChevronDownIcon aria-hidden \/>\s*<\/Button>/u)
  })
})

describe('Usage filter labels and spacing (council round 11, D1)', () => {
  const panel = read('panel.tsx')
  const row = panel.slice(panel.indexOf('aria-label="Filters"'), panel.indexOf("{preferences.tab === 'log' ? ("))

  it('names every trigger in one grammar: "Grain: Daily", "Group: Model", "Purpose: All"', () => {
    const labels = [...row.matchAll(/<span className="dshx:text-muted-foreground">([^<]+)<\/span>/gu)].map(match => match[1])
    expect(labels).toEqual(['Grain:', 'Group:', 'Purpose:'])
    expect(row).not.toContain('>By</span>')
    // The accessible name says what the trigger shows.
    expect(row).toContain('aria-label={`Grain: ${BUCKET_LABELS[preferences.bucket]}`}')
    expect(row).toMatch(/aria-label=\{`Group: \$\{[^}]+\}`\}/u)
  })

  it('sets the range (segments and Custom) 16 px from the triggers, 8 px inside each group', () => {
    expect(/aria-label="Filters"/u.test(row)).toBe(true)
    const outer = /className="([^"]*)"\s*role="group"\s*aria-label="Filters"/u.exec(panel)?.[1] ?? ''
    expect(outer).toContain('dshx:gap-x-4')
    const groups = [...row.matchAll(/<div className="([^"]*)" data-usage-filter-group="(range|view)">/gu)].map(match => [match[2], match[1]] as const)
    expect(groups.map(([name]) => name)).toEqual(['range', 'view'])
    for (const [, className] of groups) expect(className).toContain('dshx:gap-2')
  })
})

describe('Usage overview chart (council round 7, D3)', () => {
  const charts = read('charts.tsx')
  it('names the chart "Usage over time" with a caption that says its bucket and grouping, and draws it 190 px tall', () => {
    const header = /<header className="[^"]*" data-usage-chart-header>([\s\S]*?)<\/header>/u.exec(charts)?.[1] ?? ''
    expect(header).toContain('Usage over time')
    expect(header).not.toContain('grouped by the selected dimension')
    expect(header).toContain('trendCaption(')
    expect(charts).toMatch(/const TREND_CHART_HEIGHT = 190\b/u)
    expect(charts).toMatch(/definition=\{trendChart\}\s*height=\{TREND_CHART_HEIGHT\}/u)
  })
  it('captions the bucket and the grouping as one short line', () => {
    expect(trendCaption({ bucket: 'day', groupBy: 'model', metric: 'tokens' })).toBe('Daily · by model')
    expect(trendCaption({ bucket: 'hour', groupBy: 'provider', metric: 'requests' })).toBe('Hourly · by account')
    expect(trendCaption({ bucket: 'day', groupBy: 'project', metric: 'cost' })).toBe('Daily · by project · list-price estimate')
  })
})
