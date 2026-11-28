import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SidebarFold } from './sidebar-fold.js'

const css = readFileSync(new URL('./client.css', import.meta.url), 'utf8')
const shell = readFileSync(new URL('./sidebar-shell.tsx', import.meta.url), 'utf8')

describe('SidebarFold (round five B1: one chrome)', () => {
  it('draws the open header over the stage only for a desktop column folded to its rail', () => {
    expect(SidebarFold.overhangs({ collapsed: true, phone: false, width: 60 })).toBe(true)
    // Open, on a phone, or with no track at all (the macOS app, a drawer): the frame's own chrome stays.
    expect(SidebarFold.overhangs({ collapsed: false, phone: false, width: 280 })).toBe(false)
    expect(SidebarFold.overhangs({ collapsed: true, phone: true, width: 60 })).toBe(false)
    expect(SidebarFold.overhangs({ collapsed: true, phone: false, width: 0 })).toBe(false)
    // A drawer reports its open width while collapsed: not the rail.
    expect(SidebarFold.overhangs({ collapsed: true, phone: false, width: 280 })).toBe(false)
  })

  it('overhangs the folded track by the rest of the open width, so the tabs start where they do open', () => {
    expect(SidebarFold.overhang(280, 60)).toBe(220)
    expect(SidebarFold.overhang(SidebarFold.OPEN_FALLBACK, 60)).toBe(220)
    expect(SidebarFold.overhang(40, 60)).toBe(0)
  })

  it('keeps the rail as wide as the folded track, so folding never moves it', () => {
    expect(SidebarFold.RAIL_WIDTH).toBe(60)
    expect(SidebarFold.RAIL_WIDTH).toBeLessThanOrEqual(SidebarFold.TRACK_MAX)
  })

  it('draws the row only over a main tab strip (main-tabs or the Workbench main region) outside zen mode', () => {
    const room = "[data-main-tabs], [data-workbench-main-strip]:not([data-workbench-main-tabs='hidden'])"
    expect(css).toContain(`html[data-sidebar-folded]:is(${room}):not([data-dshfiles-zen])`)
    expect(css).toContain('--dshfiles-sidebar-overhang: var(--dshfiles-sidebar-folded-overhang, 0px)')
    expect(css).toMatch(/html:not\(\[data-main-tabs\]\):not\(\[data-workbench-main-strip\]\) \[data-sidebar-brand-overhang\],/u)
    expect(css).toMatch(/html\[data-dshfiles-zen\] \[data-sidebar-brand-overhang\] \{\s*display: none;/u)
    expect(css).toMatch(/\[data-sidebar-folded-new-thread\] \{\s*display: none;/u)
    // The shell portals the open row (wordmark and all) and marks the in-rail mark as its fallback.
    expect(shell).toContain('data-sidebar-brand-overhang=""')
    expect(shell).toContain('{brandContent(true)}')
    expect(shell).toContain("data-sidebar-brand-fallback={folded ? '' : undefined}")
  })
})
