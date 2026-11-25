// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Input, fieldLook } from '../src/components/ui/input.js'
import { InputGroup } from '../src/components/ui/input-group.js'
import { Select, SelectTrigger, SelectValue, selectLook } from '../src/components/ui/select.js'
import { Textarea } from '../src/components/ui/textarea.js'
import { UnitInput } from '../src/components/ui/unit-input.js'
import { Checkbox } from '../src/components/ui/checkbox.js'
import { RadioGroup, RadioGroupItem } from '../src/components/ui/radio-group.js'
import { PaletteMath, WARM_STONE, type Scheme } from '../src/theme/palette.ts'
import { ThemeCss } from '../src/theme/theme-css.ts'

afterEach(cleanup)

const looks = readFileSync(join(process.cwd(), 'src/field-look.css'), 'utf8')
const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
const roles = readFileSync(join(process.cwd(), 'src/color-roles.css'), 'utf8')
const combobox = readFileSync(join(process.cwd(), 'src/components/ui/combobox.tsx'), 'utf8')
const classes = (element: Element | null): readonly string[] => element?.className.split(/\s+/u) ?? []
const schemes: readonly Scheme[] = ['light', 'dark']

describe('one field look (council round 3 A4)', () => {
  it('is a 1px control border, the page fill and the 8px radius, with no shadow and no dark fill', () => {
    expect(fieldLook.split(' ')).toEqual(['dshx:rounded-lg', 'dshx:border', 'dshx:border-field-border', 'dshx:bg-background'])
  })

  it('draws the select trigger at the one control height (32px) in that look, with a full-strength chevron', () => {
    const view = render(
      <Select>
        <SelectTrigger aria-label="Theme">
          <SelectValue placeholder="Theme" />
        </SelectTrigger>
      </Select>,
    )
    const trigger = view.container.querySelector('[data-slot="select-trigger"]')!
    expect(classes(trigger)).toEqual(expect.arrayContaining([...fieldLook.split(' '), 'dshx:data-[size=default]:h-(--dshx-control-h)']))
    expect(trigger.className).not.toMatch(/dark:bg-input|dark:hover:bg-input|shadow-xs|bg-transparent|rounded-md/u)
    expect(selectLook).toContain(fieldLook)
    // The chevron is the control's glyph: muted ink at full strength (3:1), not 50% opacity.
    const chevron = trigger.querySelector('svg')!
    expect(chevron.getAttribute('class')).not.toContain('opacity-50')
  })

  it('gives Input, Textarea and InputGroup the same look', () => {
    const view = render(
      <>
        <Input aria-label="Name" />
        <Textarea aria-label="Notes" />
        <InputGroup />
      </>,
    )
    for (const slot of ['input', 'textarea', 'input-group']) {
      const element = view.container.querySelector(`[data-slot="${slot}"]`)!
      expect(classes(element), slot).toEqual(expect.arrayContaining(fieldLook.split(' ')))
      expect(element.className, slot).not.toMatch(/dark:bg-input\/30|shadow-xs/u)
    }
  })

  it('offers select-look for a control the kit does not draw (a Host select): 32px, 1px border, page fill, 8px', () => {
    expect(styles).toContain("@import './field-look.css';")
    const rule = /@utility select-look \{([^}]*)\}/u.exec(looks)?.[1] ?? ''
    for (const declaration of [
      'height: var(--dshx-control-h, 32px);',
      'border: 1px solid var(--dshx-field-border, var(--dsw-alias-border-l3));',
      'border-radius: var(--dsw-radius-md, 8px);',
      'background-color: var(--dsw-alias-bg-base);',
      'box-shadow: none;',
    ])
      expect(rule, declaration).toContain(declaration)
  })

  it.each(schemes)('draws the chevron and the field text at their contrast on the fill (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    expect(PaletteMath.contrastRatio(p.neutral[9]!, p.neutral[0]!)).toBeGreaterThanOrEqual(4.5)
    expect(PaletteMath.contrastRatio(p.neutral[10]!, p.neutral[0]!)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('field boundary (council round 6 A2, WCAG 1.4.11)', () => {
  it('is its own generated token, emitted in both theme blocks and exposed as the field-border colour', () => {
    for (const scheme of schemes) expect(ThemeCss.blockDeclarations(WARM_STONE, scheme).join('\n')).toMatch(/--dshx-field-border: oklch\(/u)
    expect(roles).toContain('--color-field-border: var(--dshx-field-border, var(--dsw-alias-border-l3));')
    // Dividers and card hairlines stay subtle: the border role is untouched.
    expect(styles).toContain('--color-border: var(--dsw-alias-border-l2);')
  })

  it.each(schemes)('holds 3:1 against every surface a field sits on (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const dark = scheme === 'dark'
    const surfaces = {
      bg: p.neutral[0]!,
      panel: p.neutral[1]!,
      raised: p.neutral[2]!,
      // The dialog fill (surfaces.css: the page in light, 0.27 in dark) and the nav column (council round 6 A4: the
      // panel in light, 0.225 in dark).
      dialog: dark ? { l: 0.27, c: 0.006, h: 60 } : p.neutral[0]!,
      nav: dark ? { l: 0.225, c: 0.006, h: 60 } : p.neutral[1]!,
    }
    for (const [name, surface] of Object.entries(surfaces)) expect(PaletteMath.contrastRatio(p.fieldBorder, surface), name).toBeGreaterThanOrEqual(3)
    // The old control border (step 5) did not: this is the regression the token fixes.
    expect(PaletteMath.contrastRatio(p.neutral[5]!, p.neutral[0]!)).toBeLessThan(3)
  })

  it('edges the checkbox, the radio and the combobox trigger with it too', () => {
    const view = render(
      <>
        <Checkbox aria-label="Agree" />
        <RadioGroup aria-label="Mode">
          <RadioGroupItem value="a" aria-label="A" />
        </RadioGroup>
      </>,
    )
    for (const slot of ['checkbox', 'radio-group-item']) {
      const element = view.container.querySelector(`[data-slot="${slot}"]`)!
      expect(classes(element), slot).toContain('dshx:border-field-border')
      expect(classes(element), slot).not.toContain('dshx:border-input')
    }
    expect(combobox).toMatch(/const triggerClass =\s*'[^']*dshx:border-field-border/u)
  })
})

describe('UnitInput (council round 3 A4)', () => {
  it('is one field with the unit as an inner suffix, not a second control', () => {
    const view = render(<UnitInput aria-label="Font size" unit="px" defaultValue={14} />)
    const group = view.container.querySelector('[data-slot="input-group"]')!
    expect(group.getAttribute('data-unit-input')).toBe('')
    const input = group.querySelector('input')!
    expect(input.type).toBe('number')
    expect(input.inputMode).toBe('decimal')
    expect(input.value).toBe('14')
    const suffix = group.querySelector('[data-slot="input-group-addon"]')!
    expect(suffix.getAttribute('data-align')).toBe('inline-end')
    expect(suffix.textContent).toBe('px')
    expect(group.querySelectorAll('select, [role="combobox"], button')).toHaveLength(0)
  })

  it('names the unit to a screen reader with the field', () => {
    const view = render(<UnitInput aria-label="Font size" unit="px" aria-describedby="hint" />)
    const input = view.container.querySelector('input')!
    const ids = input.getAttribute('aria-describedby')!.split(' ')
    expect(ids).toContain('hint')
    const unit = ids.map(id => view.container.ownerDocument.getElementById(id)).find(element => element?.textContent === 'px')
    expect(unit).toBeTruthy()
  })

  it('forwards value, change, disabled and className', () => {
    const onChange = vi.fn()
    const view = render(<UnitInput aria-label="Gap" unit="ms" value={120} onChange={onChange} className="dshx:w-28" disabled />)
    const input = view.container.querySelector('input')!
    fireEvent.change(input, { target: { value: '160' } })
    expect(onChange).toHaveBeenCalled()
    expect(input.disabled).toBe(true)
    expect(classes(view.container.querySelector('[data-slot="input-group"]'))).toContain('dshx:w-28')
    expect(view.container.querySelector('[data-slot="input-group"]')!.getAttribute('data-disabled')).toBe('true')
  })
})
