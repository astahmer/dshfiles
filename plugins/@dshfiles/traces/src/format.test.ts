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

  test('formats rates', () => {
    expect(TraceFormat.percent(0)).toBe('0%')
    expect(TraceFormat.percent(0.0004)).toBe('<0.1%')
    expect(TraceFormat.percent(0.05)).toBe('5.0%')
    expect(TraceFormat.percent(0.5)).toBe('50%')
  })

  test('gives each service one stable tone', () => {
    expect(TraceFormat.serviceTone('checkout')).toBe(TraceFormat.serviceTone('checkout'))
    expect(TraceFormat.serviceTone('checkout')).toMatch(/^dshx:bg-/)
  })
})
