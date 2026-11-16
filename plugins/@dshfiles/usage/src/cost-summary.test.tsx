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
    expect(markup).toMatch(/<button[^>]*aria-expanded="false"[^>]*>More numbers<\/button>/u)
  })
  it('explains no absent number and puts the price caveat on the cost, never in a native title', () => {
    expect(markup).not.toContain('no earlier usage to compare')
    expect(markup).toContain('aria-label="About this estimate"')
    expect(markup).not.toContain('title=')
  })
})
