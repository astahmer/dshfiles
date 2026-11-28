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

describe('SpendMap › one dimension at a time (council round 10, D1)', () => {
  const html = renderToStaticMarkup(
    <SpendMap
      heading="Where it went"
      subtitle="Tokens · input, cache and output"
      owner="All accounts"
      total={10}
      format={value => String(value)}
      dimensions={dimensions('var(--dshx-data-2)')}
      dimensionId="model"
      leafId="a"
      picker="segments"
      onDimensionChange={() => undefined}
      onLeafChange={() => undefined}
    />,
  )
  const header = /<header.*?<\/header>/su.exec(html)?.[0] ?? ''

  it('picks the dimension with a "Share by" segment control in the header, not a column of cards', () => {
    // "Share by", not "Breakdown by": it reads as the split of this card's total, not the page's Group (council round 13, D1).
    expect(header).toContain('>Share by<')
    expect(header).toContain('aria-label="Share by"')
    expect(header).not.toContain('Breakdown by')
    for (const label of ['Models', 'Accounts']) expect(header).toContain(`>${label}<`)
    expect(header).toContain('Tokens · input, cache and output')
    expect(html).not.toContain('data-node-anchor="dim:')
    expect(html).not.toContain('aria-label="Split by"')
  })

  it("draws only the selected dimension's flow: the total straight to its entries", () => {
    expect(html).toContain('data-spend-link="leaf:model:a"')
    expect(html).toContain('data-spend-link="leaf:model:b"')
    expect(html).not.toContain('data-spend-link="root:')
    expect(html).not.toContain('leaf:provider:acme')
    expect(html).toContain('data-spend-link-active="leaf:model:a"')
  })

  it('spans the entries across the card, each label in full beside a bar of its share', () => {
    const column = /<div[^>]*role="radiogroup" aria-label="Models"[^>]*>/u.exec(html)?.[0] ?? ''
    expect(column).not.toContain('max-width')
    expect(column).toContain('dshx:flex-1')
    const node = /<button[^>]*data-node-anchor="leaf:model:a"[^>]*>.*?<\/button>/su.exec(html)?.[0] ?? ''
    expect(node).toMatch(/<span class="[^"]*dshx:whitespace-nowrap[^"]*">Model A<\/span>/u)
    expect(node).not.toMatch(/dshx:truncate[^"]*">Model A</u)
    expect(node).toMatch(/data-spend-share=""[^>]*style="width:60%;background-color:var\(--dshx-data-2\)"/u)
  })

  it('keeps the card picker by default', () => {
    expect(render()).toContain('data-node-anchor="dim:model"')
    expect(render()).not.toContain('Share by')
  })
})

describe('SpendMap › a breakdown with one entry (council round 11, D1)', () => {
  const single = renderToStaticMarkup(
    <SpendMap
      heading="Where it went"
      owner="All accounts"
      period="Nov 20 – Nov 26"
      total={10}
      format={value => `${String(value)}K`}
      dimensions={dimensions('var(--dshx-data-2)')}
      dimensionId="provider"
      leafId="acme"
      picker="segments"
      detailPeriod="this range"
      footer={<button type="button">Show requests</button>}
      onDimensionChange={() => undefined}
      onLeafChange={() => undefined}
    />,
  )

  it('draws one ranked row: no connector, no total node, no repeated detail block', () => {
    expect(single).not.toContain('data-spend-link')
    expect(single).not.toContain('data-node-anchor="root"')
    expect(single).not.toContain('All accounts')
    expect(single).not.toContain('this range')
    expect(single).not.toContain('data-node-anchor="leaf:')
    expect(single).toContain('data-spend-single=""')
  })

  it('keeps the label, a share bar and "amount · share", with the footer action beside them', () => {
    const row = /<div[^>]*data-spend-single=""[^>]*>.*?Show requests<\/button>/su.exec(single)?.[0] ?? ''
    expect(row).toContain('>Acme</span>')
    expect(row).toMatch(/dshx:h-2[^"]*"><span data-spend-share=""/u)
    expect(row).toContain('10K</span> · 100%')
  })

  it('draws the share on a track that frames it, so a 100 % share still reads as a bar (council round 12, D1)', () => {
    const track = /<span aria-hidden="true" class="([^"]*)"><span data-spend-share=""/u.exec(single)?.[1] ?? ''
    // A 2 px inset on a muted track: the bar sits inside a visible rim even at full width.
    expect(track).toContain('dshx:p-0.5')
    expect(track).toContain('dshx:h-2')
    expect(track).toContain('dshx:bg-muted')
    expect(single).toMatch(/data-spend-share=""[^>]*style="width:100%/u)
    // A muted-ink track: the card-coloured `bg-muted` rim vanished on the dark card.
    expect(track).toContain('dshx:bg-muted-foreground/30')
  })

  it('wraps the footer action under the share on a narrow card instead of clipping it (council round 12, D1)', () => {
    const row = /<div data-spend-single="" class="([^"]*)"/u.exec(single)?.[1] ?? ''
    expect(row).toContain('dshx:flex-wrap')
    expect(row).toContain('dshx:gap-y-2')
    const seat = /<span class="([^"]*)"><button type="button">Show requests/u.exec(single)?.[1] ?? ''
    // Alone on its line, it sits at the row's end.
    expect(seat).toContain('dshx:ml-auto')
    expect(single).not.toContain('<footer')
  })

  it('keeps the flow when the dimension holds two or more entries', () => {
    const html = renderToStaticMarkup(
      <SpendMap
        heading="Where it went"
        owner="All accounts"
        total={10}
        format={value => String(value)}
        dimensions={dimensions()}
        dimensionId="model"
        leafId="a"
        picker="segments"
        onDimensionChange={() => undefined}
        onLeafChange={() => undefined}
      />,
    )
    expect(html).toContain('data-spend-link="leaf:model:a"')
    expect(html).not.toContain('data-spend-single')
  })
})

describe('SpendMap › an entry with a mark (council round 15, D1)', () => {
  const marked: SpendDimension[] = [
    {
      id: 'model',
      label: 'Models',
      leaves: [
        { id: 'luna', label: 'gpt-6-luna', icon: <svg data-mark="" />, amount: 6, share: 0.6, color: 'var(--dshx-data-1)' },
        { id: 'rest', label: '3 more', amount: 4, share: 0.4 },
      ],
    },
  ]
  const html = (leaves: SpendDimension[]): string =>
    renderToStaticMarkup(
      <SpendMap
        heading="Where it went"
        owner="All accounts"
        total={10}
        format={value => String(value)}
        dimensions={leaves}
        dimensionId="model"
        leafId="luna"
        picker="segments"
        onDimensionChange={() => undefined}
        onLeafChange={() => undefined}
      />,
    )
  const seatOf = (markup: string, id: string): string =>
    new RegExp(`data-node-anchor="leaf:model:${id}"[^>]*><span([^>]*)>`, 'u').exec(markup)?.[1] ?? ''

  it('draws the bare 16 px mark the table draws: no tile, no border, no series tint', () => {
    const seat = seatOf(html(marked), 'luna')
    expect(seat).toContain('data-spend-seat="mark"')
    expect(seat).toContain('dshx:size-4')
    expect(seat).not.toContain('dshx:border')
    expect(seat).not.toContain('dshx:bg-background')
    expect(seat).not.toContain('style=')
  })

  it('keeps the tinted letter tile for an entry without a mark', () => {
    const seat = seatOf(html(marked), 'rest')
    expect(seat).toContain('data-spend-seat="letter"')
    expect(seat).toContain('dshx:size-6')
    expect(seat).toContain('dshx:border')
  })
})
