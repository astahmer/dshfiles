import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { TraceFormat } from './format.js'

const read = (name: string): string => readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')

describe('Traces colour and durations', () => {
  // DESIGN.md › Colour roles: a service is an identity, drawn with identity tones, not chart, info or accent hues.
  it('draws each service with an identity tone', () => {
    for (const service of ['dsh-host', 'dshx', 'llm-deepseek', 'jj', 'secret', 'multi-host', 'a', 'b', 'c', 'd', 'e']) {
      expect(TraceFormat.serviceTone(service)).toMatch(/^dshx:bg-identity-[1-8]$/u)
      expect(TraceFormat.serviceFill(service)).toMatch(/^dshx:fill-identity-[1-8]$/u)
    }
  })

  it('writes an alert window in the same duration grammar as its threshold', () => {
    expect(read('alerts/alerts-view.tsx')).toContain('TraceFormat.duration(rule.windowMinutes * 60_000)')
  })

  it('labels the minimum duration with its unit, outside the field', () => {
    expect(read('locales.ts')).toContain("minDuration: 'Min duration, ms',")
  })
})
