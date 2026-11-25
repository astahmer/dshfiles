import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { BAND_PADDING, BAR_GEOMETRY, CHART_GRID, singleBucketTotal } from './chart-geometry.js'

const read = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8')

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
