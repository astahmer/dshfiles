import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ItemPickers } from './item-pickers.js'

const trigger = (withLabel: boolean): string =>
  /<button[^>]*aria-label="Status of b:1"[^>]*>.*?<\/button>/su.exec(
    renderToStaticMarkup(<ItemPickers.Status itemLabel="b:1" status="todo" onPick={() => undefined} withLabel={withLabel} />),
  )?.[0] ?? ''

describe('Backlog status trigger (council round 10, D3)', () => {
  it('reads as one status-glyph menu button, not a checkbox: the ink glyph and a 10 px chevron in a 32 px seat', () => {
    const button = trigger(false)
    expect(button).toContain('aria-haspopup="menu"')
    const opening = /<button([^>]*)>/u.exec(button)?.[1] ?? ''
    expect(opening).toContain('dshx:size-8')
    expect(opening).not.toContain('dshx:h-7')
    // The 32 px seat overhangs 4 px above and below, so it takes the 24 px line the glyph did: a feed row stays 44 px.
    expect(opening).toContain('dshx:-my-1')
    const svgs = [...button.matchAll(/<svg([^>]*)>/gu)].map(match => match[1] ?? '')
    expect(svgs).toHaveLength(2)
    // The state glyph first (a ring, never the to-do square), then the chevron in secondary ink at 10 px.
    expect(svgs[0]).toContain('dshx:size-4')
    expect(button).not.toContain('<rect')
    expect(button).toContain('<circle')
    expect(svgs[1]).toContain('lucide-chevron-down')
    expect(svgs[1]).toContain('dshx:size-2.5')
    expect(svgs[1]).toContain('dshx:text-muted-foreground')
  })

  it('keeps the labelled trigger as it was: glyph and status name', () => {
    const button = trigger(true)
    expect(button).toContain('>Todo<')
    expect(button).not.toContain('lucide-chevron-down')
  })

  it('gives the feed row a 32 px status seat for it', () => {
    const feed = readFileSync(new URL('./feed-view.tsx', import.meta.url), 'utf8')
    expect(feed).toContain('dshx:grid-cols-[52px_32px_minmax(0,1fr)_auto]')
    expect(feed).toContain('className="dshx:flex dshx:w-8 dshx:justify-center"')
  })
})
