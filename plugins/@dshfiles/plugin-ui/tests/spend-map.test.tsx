import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SpendMap, type SpendDimension } from '../src/components/motion/spend-map.js'

const dimensions: readonly SpendDimension[] = [
  {
    id: 'model',
    label: 'Models',
    leaves: [
      { id: 'luna', label: 'luna', amount: 6, share: 0.6, color: 'var(--dshx-data-1)' },
      { id: 'sol', label: 'sol', amount: 4, share: 0.4 },
    ],
  },
]

const render = (props: { readonly inset?: 'framed' | 'flush'; readonly leafMaxWidth?: number } = {}): string =>
  renderToStaticMarkup(
    <SpendMap
      heading="Where it went"
      total={10}
      owner="All accounts"
      dimensions={dimensions}
      dimensionId="model"
      onDimensionChange={() => undefined}
      leafId={null}
      onLeafChange={() => undefined}
      {...props}
    />,
  )

describe('SpendMap', () => {
  it('draws a leaf with a colour in that colour: its ribbon, its end dots and its letter seat', () => {
    const html = render()
    // The ribbon and end-dot groups of the coloured leaf carry its colour; the uncoloured leaf keeps the neutral ink.
    expect(html).toContain('data-spend-link="leaf:model:luna" style="color:var(--dshx-data-1)"')
    expect(html).toMatch(/data-spend-link="leaf:model:sol"(?! style)/u)
    const seat = /data-node-anchor="leaf:model:luna"[^>]*>\s*<span[^>]*style="([^"]*)"/u.exec(html)
    expect(seat?.[1]).toContain('border-color:var(--dshx-data-1)')
    expect(seat?.[1]).toContain('color-mix(in oklab, var(--dshx-data-1) 14%, transparent)')
  })

  it('frames the map in an inner box by default and drops that box when flush', () => {
    const frame = 'dshx:mx-2.5 dshx:overflow-x-auto dshx:overflow-y-hidden dshx:rounded-xl dshx:border'
    expect(render()).toContain(frame)
    expect(render({ inset: 'flush' })).not.toContain(frame)
    expect(render({ inset: 'flush' })).toContain('data-spend-map-inset="flush"')
  })

  it('caps the end-node column at leafMaxWidth, and leaves it to fill the row without one (council round 5 D1)', () => {
    const column = (html: string): string | undefined => /<div role="radiogroup" aria-label="Models"([^>]*)>/u.exec(html)?.[1]
    expect(column(render({ leafMaxWidth: 280 }))).toContain('style="max-width:280px"')
    expect(column(render())).not.toContain('max-width')
  })
})
