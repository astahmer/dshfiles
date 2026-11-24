import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sources = readdirSync(new URL('.', import.meta.url))
  .filter(name => name.endsWith('.tsx') && !name.includes('.test.'))
  .map(name => ({ name, text: readFileSync(new URL(name, import.meta.url), 'utf8') }))

describe('usage charts colour series by the data ramp (DESIGN.md › Colour roles 8)', () => {
  it('never paints a series from the status-hued chart palette', () => {
    const offenders = sources.filter(source => /--ts-chart-\d|dshx:bg-chart-\d/u.test(source.text)).map(source => source.name)
    expect(offenders).toEqual([])
  })
  it('gives every categorical colour scale an explicit range, so series 2–4 never fall back to green, amber and red', () => {
    const missing = sources.flatMap(source =>
      [...source.text.matchAll(/color: \{[^}]*domain:[\s\S]*?\}/gu)].filter(match => !match[0].includes('range:')).map(() => source.name),
    )
    expect(missing).toEqual([])
  })
  it('colours only the Failed series with the danger hue', async () => {
    const { DATA_SERIES, FAILED_SERIES } = await import('./data-series.js')
    expect(DATA_SERIES).toHaveLength(6)
    expect(DATA_SERIES.join(' ')).not.toMatch(/success|warn|error/u)
    expect(FAILED_SERIES).toContain('error')
    expect(sources.filter(source => source.text.includes('FAILED_SERIES')).map(source => source.name)).toEqual(['charts.tsx'])
  })
})
