import { describe, expect, test } from 'vitest'
import { TraceFormat } from './format.js'

describe('trace formatting', () => {
  test('formats durations across magnitudes', () => {
    expect(TraceFormat.duration(null)).toBe('—')
    expect(TraceFormat.duration(0.25)).toBe('250 µs')
    expect(TraceFormat.duration(4.5)).toBe('4.50 ms')
    expect(TraceFormat.duration(42.25)).toBe('42.3 ms')
    expect(TraceFormat.duration(420)).toBe('420 ms')
    expect(TraceFormat.duration(1_500)).toBe('1.50 s')
    expect(TraceFormat.duration(125_000)).toBe('2 m 5 s')
  })

  test('formats rates and axis ticks', () => {
    expect(TraceFormat.percent(0)).toBe('0%')
    expect(TraceFormat.percent(0.0004)).toBe('<0.1%')
    expect(TraceFormat.percent(0.05)).toBe('5.0%')
    expect(TraceFormat.percent(0.5)).toBe('50%')
    expect(TraceFormat.axisTicks(100).map(tick => tick.label)).toEqual(['0 µs', '25.0 ms', '50.0 ms', '75.0 ms', '100 ms'])
  })

  test('gives each service one stable tone', () => {
    expect(TraceFormat.serviceTone('checkout')).toBe(TraceFormat.serviceTone('checkout'))
    expect(TraceFormat.serviceTone('checkout')).toMatch(/^dshx:bg-/)
  })

  test('hides the descendants of collapsed spans only', () => {
    const rows = [
      { spanId: 'root', depth: 0 },
      { spanId: 'a', depth: 1 },
      { spanId: 'a1', depth: 2 },
      { spanId: 'a2', depth: 2 },
      { spanId: 'b', depth: 1 },
      { spanId: 'b1', depth: 2 },
    ]
    expect(TraceFormat.visibleRows(rows, new Set(['a'])).map(row => row.spanId)).toEqual(['root', 'a', 'b', 'b1'])
    expect(TraceFormat.visibleRows(rows, new Set(['root'])).map(row => row.spanId)).toEqual(['root'])
    expect(TraceFormat.visibleRows(rows, new Set()).map(row => row.spanId)).toEqual(rows.map(row => row.spanId))
  })
})
