import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sidebarShell = readFileSync(new URL('./sidebar-shell.tsx', import.meta.url), 'utf8')
const destinationShell = readFileSync(new URL('./destination-shell.tsx', import.meta.url), 'utf8')
const dockviewTheme = readFileSync(new URL('../../workbench/src/dockview-theme.css', import.meta.url), 'utf8')
const clientCss = readFileSync(new URL('./client.css', import.meta.url), 'utf8')

/** The px a `dshx:<side>-<n>` spacing token in `classes` adds (Tailwind's 4px step), 0 when it is absent. */
const spacing = (classes: string, side: 'pt' | 'py'): number => {
  const token = new RegExp(`(?:^|\\s)dshx:${side}-(\\d+(?:\\.\\d+)?)(?:\\s|$)`, 'u').exec(classes)
  return token?.[1] === undefined ? 0 : Number(token[1]) * 4
}

/** The class list of the element that carries `marker` (the first `className=` after it, or before it when the marker follows). */
const classesNear = (source: string, marker: string): string => {
  const at = source.indexOf(marker)
  expect(at).toBeGreaterThan(-1)
  const after = /className=\{cn\(\s*'([^']+)'|className="([^"]+)"/u.exec(source.slice(at))
  return after?.[1] ?? after?.[2] ?? ''
}

describe('desktop shell chrome (council round 18 B2.1)', () => {
  it('draws the brand block as tall as the tab strip, with the same hairline under it', () => {
    const brand = classesNear(sidebarShell, 'ref={brandRef}')
    // The Workbench tab row is `--dshx-size-bar` tall (dockview-theme.css): the brand row takes the same step, not 48px.
    expect(dockviewTheme).toContain('--dv-tabs-and-actions-container-height: var(--dshx-size-bar, 36px);')
    expect(brand).toContain('dshx:h-bar')
    expect(brand).not.toContain('dshx:h-12')
    // The strip's hairline is an inset shadow in the line tone; the brand row draws the same one, so the top band reads
    // as one bar across the column and the stage.
    expect(dockviewTheme).toContain('box-shadow: inset 0 -1px 0 var(--dshx-tone-line, var(--dsw-alias-border-l2));')
    expect(brand).toContain('dshx:shadow-[inset_0_-1px_0_var(--dshx-tone-line,var(--dsw-alias-border-l2))]')
  })
})

describe('room under the brand hairline (council round 19 B1)', () => {
  // The brand row went from 48px to the strip's 36px (round 18 B2.1) and the column and rail rose with it: the Search
  // field touched the hairline, the column titles stood ~6px under it, the rail's active tile ~4px.
  it('starts the rail\'s first tile 12px under the hairline', () => {
    const rail = classesNear(destinationShell, 'aria-label="Destinations"')
    const button = /'(dshx:flex dshx:w-full dshx:shrink-0 dshx:flex-col dshx:items-center dshx:gap-0\.5 dshx:rounded-md dshx:px-0 [^']*)'/u.exec(destinationShell)?.[1] ?? ''
    expect(button).toContain('dshx:py-1')
    // The rail's top padding plus the button's own inset over its 24px tile.
    expect(spacing(rail, 'pt') + spacing(button, 'py')).toBe(12)
  })

  it('starts the Threads search field 12px under the hairline on a desktop column', () => {
    const at = destinationShell.indexOf('data-destination-index="threads"')
    expect(at).toBeGreaterThan(-1)
    const pane = /className=\{cn\('([^']+)', ([^)]+)\)\}\s*data-destination-index="threads"/u.exec(destinationShell.slice(at - 400, at + 40))
    expect(pane?.[2]).toContain("!phone && 'dshx:pt-3'")
    // Nothing above the field adds to it: the column's panel and the toolbar row start flush.
    const panel = classesNear(destinationShell, 'role="tabpanel"')
    expect(spacing(panel, 'pt')).toBe(0)
    const toolbar = /className=\{cn\('([^']+)'[^}]*\}\s*data-threads-toolbar=""/u.exec(destinationShell)?.[1] ?? ''
    expect(toolbar).not.toMatch(/dshx:p[ty]-/u)
  })

  it('sets a destination column\'s title ink about 12px under the hairline', () => {
    const header = /'dshx:flex dshx:shrink-0 dshx:items-start dshx:gap-1 dshx:pb-2 dshx:pl-3',\s*props\.phone === true \? '([^']+)' : '([^']+)'/u.exec(destinationShell)
    expect(header).not.toBeNull()
    // The 14px/20px title's cap top sits ~3.5px inside its line box: 8px of padding puts its ink at ~12px.
    expect(spacing(header?.[2] ?? '', 'pt')).toBe(8)
    // The phone list hides the title and keeps its own 12px under the top bar.
    expect(spacing(header?.[1] ?? '', 'pt')).toBe(4)
  })
})

describe('the folded brand overhang (council round 19 B2)', () => {
  it('draws the overhang as the open brand row: the strip\'s height and hairline, the logo on the same line', () => {
    const brand = classesNear(sidebarShell, 'ref={brandRef}')
    const overhang = classesNear(sidebarShell, 'data-sidebar-brand-overhang=""')
    for (const token of ['dshx:h-bar', 'dshx:items-center', 'dshx:shadow-[inset_0_-1px_0_var(--dshx-tone-line,var(--dsw-alias-border-l2))]']) {
      expect(brand).toContain(token)
      expect(overhang).toContain(token)
    }
    // 38px with a 10px top inset put the logo 6px under every other page's and left no bottom edge.
    expect(overhang).not.toContain('dshx:h-[38px]')
    expect(overhang).not.toContain('dshx:pt-2.5')
    // main-tabs' own strip is 38px with a 10px inset and no rule: there the overhang keeps that strip's line.
    expect(clientCss).toMatch(/html\[data-main-tabs\] \[data-sidebar-brand-overhang\] \{\s*height: 38px;\s*padding-top: 10px;\s*box-shadow: none;\s*\}/u)
  })
})

describe('phone roots on one canvas (council round 18 B2.1)', () => {
  it('puts the phone Threads list on the stage canvas the Inbox and Settings pages sit on', () => {
    const at = destinationShell.indexOf('data-phone-list=""\n          onClick={closeAfterPick}')
    expect(at).toBeGreaterThan(-1)
    const list = /'(dshx:fixed dshx:inset-x-0 dshx:z-40 dshx:flex dshx:flex-col[^']*)'/u.exec(destinationShell.slice(at))?.[1] ?? ''
    expect(list).toContain('dshx:surface-stage')
    expect(list).not.toContain('dshx:bg-(--dsw-specific-sidebar-fill)')
    // The list's own fills (its root, sticky group headers, a swiped row's backing) paint the sidebar fill: inside the
    // phone list that fill is the canvas, so nothing inside draws a second surface.
    expect(list).toContain('dshx:[--dsw-specific-sidebar-fill:var(--dshx-surface-stage)]')
  })
})
