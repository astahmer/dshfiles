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

  it('aligns each header with its values, reserves the sort-arrow slot and drops the header band (council round 12, D1)', () => {
    const markup = renderToStaticMarkup(<UsageBreakdownTable view={view} groupBy="model" onShowRequests={() => 'opened'} />)
    // The variant follows the prefix: `first:dshx:…` is not a utility Tailwind generates.
    expect(markup).not.toMatch(/\bfirst:dshx:/u)
    const headers = markup.match(/<th [^>]*>.*?<\/th>/gsu) ?? []
    expect(headers).toHaveLength(11)
    for (const header of headers) {
      expect(header).toContain('dshx:first:text-left')
      // The sort control is a bare button: no padding of its own pushes the label off the column's value edge.
      expect(header).not.toContain('data-slot="button"')
      expect(header).not.toMatch(/<button[^>]*dshx:px-[0-9]/u)
      // The arrow seat is always there, so sorting never shifts the label.
      expect(header).toMatch(/data-sort-slot=""/u)
    }
    // Numeric columns put the seat before the label, so the label ends on the values' right edge.
    expect(headers[1]).toMatch(/data-sort-slot=""[^>]*><\/span>Requests/u)
    expect(headers[0]).toMatch(/Model<span[^>]*data-sort-slot=""/u)
    expect(headers.at(-1)).toMatch(/data-sort-slot=""[^>]*>↓<\/span>Cost/u)
    expect(markup).toMatch(/<th [^>]*aria-sort="descending"[^>]*>.*?Cost<\/button>/su)
    expect(markup).not.toContain('dshx:bg-muted/30')
    expect(markup).toMatch(/<table class="[^"]*dshx:text-sm/u)
    // The Model cell no longer repeats the cost share as a bar: the Cost share column says it.
    expect(markup).not.toContain('dshx:bg-data-1')
    expect(markup).not.toContain('priced share*')
  })

  it('sits in a hairline card like the totals, trend and "Where it went" above it (council round 13, D1)', () => {
    const markup = renderToStaticMarkup(<UsageBreakdownTable view={view} groupBy="model" onShowRequests={() => 'opened'} />)
    const section = markup.match(/^<section class="([^"]*)"/u)?.[1] ?? ''
    for (const token of ['dshx:rounded-lg', 'dshx:border', 'dshx:border-border', 'dshx:bg-card', 'dshx:px-4', 'dshx:pt-3.5']) expect(section.split(' ')).toContain(token)
    expect(section).not.toContain('dshx:border-t')
    // The cells' own 8 px inset is pulled back, so the first column's text starts on the title's edge.
    expect(markup).toMatch(/<div class="[^"]*dshx:-mx-2[^"]*"><table/u)
  })

  it('renders daily cells for a year range in the measure the chart shows, with no switch of its own', () => {
    const from = new Date(2026, 0, 1).getTime()
    const markup = renderToStaticMarkup(<UsageCalendar view={view} metric="tokens" range={{ from, to: from + 365 * 86_400_000 }} />)
    expect(markup).toContain('Daily calendar')
    expect(markup).not.toContain('Calendar metric')
    expect(markup).toContain('>Tokens</span>')
    expect(markup).toContain('Daily tokens over 365 days')
    expect(renderToStaticMarkup(<UsageCalendar view={view} metric="requests" range={{ from, to: from + 365 * 86_400_000 }} />)).toContain(
      'Daily requests over 365 days',
    )
    expect((markup.match(/aria-label="[A-Za-z]+, [A-Za-z]+ \d+, \d{4}: /gu) ?? []).length).toBeGreaterThan(350)
  })
})
