import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (name: string): string => readFileSync(new URL(name, import.meta.url), 'utf8')

describe('Settings selection at the tint rung (round five P4, K2)', () => {
  it('marks the active category with the selected wash, ink text', () => {
    const view = read('settings-view.tsx')
    const active = view.match(/const navCellActive = '([^']*)'/u)?.[1] ?? ''
    expect(active).toContain('dshx:bg-selected-wash')
    expect(active).toContain('dshx:hover:bg-selected-wash')
    expect(active).toContain('dshx:text-foreground')
    expect(active).not.toContain('sidebar-nav-item-active')
  })

  it('draws the chosen appearance cube with the selected wash, an accent border and a check', () => {
    const general = read('native/general-section.tsx')
    const cube = "[&_[class*=_themeCube][aria-pressed=true]]"
    expect(general).toContain(`dshx:${cube}:bg-selected-wash!`)
    expect(general).toContain(`dshx:${cube}:border-ring!`)
    // The check: a 2 px accent tick drawn by ::after in the cube's top-end corner.
    expect(general).toContain(`dshx:${cube}:after:border-ring`)
    expect(general).toContain(`dshx:${cube}:after:rotate-45`)
    // Smaller cubes in a narrow pane.
    expect(general).toContain('dshx:@max-pane-narrow:[&_[class*=_themeCube]]:py-2!')
  })
})

describe('Settings header on a phone (round five P4)', () => {
  it('folds the configuration file action into one named menu instead of a bare <> icon', () => {
    const action = read('open-config-action.tsx')
    expect(action).not.toContain('<CodeIcon aria-hidden="true" className="dshx:hidden')
    expect(action).toMatch(/className=\{cn\([^)]*path !== null && 'dshx:@max-pane-compact:hidden'/u)
    expect(action).toMatch(/<DropdownMenuItem onSelect=\{\(\) => send\(\{ type: 'primary' \}\)\}>\s*<CodeIcon \/>\s*\{t\('openDocument'\)\}/u)
  })
})
