import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ChartView } from './api.js'
import { UsageSpendMap } from './usage-spend-map.js'

const row = (key: string, cost: number, requests: number): ChartView['breakdown']['model'][number] => ({
  key,
  cost,
  requests,
  tokens: requests * 100,
  missingUsage: 0,
  unpriced: 0,
})

const view: ChartView = {
  summary: {
    cost: 9,
    requests: 9,
    failed: 0,
    aborted: 0,
    input: 600,
    cacheRead: 200,
    cacheWrite: 0,
    output: 100,
    unpriced: 0,
    missingUsage: 0,
    averageDurationMs: null,
    cacheSavings: 0,
    turns: 0,
    previous: { cost: 0, requests: 0, tokens: 0, averageDurationMs: null, cacheSavings: 0, turns: 0 },
  },
  keys: ['m1'],
  buckets: [],
  breakdown: { model: [row('m1', 9, 9)], provider: [row('Codex', 9, 9)], project: [], purpose: [row('subagent', 9, 9)] },
  latency: [],
  topThreads: [],
}

const render = (metric: 'cost' | 'tokens' | 'requests'): string =>
  renderToStaticMarkup(
    <UsageSpendMap
      view={view}
      metric={metric}
      range={{ from: 0, to: 86_400_000 }}
      groupBy="model"
      onGroupBy={() => undefined}
      onShowRequests={() => undefined}
    />,
  )

describe('Usage › Where it went (council round 2, D1)', () => {
  it('has no measure switch of its own and shows the measure the chart card picked', () => {
    expect(render('cost')).not.toContain('aria-label="Measure"')
    expect(render('tokens')).toContain('900')
    expect(render('requests')).not.toContain('$9')
  })

  it('shows the total as a plain value: the gauge drawing is hidden and its box hugs the number', () => {
    const section = /<section aria-label="Where it went" class="([^"]*)"/u.exec(render('cost'))
    const classes = (section?.[1] ?? '').replaceAll('&gt;', '>').replaceAll('&amp;', '&')
    expect(classes).toContain('dshx:[&_[data-node-anchor=root]_svg]:hidden')
    expect(classes).toContain('dshx:[&_[data-node-anchor=root]>div]:size-auto')
    expect(classes).toContain('dshx:[&_[data-node-anchor=root]>div>div]:static')
  })
})

describe('Usage › Where it went (council round 3, D1)', () => {
  const twoModels: ChartView = {
    ...view,
    keys: ['m0', 'm1'],
    breakdown: { ...view.breakdown, model: [row('m1', 6, 6), row('m0', 3, 3)] },
  }
  const html = renderToStaticMarkup(
    <UsageSpendMap
      view={twoModels}
      metric="cost"
      range={{ from: 0, to: 86_400_000 }}
      groupBy="model"
      onGroupBy={() => undefined}
      onShowRequests={() => undefined}
    />,
  )

  it('draws each ribbon in the colour the chart gives the same key: series order, not rank', () => {
    expect(html).toContain('data-spend-link="leaf:model:m0" style="color:var(--dshx-data-1)"')
    expect(html).toContain('data-spend-link="leaf:model:m1" style="color:var(--dshx-data-2)"')
  })

  it('draws the map on the card, without an inner frame', () => {
    expect(html).toContain('data-spend-map-inset="flush"')
  })
})

describe('Usage › Where it went (council round 5, D1)', () => {
  const branded: ChartView = {
    ...view,
    keys: ['gpt-6-luna'],
    breakdown: { ...view.breakdown, model: [row('gpt-6-luna', 9, 9)], provider: [row('dshx_fake_codex', 9, 9)] },
  }
  const html = renderToStaticMarkup(
    <UsageSpendMap
      view={branded}
      metric="cost"
      range={{ from: 0, to: 86_400_000 }}
      groupBy="model"
      onGroupBy={() => undefined}
      onShowRequests={() => undefined}
    />,
  )
  it("seats the model's brand mark in the end node instead of its first letter", () => {
    const seat = /data-node-anchor="leaf:model:gpt-6-luna"[^>]*><span[^>]*>(.*?)<\/span><span/u.exec(html)
    expect(seat?.[1]).toContain('data-model-mark="openai"')
  })
  it('keeps the letter for an entry no brand names', () => {
    const plain = renderToStaticMarkup(
      <UsageSpendMap
        view={view}
        metric="cost"
        range={{ from: 0, to: 86_400_000 }}
        groupBy="model"
        onGroupBy={() => undefined}
        onShowRequests={() => undefined}
      />,
    )
    expect(/data-node-anchor="leaf:model:m1"[^>]*><span[^>]*>(.*?)<\/span>/u.exec(plain)?.[1]).toBe('m')
  })
  it('caps the end nodes at 280 px through the kit prop, not a class override', () => {
    expect(html).toMatch(/<div role="radiogroup" aria-label="Models"[^>]*style="max-width:280px"/u)
  })
})
