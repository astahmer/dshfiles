// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { ChatViewSlotProps } from '../src/native/contract/slots.ts'
import { TurnNavigator } from '../src/native/chat/TurnNavigator.tsx'
import type { TurnRailItem } from '../src/native/chat/turn-rail-items.ts'

afterEach(cleanup)

const t: ChatViewSlotProps['t'] = key => key

const item = (turn: number): TurnRailItem => ({
  turn,
  prompt: `prompt ${String(turn)}`,
  response: '',
  seq: null,
  kind: 'prompt',
  mark: undefined,
  anchor: { kind: 'loaded', key: `node-${String(turn)}` },
})

const css = readFileSync(join(process.cwd(), 'src/native/chat/TurnNavigator.module.css'), 'utf8')
/** One rule's declarations, by its exact selector. */
const rule = (selector: string): string => {
  const start = css.indexOf(`\n${selector} {`)
  if (start === -1) return ''
  return css.slice(start, css.indexOf('}', start))
}

// Council round 34 B2: at two Turns the rail read as a stray glyph at the transcript's edge, two short ticks floating on
// the page. It shows from three Turns, on a resting neutral track, so it reads as one control.
describe('the turn rail at rest', () => {
  it('shows from three Turns, not two', () => {
    const two = render(<TurnNavigator items={[1, 2].map(item)} activeTurn={1} busyTurn={null} onNavigate={() => {}} t={t} />)
    expect(two.container.querySelector('[data-turn-map]')).toBeNull()
    cleanup()
    const three = render(<TurnNavigator items={[1, 2, 3].map(item)} activeTurn={1} busyTurn={null} onNavigate={() => {}} t={t} />)
    expect(three.container.querySelector('[data-turn-map]')).not.toBeNull()
  })

  it('still shows a filtered rail with fewer Turns, so the filter can be turned off', () => {
    const view = render(
      <TurnNavigator items={[item(2)]} activeTurn={2} busyTurn={null} onNavigate={() => {}} t={t} filter="errors" onFilterChange={() => {}} />,
    )
    expect(view.container.querySelector('[data-turn-map]')).not.toBeNull()
  })

  it('draws its marks on a resting track: 8% ink, a full radius, 6px outside the first and last mark, no accent', () => {
    const scroller = rule('.scroller')
    expect(scroller).toContain('border-radius: 999px;')
    expect(scroller).toContain(
      'background: var(--dshx-backdrop-rail-fill, color-mix(in srgb, var(--dsw-alias-label-primary) 8%, transparent));',
    )
    // The 6px pads the track outside the first and last mark's 10px seat: the virtualizer insets each end by it.
    const source = readFileSync(join(process.cwd(), 'src/native/chat/TurnNavigator.tsx'), 'utf8')
    expect(source).toContain('const RAIL_PAD_PX = 6')
    expect(source).toContain('const RAIL_INSET_PX = TURN_SPACING_PX / 2 + RAIL_PAD_PX')
    expect(scroller).not.toMatch(/business|accent|brand/u)
  })

  it('centres the ticks, the band and the read boundary on the track', () => {
    expect(rule('.mark::before')).toContain('right: var(--dshx-backdrop-rail-inset, 4px);')
    expect(rule('.mark::before')).toContain('transform-origin: var(--dshx-backdrop-rail-origin, center) center;')
    expect(rule('.band')).toContain('right: calc(var(--dshx-backdrop-rail-inset, 4px) / 2);')
    expect(rule('.seenBoundary')).toContain('right: var(--dshx-backdrop-rail-inset, 4px);')
  })

  it('leaves a theme backdrop its own pill: no second fill under it', () => {
    const theme = readFileSync(join(process.cwd(), '../plugin-ui/src/theme/theme-definition.ts'), 'utf8')
    expect(theme).toContain("'  --dshx-backdrop-rail-fill: transparent;',")
  })
})
