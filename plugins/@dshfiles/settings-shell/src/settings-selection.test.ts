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
    // One 80px card height in every pane (council round 11 B4).
    expect(general).toContain('dshx:[&_[class*=_themeCube]]:h-20!')
  })
})

describe('Settings › General controls in the kit field look (council round 3 B3)', () => {
  it('draws the row selectors as the kit select and the font size as one field with its unit inside', () => {
    const general = read('native/general-section.tsx')
    expect(general).toContain('dshx:[&_[class*=_selector_]]:select-look!')
    // One 176px minimum for every select (round nine B1): the control column's left edge stays straight.
    expect(general).toContain('dshx:[&_[class*=_selector_]]:min-w-44!')
    // At that width core's value and chevron would sit together at the start: the chevron keeps the trailing edge.
    expect(general).toContain('dshx:[&_[class*=_selector_]]:justify-between!')
    expect(read('schema-form/settings-form.tsx')).toContain('<SelectTrigger aria-label={props.label} className="dshx:min-w-44" size="sm">')
    // The number and its unit share one bordered box: the stepper drops its trailing edge, the unit takes it.
    expect(general).toContain('dshx:[&_[class*=_stepper_]]:rounded-r-none!')
    expect(general).toContain('dshx:[&_[class*=_stepper_]]:border-r-0!')
    expect(general).toContain('dshx:[&_[class*=_stepper_]+[class*=_unit_]]:border-l-0!')
    expect(general).toContain('dshx:[&_[class*=_stepper_]+[class*=_unit_]]:ml-0!')
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

  it('aligns the font size field to the select column, with More font settings under the description (council round 14 B3)', () => {
    const general = read('native/general-section.tsx')
    const row = '[&_[class$=row]:has([class*=_expander_])]'
    // The Font size row is a grid: the label column, then the field and its unit filling the selects' 176px (140 + 36).
    expect(general).toContain(`dshx:${row}:grid!`)
    expect(general).toContain(`dshx:${row}:grid-cols-[minmax(0,1fr)_8.75rem_2.25rem]!`)
    // The control box steps aside so the disclosure can leave the field's column for the label's.
    expect(general).toContain('dshx:[&_[class*=_control_]:has(>[class*=_stepper_])]:contents!')
    expect(general).not.toContain('dshx:[&_[class*=_control_]:has(>[class*=_stepper_])]:w-44!')
    expect(general).toContain('dshx:[&_[class*=_stepper_]]:w-full!')
    expect(general).toContain('dshx:[&_[class*=_stepper_]]:col-start-2!')
    expect(general).toContain('dshx:[&_[class*=_stepper_]+[class*=_unit_]]:col-start-3!')
    // The disclosure reads under the description, in the label column.
    expect(general).toContain('dshx:[&_[class*=_expander_]]:col-start-1!')
    expect(general).toContain('dshx:[&_[class*=_expander_]]:row-start-2!')
    expect(general).not.toContain('dshx:[&_[class*=_expander_]]:col-span-full!')
    expect(general).not.toContain('dshx:[&_[class*=_expander_]]:underline!')
    expect(general).not.toContain('dshx:[&_[class*=_expander_]]:ml-1!')
  })

  it('draws More font settings as the kit disclosure link: link colour, 12px chevron, 13/500 (council round 15 B4)', () => {
    const general = read('native/general-section.tsx')
    // The kit utility owns the link colour (AA in both schemes), 13/18 at 500, the trailing 12px chevron 4px after the
    // label, an underline only under the pointer, and 44px on touch.
    expect(general).toContain('dshx:[&_[class*=_expander_]]:disclosure-link!')
    // It no longer reads as a label in the ink, and does not restate what the utility draws.
    expect(general).not.toContain('dshx:[&_[class*=_expander_]]:text-foreground!')
    expect(general).not.toContain('dshx:[&_[class*=_expander_]]:text-sm/4.5!')
    expect(general).not.toContain('dshx:[&_[class*=_expander_]]:no-underline!')
    // Core's own chevron icon stays hidden (the utility's ::after draws the one chevron); the label stays in ::before.
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
