import { barY, createChartScene, defineChart, renderChartSvg, scaleBand } from '@dshfiles/plugin-ui/chart'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BAND_PADDING,
  BAR_GEOMETRY,
  CHART_GRID,
  SPARSE_TREND_CHART_HEIGHT,
  TREND_CHART_HEIGHT,
  VALUE_SCALE,
  singleBucketTotal,
  TrendChart,
  trendRows,
} from './chart-geometry.js'

const read = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8')

describe('Usage value axes (council round 13, D1)', () => {
  const tickLabels = (peak: number): string[] => {
    const definition = defineChart({
      marks: [barY([{ label: 'a', value: 0 }, { label: 'b', value: peak }], { x: 'label', y: 'value', ...BAR_GEOMETRY })],
      scales: { x: { scale: () => scaleBand<string>().domain(['a', 'b']) }, y: { ...VALUE_SCALE, axis: { ticks: { count: 4 } } } },
    })
    const svg = renderChartSvg(createChartScene(definition, { width: 600, height: 190 }), { ariaLabel: 'Tokens over time' })
    return [...svg.matchAll(/>(\d+)</gu)].map(match => match[1] ?? '')
  }
  it('rounds the top of the domain up to a tick, so a 55K bar sits under 60K instead of touching the ceiling', () => {
    expect(tickLabels(55_000).at(-1)).toBe('60000')
    expect(tickLabels(16).at(-1)).toBe('20')
  })
  it('gives every inferred value axis in Usage a rounded domain', () => {
    for (const name of ['charts.tsx', 'tools-tab.tsx', 'account-usage-dashboard.tsx']) {
      const source = read(name)
      // A bare factory infers its domain from the data; it must round it, or take VALUE_SCALE.
      for (const axis of source.matchAll(/\{[^{}]*scale: scaleLinear,[^{}]*/gu)) expect(axis[0], name).toMatch(/nice: true/u)
    }
  })
})

describe('Usage bar geometry (round five P1)', () => {
  it('caps a bar at 40–48 px with a 3–4 px top radius, so a single bucket cannot span the plot', () => {
    expect(BAR_GEOMETRY.maxThickness).toBeGreaterThanOrEqual(40)
    expect(BAR_GEOMETRY.maxThickness).toBeLessThanOrEqual(48)
    expect(BAR_GEOMETRY.radius.end).toBeGreaterThanOrEqual(3)
    expect(BAR_GEOMETRY.radius.end).toBeLessThanOrEqual(4)
    expect(BAR_GEOMETRY.radius.stack).toBe('outer')
  })
  it('fills about 85 % of a band', () => {
    expect(1 - BAND_PADDING).toBeCloseTo(0.85, 2)
  })
  it('draws gridlines in the hairline border at half strength', () => {
    expect(CHART_GRID).toEqual({ stroke: 'var(--dsw-alias-border-l2)', strokeOpacity: 0.5 })
  })
  it('gives every bar and grid on the Cost and Tools tabs the shared geometry', () => {
    for (const name of ['charts.tsx', 'tools-tab.tsx']) {
      const source = read(name)
      expect(source, name).not.toMatch(/grid: true/u)
      expect(source, name).not.toMatch(/\.padding\(0\.2\)/u)
      for (const call of source.matchAll(/barY\([^)]*\)/gu)) expect(call[0], name).toContain('...BAR_GEOMETRY')
    }
  })
})

describe('Usage value label', () => {
  const rows = [
    { label: 'a', value: 0 },
    { label: 'b', value: 30 },
    { label: 'b', value: 12 },
  ]
  it('totals the one occupied bucket', () => {
    expect(singleBucketTotal(rows, row => row.value)).toEqual({ label: 'b', total: 42 })
  })
  it('labels nothing when two buckets hold a value or none does', () => {
    expect(singleBucketTotal([...rows, { label: 'c', value: 1 }], row => row.value)).toBeNull()
    expect(singleBucketTotal([{ label: 'a', value: 0 }], row => row.value)).toBeNull()
  })
  it('puts the label on the trend chart', () => {
    expect(read('charts.tsx')).toMatch(/text\(\s*trendLabel/u)
  })
})

describe('Usage trend chart height (council round 18, D2)', () => {
  const plot = (labels: readonly string[]) => labels.map(label => ({ label, value: 5 }))
  const devicePlot = (height: number): number => {
    const definition = defineChart({
      marks: [barY([{ label: 'a', value: 55_000 }], { x: 'label', y: 'value', ...BAR_GEOMETRY })],
      scales: { x: { scale: () => scaleBand<string>().domain(['a']) }, y: { ...VALUE_SCALE, axis: { ticks: { count: 4 } } } },
    })
    const scene = createChartScene(definition, { width: 1100, height })
    return 2 * scene.chart.height
  }
  it('keeps the plot under 220 device px at 2× while fewer than three buckets hold data', () => {
    expect(TrendChart.height([...plot(['a', 'b']), { label: 'c', value: 0 }])).toBe(SPARSE_TREND_CHART_HEIGHT)
    expect(devicePlot(TrendChart.height(plot(['a'])))).toBeLessThanOrEqual(220)
  })
  it('keeps the readable height once three buckets hold data', () => {
    expect(TrendChart.height(plot(['a', 'b', 'c']))).toBe(TREND_CHART_HEIGHT)
    expect(read('charts.tsx')).toContain('height={TrendChart.height(trendRows)}')
  })
})

describe('Usage trend rows (council round 3, D1)', () => {
  const DAY = 86_400_000
  const labels = Array.from({ length: 7 }, (_, index) => String(index * DAY))
  const buckets = [{ start: 6 * DAY, key: 'gpt-6-luna', cost: 0, input: 50_000, cacheRead: 0, cacheWrite: 0, output: 5_000, requests: 16 }]
  const rowsFor = (metric: 'cost' | 'tokens' | 'requests') =>
    trendRows({ labels, buckets, labelOf: String, keyOf: key => key, firstKey: 'gpt-6-luna', metric })

  it('gives a 7-day daily view one slot per day in every measure, so its axis shows seven ticks', () => {
    for (const metric of ['cost', 'tokens', 'requests'] as const) {
      expect(new Set(rowsFor(metric).map(row => row.label)), metric).toEqual(new Set(labels))
    }
  })

  it('keeps the recorded values and orders rows by time', () => {
    expect(rowsFor('tokens').at(-1)).toEqual({ label: String(6 * DAY), key: 'gpt-6-luna', value: 55_000 })
    expect(rowsFor('requests').map(row => row.label)).toEqual(labels)
  })
})
