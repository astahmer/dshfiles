import { formatDurationMs } from '@dshfiles/plugin-ui/lib/format-duration'
import { describe, expect, test } from 'vitest'
import { TraceFormat } from './format.js'

describe('trace formatting', () => {
  test('formats durations across magnitudes', () => {
    expect(TraceFormat.duration(null)).toBe('—')
    for (const ms of [0.25, 4.5, 42.25, 420, 1_500, 125_000]) expect(TraceFormat.duration(ms)).toBe(formatDurationMs(ms))
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
