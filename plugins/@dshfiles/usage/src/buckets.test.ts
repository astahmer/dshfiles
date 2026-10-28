import { barY, createChartScene, defineChart, scaleBand, scaleLinear } from '@dshfiles/plugin-ui/chart'
import { describe, expect, it } from 'vitest'
import { UsageBucketsModel } from './buckets.js'

const scene = (rows: { position: string; series: string; value: number }[]) =>
  createChartScene(
    defineChart({
      marks: [barY(rows, { x: 'position', y: 'value', color: 'series' })],
      scales: { x: { scale: scaleBand }, y: { scale: scaleLinear } },
    }),
    { width: 800, height: 220 },
  )

describe('usage bucket chart identity', () => {
  it('reproduces the pinned stack error when distinct hours share a formatted day label', () => {
    const start = Date.UTC(2026, 9, 25)
    const rows = [0, 1].map(hour => ({
      position: UsageBucketsModel.bucketLabel(start + hour * UsageBucketsModel.HOUR_MS, 'day', true),
      series: 'Input',
      value: hour + 1,
    }))
    expect(() => scene(rows)).toThrow(/duplicate/u)
  })

  it('preserves the two Europe/Paris fall-back 02:00 buckets for model, token and tool series', () => {
    const starts = [Date.parse('2026-10-25T00:00:00Z'), Date.parse('2026-10-25T01:00:00Z')]
    const display = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })
    expect(starts.map(start => display.format(start))).toEqual(['02:00', '02:00'])
    for (const series of ['gpt-6.1-sol', 'Input', 'DSH tools']) {
      const rows = starts.map((start, index) => ({ position: UsageBucketsModel.bucketKey(start), series, value: index + 1 }))
      expect(rows[0]?.position).not.toBe(rows[1]?.position)
      expect(() => scene(rows)).not.toThrow()
    }
  })

  it('retains all hourly points even when the selected grouping or display label changes', () => {
    const start = Date.UTC(2026, 9, 25)
    const rows = Array.from({ length: 24 }, (_, hour) => ({
      position: UsageBucketsModel.bucketKey(start + hour * UsageBucketsModel.HOUR_MS),
      series: 'Input',
      value: hour + 1,
    }))
    expect(new Set(rows.map(row => row.position)).size).toBe(24)
    expect(rows.reduce((sum, row) => sum + row.value, 0)).toBe(300)
    expect(() => scene(rows)).not.toThrow()
  })
})
