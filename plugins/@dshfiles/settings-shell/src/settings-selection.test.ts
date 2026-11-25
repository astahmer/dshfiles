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

  it('draws the chosen appearance cube as the kit selected card: wash, ring edge and check, no row marker', () => {
    const general = read('native/general-section.tsx')
    const cube = "[&_[class*=_themeCube][aria-pressed=true]]"
    // Council round 3 B3: one card selection look (kit A1) instead of a hand-built border, tick and the row marker.
    expect(general).toContain(`dshx:${cube}:selected-card!`)
    expect(general).not.toContain(`dshx:${cube}:selected-marker!`)
    expect(general).not.toContain(`dshx:${cube}:after:rotate-45`)
    // Smaller cubes in a narrow pane.
    expect(general).toContain('dshx:@max-pane-narrow:[&_[class*=_themeCube]]:py-2!')
  })
})

describe('Settings › General controls in the kit field look (council round 3 B3)', () => {
  it('draws the row selectors as the kit select and the font size as one field with its unit inside', () => {
    const general = read('native/general-section.tsx')
    expect(general).toContain('dshx:[&_[class*=_selector_]]:select-look!')
    // The number and its unit share one bordered box: the stepper drops its trailing edge, the unit takes it.
    expect(general).toContain('dshx:[&_[class*=_stepper_]]:rounded-r-none!')
    expect(general).toContain('dshx:[&_[class*=_stepper_]]:border-r-0!')
    expect(general).toContain('dshx:[&_[class*=_stepper_]+[class*=_unit_]]:border-l-0!')
    expect(general).toContain('dshx:[&_[class*=_stepper_]+[class*=_unit_]]:-ml-2!')
    // 44px on a touch screen, where the stepper's own buttons are 44px.
    expect(general).toContain('dshx:pointer-coarse:[&_[class*=_stepper_]]:h-11!')
    expect(general).toContain('dshx:pointer-coarse:[&_[class*=_selector_]]:h-11!')
  })

  it('edges the font size field like every kit field, at 3:1 (council round 6 A2)', () => {
    const general = read('native/general-section.tsx')
    expect(general).toContain('dshx:[&_[class*=_stepper_]]:border-field-border!')
    expect(general).toContain('dshx:[&_[class*=_stepper_]+[class*=_unit_]]:border-field-border!')
    expect(general).not.toContain('border-(--dsw-alias-border-l3)!')
  })

  it('sets the font size at the kit UnitInput text size, with no chevron trailing the field (council round 4 B5)', () => {
    const general = read('native/general-section.tsx')
    expect(general).toContain('dshx:[&_[class*=_stepper_]_[class*=_value_]]:text-sm!')
    expect(general).toContain('dshx:[&_[class*=_stepper_]+[class*=_unit_]]:text-sm!')
    // The More font settings disclosure stays reachable, as text, without its chevron.
    expect(general).toContain('dshx:[&_[class*=_expander_]>svg]:hidden!')
    expect(general).toContain('dshx:[&_[class*=_expander_]]:before:content-[attr(aria-label)]')
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
