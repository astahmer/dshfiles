import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { SpendMap, type SpendDimension } from './spend-map.js'

const dimensions = (color?: string): SpendDimension[] => [
  {
    id: 'model',
    label: 'Models',
    leaves: [
      { id: 'a', label: 'Model A', amount: 6, share: 0.6, ...(color !== undefined && { color }) },
      { id: 'b', label: 'Model B', amount: 4, share: 0.4 },
    ],
  },
  { id: 'provider', label: 'Accounts', leaves: [{ id: 'acme', label: 'Acme', amount: 10, share: 1 }] },
]

const render = (color?: string): string =>
  renderToStaticMarkup(
    <SpendMap
      heading="Where it went"
      owner="All accounts"
      total={10}
      format={value => String(value)}
      dimensions={dimensions(color)}
      dimensionId="model"
      leafId="a"
      onDimensionChange={() => undefined}
      onLeafChange={() => undefined}
    />,
  )

const selectedCard = (html: string): string => /<button[^>]*aria-checked="true"[^>]*data-node-anchor="dim:model".*?<\/button>/su.exec(html)?.[0] ?? ''

describe('SpendMap › series colour (council round 4, D1)', () => {
  it("paints the selected dimension's strip segment and dot in the selected leaf's series colour", () => {
    const card = selectedCard(render('var(--dshx-data-2)'))
    expect(card).not.toBe('')
    expect(card.match(/background-color:var\(--dshx-data-2\)/gu)).toHaveLength(2)
    expect(card).not.toContain('dshx:bg-foreground')
  })

  it('draws the root branch to the selected dimension in the same colour', () => {
    const html = render('var(--dshx-data-2)')
    expect(html).toContain('data-spend-link="root:model" style="color:var(--dshx-data-2)"')
    expect(html).toContain('data-spend-link-active="root:model" style="color:var(--dshx-data-2)"')
    expect(html).not.toContain('data-spend-link="root:provider" style=')
  })

  it('keeps the ink default when a leaf carries no colour', () => {
    const html = render()
    expect(selectedCard(html)).toContain('dshx:bg-foreground')
    expect(html).not.toContain('style="color:')
  })
})
