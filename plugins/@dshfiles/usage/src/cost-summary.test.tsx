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
    expect(markup).toMatch(/<button[^>]*aria-expanded="false"[^>]*>(?:(?!<\/button>).)*More numbers<\/button>/u)
  })
  it('draws each lead number in neutral ink at 20 px semibold tabular figures, with no series dot (council round 2, D1)', () => {
    const values = [...markup.matchAll(/<span class="([^"]*)" data-kpi-value="true">/gu)].map(match => match[1])
    expect(values).toHaveLength(3)
    for (const value of values) expect(value).toContain('dshx:text-xl dshx:font-semibold dshx:tabular-nums')
    // A dot keys a series; no series of the KPI row is on screen, so a coloured dot would be decoration.
    expect(markup).not.toContain('data-kpi-dot')
    expect(markup).not.toMatch(/style="background:/u)
  })
  it('makes "More numbers" a ghost button with a chevron, aligned with the numbers above it', () => {
    const button = /<button([^>]*)>((?:(?!<\/button>).)*)More numbers<\/button>/u.exec(markup)
    expect(button?.[1]).toContain('dshx:-ml-2')
    expect(button?.[1]).toContain('aria-expanded="false"')
    expect(button?.[2]).toMatch(/^<svg[^>]*aria-hidden="true"[^>]*>.*<\/svg>$/u)
  })
  it('explains no absent number and puts the price caveat on the cost, never in a native title', () => {
    expect(markup).not.toContain('no earlier usage to compare')
    expect(markup).toContain('aria-label="About this estimate"')
    expect(markup).not.toContain('title=')
  })
})

describe('Usage › Overview numbers (council round 3, D1)', () => {
  const markup = renderToStaticMarkup(<CostSummary days={7} pricingNote="List-price estimate." summary={summary()} />)
  it('groups the three lead numbers in ~200 px columns instead of spreading them across the page', () => {
    const grid = /<div class="([^"]*)"><div class="[^"]*"><span[^>]*>Cost \(estimate\)/u.exec(markup)
    expect(grid?.[1]).toContain('dshx:@min-[42rem]:grid-cols-[repeat(3,200px)]')
  })
})
