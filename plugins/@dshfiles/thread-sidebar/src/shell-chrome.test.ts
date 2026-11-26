import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sidebarShell = readFileSync(new URL('./sidebar-shell.tsx', import.meta.url), 'utf8')
const destinationShell = readFileSync(new URL('./destination-shell.tsx', import.meta.url), 'utf8')
const dockviewTheme = readFileSync(new URL('../../workbench/src/dockview-theme.css', import.meta.url), 'utf8')

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
