import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ChartView, JevUsageView } from './api.js'
import { CostSummary, usageIsEmpty } from './cost-summary.js'
import { JevUsageCard } from './jev-usage-card.js'

const summary = (patch: Partial<ChartView['summary']> = {}): ChartView['summary'] => ({
  cost: 0.02,
  requests: 2,
  failed: 0,
  aborted: 0,
  input: 120,
  cacheRead: 20,
  cacheWrite: 10,
  output: 50,
  unpriced: 0,
  missingUsage: 0,
  averageDurationMs: 20,
  cacheSavings: 0,
  turns: 2,
  previous: { cost: 0, requests: 0, tokens: 0, averageDurationMs: null, cacheSavings: 0, turns: 0 },
  ...patch,
})
const noJev: JevUsageView = {
  calls: 0,
  succeeded: 0,
  failed: 0,
  inputTokens: 0,
  outputTokens: 0,
  callsWithoutInputUsage: 0,
  estimatedCostUsd: 0,
  byCredential: [],
}

describe('Usage › Cost with nothing to say', () => {
  it('calls a range with no request empty, so the page shows one sentence instead of a grid of zeros', () => {
    expect(usageIsEmpty(summary({ requests: 0, cost: 0, turns: 0 }))).toBe(true)
    expect(usageIsEmpty(summary())).toBe(false)
  })
  it('draws no Jev block until DSH has recorded a Jev call', () => {
    expect(renderToStaticMarkup(<JevUsageCard error={undefined} failed={false} usage={noJev} />)).toBe('')
    expect(renderToStaticMarkup(<JevUsageCard error={undefined} failed={false} usage={undefined} />)).toBe('')
    expect(renderToStaticMarkup(<JevUsageCard error={new Error('offline')} failed usage={undefined} />)).toContain('Jev API usage')
  })
})

describe('Usage › Cost numbers', () => {
  const markup = renderToStaticMarkup(<CostSummary days={7} pricingNote="List-price estimate from the models.dev catalog." summary={summary()} />)
  it('leads with three numbers and folds the rest', () => {
    for (const label of ['Cost (estimate)', 'Requests', 'Cache hit']) expect(markup).toContain(`>${label}<`)
    for (const label of ['Per day', 'Failed / aborted', 'Cache savings (estimate)', 'Cost per turn']) expect(markup).not.toContain(label)
    expect(markup).toMatch(/<button[^>]*aria-expanded="false"[^>]*>(?:<span[^>]*>)?More numbers(?:(?!<\/button>).)*<\/button>/u)
  })
  it('draws each lead number in neutral ink at 22/650 tabular figures, with no series dot (council round 5, D1)', () => {
    const values = [...markup.matchAll(/<span class="([^"]*)" data-kpi-value="true">/gu)].map(match => match[1])
    expect(values).toHaveLength(3)
    for (const value of values) expect(value).toContain('dshx:text-title dshx:font-title dshx:tabular-nums')
    // A dot keys a series; no series of the KPI row is on screen, so a coloured dot would be decoration.
    expect(markup).not.toContain('data-kpi-dot')
    expect(markup).not.toMatch(/style="background:/u)
  })
  it('puts "More numbers" in the stats card\'s top-right corner as a 13 px text link, with no footer (council round 8, D1)', () => {
    const button = /<button([^>]*)>(?:<span[^>]*>)?More numbers((?:(?!<\/button>).)*)<\/button>/u.exec(markup)
    expect(button?.[1]).toContain('aria-expanded="false"')
    expect(button?.[1]).toContain('dshx:text-sm')
    expect(button?.[1]).toContain('dshx:hover:underline')
    // Pinned to the card's corner on the label line, not a full-width footer row under a hairline.
    expect(button?.[1]).toContain('dshx:absolute')
    expect(button?.[1]).toContain('dshx:top-2.5')
    expect(button?.[1]).toContain('dshx:right-4')
    expect(button?.[2]).toMatch(/<svg[^>]*aria-hidden="true"[^>]*>.*<\/svg>$/u)
    expect(markup).not.toContain('data-usage-stats-more')
    const card = /<div data-usage-stats="true" class="([^"]*)">/u.exec(markup)
    expect(card?.[1]).toContain('dshx:relative')
    // A narrow pane keeps the chevron and the accessible name; the words give way before they collide with "Cache hit".
    expect(markup).toMatch(/<span class="dshx:@max-pane-narrow:sr-only">More numbers<\/span>/u)
  })
  it('gives the three lead numbers the same structure: label and value, no sub-line under one of them (council round 8, D1)', () => {
    // The three cells: from the row up to the More numbers link (the only control with aria-expanded).
    const row = markup.slice(markup.indexOf('data-usage-stats-row'), markup.indexOf('aria-expanded'))
    expect(row).not.toContain('dshx:text-2xs')
    expect(row).not.toContain('cached prompt tokens')
    // The cached-token count lives with the savings it earned, behind More numbers.
    const open = renderToStaticMarkup(<CostSummary days={7} pricingNote="" summary={summary()} defaultOpen />)
    expect(open).toContain('20 cached prompt tokens')
  })
  it('shows a change against the previous period beside its value, not as a sub-line', () => {
    const compared = renderToStaticMarkup(
      <CostSummary days={7} pricingNote="" summary={summary({ previous: { cost: 0.01, requests: 1, tokens: 0, averageDurationMs: null, cacheSavings: 0, turns: 0 } })} />,
    )
    const values = [...compared.matchAll(/<span class="([^"]*)" data-kpi-line="true">(.*?)<\/span><\/span><\/div>/gu)]
    expect(values.length).toBeGreaterThanOrEqual(2)
    for (const [, className, inner] of values.slice(0, 2)) {
      expect(className).toContain('dshx:items-baseline')
      expect(inner).toContain('▲')
      expect(inner).toContain('vs previous period')
    }
  })
  it('explains no absent number and puts the price caveat on the cost, never in a native title', () => {
    expect(markup).not.toContain('no earlier usage to compare')
    expect(markup).toContain('aria-label="About this estimate"')
    expect(markup).not.toContain('title=')
  })
})

describe('Usage › Overview numbers (council round 5, D1)', () => {
  const markup = renderToStaticMarkup(<CostSummary days={7} pricingNote="List-price estimate." summary={summary()} />)
  it('sets the three lead numbers in one hairline card, split by two dividers', () => {
    const card = /<div data-usage-stats="true" class="([^"]*)">/u.exec(markup)
    expect(card?.[1]).toContain('dshx:rounded-lg dshx:border dshx:border-border')
    const row = /<div class="([^"]*)" data-usage-stats-row="true">(.*?)<button[^>]*aria-expanded/u.exec(markup)
    expect(row?.[1]).toContain('dshx:divide-x dshx:divide-border')
    expect(row?.[1]).toContain('dshx:grid-cols-3')
    // Three cells: two dividers between them, none after the last.
    expect([...(row?.[2] ?? '').matchAll(/data-kpi-value/gu)]).toHaveLength(3)
  })
})
