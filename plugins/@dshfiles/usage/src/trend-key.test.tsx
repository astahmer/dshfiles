import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { TrendKey } from './trend-key.js'

describe('Usage › trend legend (council round 10, D1)', () => {
  it('names a single series in the chart header: its swatch and label after the caption', () => {
    const html = renderToStaticMarkup(<TrendKey label="gpt-6-luna" color="var(--dshx-data-1)" />)
    expect(html).toContain('data-usage-trend-key')
    expect(html).toMatch(/<span aria-hidden="true" class="[^"]*dshx:size-2[^"]*dshx:rounded-full[^"]*" style="background-color:var\(--dshx-data-1\)"><\/span>/u)
    expect(html).toContain('>gpt-6-luna<')
  })

  it('drops the chart legend under the bars when there is only one series, and keys it in the header instead', () => {
    const source = readFileSync(new URL('charts.tsx', import.meta.url), 'utf8')
    expect(source).toMatch(
      /color: singleSeries\s*\? \{ domain: trendKeys, range: \[\.\.\.DATA_SERIES\] \}\s*: \{ domain: trendKeys, range: \[\.\.\.DATA_SERIES\], legend: colorLegend\(\{ placement: 'bottom' \}\) \}/u,
    )
    expect(source).toMatch(/singleSeries && trendKeys\[0\] !== undefined \? <TrendKey/u)
  })
})
