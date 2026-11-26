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

describe('SpendMap › dimension colour (council round 7, D3)', () => {
  const withTones = (leafColor?: string): string =>
    renderToStaticMarkup(
      <SpendMap
        heading="Where it went"
        owner="All accounts"
        total={10}
        format={value => String(value)}
        dimensions={dimensions(leafColor).map(dimension => ({
          ...dimension,
          color: dimension.id === 'model' ? 'var(--dshx-data-1)' : 'var(--dshx-data-2)',
        }))}
        dimensionId="model"
        leafId="a"
        onDimensionChange={() => undefined}
        onLeafChange={() => undefined}
      />,
    )
  const card = (html: string, id: string): string => new RegExp(`<button[^>]*data-node-anchor="dim:${id}".*?</button>`, 'su').exec(html)?.[0] ?? ''

  it("draws an unselected card's top segment and dot in the dimension's colour, not grey", () => {
    const accounts = card(withTones(), 'provider')
    expect(accounts).toContain('aria-checked="false"')
    expect(accounts.match(/background-color:var\(--dshx-data-2\)/gu)).toHaveLength(2)
    expect(accounts).not.toContain('dshx:bg-muted-foreground/40')
  })

  it("draws a selected card with no leaf colour in the dimension's colour, other segments muted", () => {
    const models = card(withTones(), 'model')
    expect(models.match(/background-color:var\(--dshx-data-1\)/gu)).toHaveLength(2)
    expect(models).not.toContain('dshx:bg-foreground')
    expect(models).toContain('dshx:bg-muted-foreground/30')
  })

  it("keeps a selected leaf's series colour over the dimension's", () => {
    const models = card(withTones('var(--dshx-data-3)'), 'model')
    expect(models.match(/background-color:var\(--dshx-data-3\)/gu)).toHaveLength(2)
    expect(models).not.toContain('var(--dshx-data-1)')
  })

  it('leaves an unselected card without a colour muted', () => {
    expect(card(render(), 'provider')).toContain('dshx:bg-muted-foreground/40')
  })
})

describe('SpendMap › active node and connectors (council round 8, D1)', () => {
  const html = render('var(--dshx-data-2)')
  const opening = (anchor: string): string => new RegExp(`<button[^>]*data-node-anchor="${anchor}"[^>]*>`, 'u').exec(html)?.[0] ?? ''

  it('draws the active leaf on the card surface with a 1.5 px edge in its series colour, no grey fill or shadow', () => {
    for (const anchor of ['leaf:model:a']) {
      const node = opening(anchor)
      expect(node).toContain('aria-checked="true"')
      expect(node).toContain('outline-color:var(--dshx-data-2)')
      // An outline drawn over the 1 px border: 1.5 px without moving the content (no layout shift).
      expect(node).toContain('dshx:outline-[length:1.5px] dshx:outline-solid dshx:-outline-offset-[1.5px]')
      expect(node).toContain('dshx:bg-card')
      expect(node).not.toContain('dshx:bg-muted ')
      expect(node).not.toContain('dshx:shadow')
      // The base list's outline-none gives way to the edge (cn merges the outline style).
      expect(node).not.toContain('dshx:outline-none')
    }
  })

  it('edges only the selected leaf: the selected dimension card shows its selection through its connector (council round 9, D1)', () => {
    const node = opening('dim:model')
    expect(node).toContain('aria-checked="true"')
    expect(node).not.toContain('outline-solid')
    expect(node).not.toContain('outline-color')
    expect(node).toContain('dshx:border-border dshx:bg-card')
    // The full-strength route into the card still marks it.
    expect(html).toContain('data-spend-link-active="root:model"')
  })

  it('falls back to ink when the node has no series colour', () => {
    const node = /<button[^>]*aria-checked="true"[^>]*data-node-anchor="leaf:model:a"[^>]*>/u.exec(render())?.[0] ?? ''
    expect(node).toContain('outline-color:var(--dsw-alias-label-primary)')
  })

  it('keeps inactive nodes on the plain 1 px hairline', () => {
    const node = opening('leaf:model:b')
    expect(node).toContain('aria-checked="false"')
    expect(node).toContain('dshx:border-border')
    expect(node).not.toContain('outline-solid')
  })

  it('draws inactive connectors 1 px in the visible field neutral, not the hairline border', () => {
    const base = /<g class="([^"]*)"><g data-spend-link=/u.exec(html)?.[1]
    expect(base).toBe('dshx:text-(--dshx-field-border)')
    expect(html).not.toContain('dshx:text-border')
  })
})
