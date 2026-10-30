import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ChartView } from './api.js'
import { UsageBreakdownTable, UsageCalendar } from './usage-history.js'

const view: ChartView = {
  summary: {
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
  },
  keys: ['Codex-Alex'],
  buckets: [
    {
      start: 1_782_604_800_000,
      key: 'Codex-Alex',
      cost: 0.02,
      requests: 2,
      failed: 0,
      input: 120,
      cacheRead: 20,
      cacheWrite: 10,
      output: 50,
      missingUsage: 0,
      unpriced: 0,
    },
  ],
  breakdown: {
    model: [
      {
        key: 'model-a',
        cost: 0.02,
        requests: 2,
        sessions: 1,
        input: 120,
        cacheRead: 20,
        cacheWrite: 10,
        output: 50,
        tokens: 200,
        missingUsage: 0,
        unpriced: 0,
      },
    ],
    provider: [
      {
        key: 'Codex-Alex',
        cost: 0.02,
        requests: 2,
        sessions: 1,
        input: 120,
        cacheRead: 20,
        cacheWrite: 10,
        output: 50,
        tokens: 200,
        missingUsage: 0,
        unpriced: 0,
      },
    ],
    project: [],
    purpose: [],
  },
  latency: [],
  topThreads: [],
}

describe('usage history views', () => {
  it('renders sortable group metrics and cache/cost distribution shares', () => {
    const markup = renderToStaticMarkup(<UsageBreakdownTable view={view} groupBy="provider" onShowRequests={() => 'opened'} />)
    expect(markup).toContain('Provider / account')
    expect(markup).toContain('Avg tokens / req')
    expect(markup).toContain('Cache share')
    expect(markup).toContain('Cost share')
    expect(markup).toContain('100%')
    expect(markup).toContain('Codex-Alex')
  })

  it('renders daily cells for a year range with switchable metric controls', () => {
    const from = new Date(2026, 0, 1).getTime()
    const markup = renderToStaticMarkup(<UsageCalendar view={view} range={{ from, to: from + 365 * 86_400_000 }} />)
    expect(markup).toContain('Daily calendar')
    expect(markup).toContain('Calendar metric')
    expect(markup).toContain('Daily tokens over 365 days')
    expect((markup.match(/aria-label="[A-Za-z]+, [A-Za-z]+ \d+, \d{4}: /gu) ?? []).length).toBeGreaterThan(350)
  })
})
