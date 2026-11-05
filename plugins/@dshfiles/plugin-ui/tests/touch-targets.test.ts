import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Vitest runs each package from its root; jsdom gives import.meta.url a non-file scheme here.
const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
const coarse = styles.slice(styles.indexOf('@media (pointer: coarse)'))

describe('touch targets', () => {
  it('widens kit buttons, toggles and page tabs to a 44px hit area on a coarse pointer only', () => {
    expect(styles).toContain('@media (pointer: coarse)')
    for (const slot of ['button', 'toggle', 'toggle-group-item']) expect(coarse).toContain(`[data-slot='${slot}']`)
    expect(coarse).toContain("[data-slot='tabs-trigger'])::before")
    expect(coarse.match(/inset: min\(0px, calc\(\(100% - 44px\) \/ 2\)\) min\(0px, calc\(\(100% - 44px\) \/ 2\)\);/gu)).toHaveLength(2)
    // The rule is base layer: a positioning utility on a control still wins.
    expect(styles.lastIndexOf('@layer base', styles.indexOf('@media (pointer: coarse)'))).toBeGreaterThan(-1)
  })

  it('gives menu, select and command rows a 44px row on a coarse pointer', () => {
    for (const slot of ['dropdown-menu-item', 'context-menu-item', 'select-item', 'command-item']) expect(coarse).toContain(`[data-slot='${slot}']`)
    expect(coarse).toContain('min-height: 44px;')
  })
})
