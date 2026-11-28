// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { StatusGlyph } from '../src/components/work-status.js'
import { PaletteMath, WARM_STONE, type Scheme } from '../src/theme/palette.ts'
import { ThemeCss } from '../src/theme/theme-css.ts'

afterEach(cleanup)

const roles = readFileSync(join(process.cwd(), 'src/color-roles.css'), 'utf8')

/** The drawn mark (the svg or span inside the glyph's mark slot) and its seat. */
const drawn = (status: 'ready' | 'needs-you' | 'failed' | 'working' | 'idle' | 'stale') => {
  const view = render(<StatusGlyph status={status} />)
  const seat = view.container.querySelector('[data-slot="status-glyph"]')!
  expect(seat.getAttribute('class')?.split(/\s+/), `${status} seat`).toContain('dshx:size-4')
  const mark = seat.querySelector('[data-glyph-mark] > *')!
  const classes = mark.getAttribute('class')?.split(/\s+/) ?? []
  const result = { seat: seat.getAttribute('class')?.split(/\s+/) ?? [], classes, size: classes.find(name => name.startsWith('dshx:size-')) }
  cleanup()
  return result
}

describe('status mark sizes (round five K6)', () => {
  it('draws Ready as a 10px dot and Needs you, Failed and Working at 14px, all in the 16px seat', () => {
    expect(drawn('ready').size).toBe('dshx:size-2.5')
    expect(drawn('needs-you').size).toBe('dshx:size-3.5')
    expect(drawn('failed').size).toBe('dshx:size-3.5')
    expect(drawn('working').size).toBe('dshx:size-3.5')
  })
})

describe('quiet marks (council round 6 A6)', () => {
  it('draws Idle as a 10px ring in the same seat as Ready, not an 8px one, keeping its shape', () => {
    const idle = drawn('idle')
    expect(idle.size).toBe(drawn('ready').size)
    expect(idle.classes).toEqual(expect.arrayContaining(['dshx:rounded-full', 'dshx:border', 'dshx:border-current']))
    expect(idle.classes).not.toContain('dshx:bg-current')
  })

  it('draws the Ready dot in the ready-mark green, not the status text green', () => {
    const ready = drawn('ready')
    expect(ready.seat).toContain('dshx:text-status-ready-mark')
    expect(ready.seat).not.toContain('dshx:text-status-ready')
    expect(roles).toContain('--color-status-ready-mark: var(--dshx-ready-mark, var(--dsw-alias-state-success-primary));')
  })

  it.each<Scheme>(['light', 'dark'])('lightens the light Ready dot to L 0.55 and keeps it at 3:1 on every row surface (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    expect(p.readyMark).toEqual(scheme === 'light' ? { l: 0.55, c: 0.13, h: 150 } : p.success.fg)
    if (scheme === 'light') expect(p.readyMark.l).toBeGreaterThan(p.success.fg.l)
    for (const surface of [p.neutral[0]!, p.neutral[1]!, p.neutral[2]!, p.navSurface, p.selectedWash])
      expect(PaletteMath.contrastRatio(p.readyMark, surface)).toBeGreaterThanOrEqual(3)
    expect(ThemeCss.blockDeclarations(WARM_STONE, scheme).join('\n')).toContain(`--dshx-ready-mark: ${PaletteMath.toCss(p.readyMark)};`)
  })
})
