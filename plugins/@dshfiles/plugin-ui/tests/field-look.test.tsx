// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button, buttonVariants } from '../src/components/ui/button.js'
import { Input, fieldLook, triggerLook, typeableTriggerLook } from '../src/components/ui/input.js'
import { InputGroup } from '../src/components/ui/input-group.js'
import { Select, SelectTrigger, SelectValue, selectLook } from '../src/components/ui/select.js'
import { Combobox } from '../src/components/ui/combobox.js'
import { Textarea } from '../src/components/ui/textarea.js'
import { UnitInput } from '../src/components/ui/unit-input.js'
import { Checkbox } from '../src/components/ui/checkbox.js'
import { RadioGroup, RadioGroupItem } from '../src/components/ui/radio-group.js'
import { PaletteMath, WARM_STONE, type Oklch, type Scheme } from '../src/theme/palette.ts'
import { ThemeCss } from '../src/theme/theme-css.ts'

afterEach(cleanup)

const looks = readFileSync(join(process.cwd(), 'src/field-look.css'), 'utf8')
const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
const roles = readFileSync(join(process.cwd(), 'src/color-roles.css'), 'utf8')
const combobox = readFileSync(join(process.cwd(), 'src/components/ui/combobox.tsx'), 'utf8')
const classes = (element: Element | null): readonly string[] => element?.className.split(/\s+/u) ?? []
const schemes: readonly Scheme[] = ['light', 'dark']
/** `over` at `alpha` on an opaque `under`, composited in gamma sRGB as a browser paints it. */
const composite = (under: Oklch, over: Oklch, alpha: number): Oklch => {
  const channels = (color: Oklch): readonly number[] =>
    PaletteMath.toHex(color)
      .slice(1)
      .match(/../gu)!
      .map(pair => Number.parseInt(pair, 16))
  const [u, o] = [channels(under), channels(over)]
  return PaletteMath.hexToOklch(`#${u.map((value, i) => Math.round(value * (1 - alpha) + o[i]! * alpha).toString(16).padStart(2, '0')).join('')}`)
}

describe('one field look (council round 3 A4)', () => {
  it('is a 1px control border, the page fill and the 8px radius, with no shadow and no dark fill', () => {
    expect(fieldLook.split(' ')).toEqual(['dshx:rounded-lg', 'dshx:border', 'dshx:border-field-border', 'dshx:bg-background'])
  })

  it('draws the select trigger at the one control height (32px) as the quiet trigger, with a full-strength chevron', () => {
    const view = render(
      <Select>
        <SelectTrigger aria-label="Theme">
          <SelectValue placeholder="Theme" />
        </SelectTrigger>
      </Select>,
    )
    const trigger = view.container.querySelector('[data-slot="select-trigger"]')!
    expect(classes(trigger)).toEqual(expect.arrayContaining([...triggerLook.split(' '), 'dshx:data-[size=default]:h-(--dshx-control-h)']))
    expect(trigger.className).not.toMatch(/dark:bg-input|dark:hover:bg-input|shadow-xs|bg-transparent|rounded-md/u)
    expect(selectLook).toContain(triggerLook)
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

  it('offers select-look for a control the kit does not draw (a Host select): the quiet trigger at 32px, 8px', () => {
    expect(styles).toContain("@import './field-look.css';")
    const rule = /@utility select-look \{([\s\S]*?)\n\}/u.exec(looks)?.[1] ?? ''
    for (const declaration of [
      'height: var(--dshx-control-h, 32px);',
      // Council round 11 A2: the quiet hairline at rest, so the chip never vanishes into its surface.
      'border: 1px solid var(--dsw-alias-border-l2);',
      'border-radius: var(--dsw-radius-md, 8px);',
      'background-color: var(--dshx-trigger-fill, var(--dsw-alias-interactive-bg-hover-solid));',
      'box-shadow: none;',
    ])
      expect(rule, declaration).toContain(declaration)
    // The 3:1 edge on hover and focus only.
    expect(rule).toMatch(/&:hover:not\(:disabled\),\s*&:focus-visible \{\s*border-color: var\(--dshx-field-border, var\(--dsw-alias-border-l3\)\);/u)
  })

  it.each(schemes)('draws the chevron and the field text at their contrast on the fill (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    expect(PaletteMath.contrastRatio(p.neutral[9]!, p.neutral[0]!)).toBeGreaterThanOrEqual(4.5)
    expect(PaletteMath.contrastRatio(p.neutral[10]!, p.neutral[0]!)).toBeGreaterThanOrEqual(4.5)
  })
})

describe('field trigger (council round 7 A4)', () => {
  it('draws a popover trigger that shows a value in the quiet trigger look, beside the select trigger in a filter row', () => {
    const view = render(
      <>
        <Button variant="field" aria-label="Range">
          Custom <svg data-testid="chevron" />
        </Button>
        <Select>
          <SelectTrigger aria-label="Purpose">
            <SelectValue placeholder="Purpose" />
          </SelectTrigger>
        </Select>
      </>,
    )
    const trigger = view.getByRole('button', { name: 'Range' })
    expect(trigger.getAttribute('data-variant')).toBe('field')
    expect(classes(trigger)).toEqual(expect.arrayContaining([...triggerLook.split(' '), 'dshx:font-normal', 'dshx:text-foreground', 'dshx:h-(--dshx-control-h)']))
    expect(classes(trigger)).not.toContain('dshx:font-medium')
    // Not the quiet button edge: no shadow, no dark input fill, no default border colour.
    expect(trigger.className).not.toMatch(/shadow-xs|dark:bg-input|dark:border-input|hover:bg-accent/u)
    // Its glyph is the select chevron's muted ink, unless the caller colours it.
    expect(classes(trigger)).toContain('dshx:[&_svg:not([class*=text-])]:text-muted-foreground')
    // The same look as the select trigger in the same row.
    const select = view.container.querySelector('[data-slot="select-trigger"]')!
    for (const part of triggerLook.split(' ')) expect(classes(select)).toContain(part)
    // A trigger the kit does not render as a Button reads the same classes.
    expect(buttonVariants({ variant: 'field' })).toContain('dshx:bg-trigger-fill')
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

  it('edges the checkbox and the radio with it too', () => {
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
    expect(combobox).toMatch(/const triggerClass = cn\(\s*triggerLook,/u)
  })
})

describe('quiet trigger (council round 10 A1)', () => {
  const rest = (element: Element): readonly string[] => classes(element).filter(name => !/:(hover|focus|data-|aria-|not-)/u.test(name.replace(/^dshx:/u, '')))

  it('is a filled chip with a 1px hairline at rest and the 3:1 field edge on hover and while open (council round 11 A2)', () => {
    expect(triggerLook.split(' ')).toEqual([
      'dshx:rounded-lg',
      'dshx:border',
      // The hairline (`--dsw-alias-border-l2`, the divider role) at rest: the chip keeps its outline on any surface.
      'dshx:border-border',
      'dshx:bg-trigger-fill',
      'dshx:not-disabled:hover:border-field-border',
      'dshx:data-[state=open]:border-field-border',
      'dshx:aria-expanded:border-field-border',
    ])
    expect(roles).toContain('--color-trigger-fill: var(--dshx-trigger-fill, var(--dsw-alias-interactive-bg-hover-solid));')
  })

  it('draws Select, Combobox and Button field triggers quiet, and keeps the edge on text-entry fields', () => {
    const view = render(
      <>
        <Select>
          <SelectTrigger aria-label="Theme">
            <SelectValue placeholder="Theme" />
          </SelectTrigger>
        </Select>
        <Combobox label="Project" value="" options={[{ value: 'a', label: 'A' }]} onValueChange={() => undefined} />
        <Button variant="field" aria-label="Range">
          Custom
        </Button>
        <Input aria-label="Name" />
        <Textarea aria-label="Notes" />
      </>,
    )
    const triggers = [
      view.container.querySelector('[data-slot="select-trigger"]')!,
      view.getByRole('combobox', { name: 'Project' }),
      view.getByRole('button', { name: 'Range' }),
    ]
    for (const trigger of triggers) {
      expect(rest(trigger), trigger.getAttribute('aria-label') ?? '').toEqual(expect.arrayContaining(['dshx:border-border', 'dshx:bg-trigger-fill']))
      expect(rest(trigger), trigger.getAttribute('aria-label') ?? '').not.toContain('dshx:border-transparent')
      expect(rest(trigger), trigger.getAttribute('aria-label') ?? '').not.toContain('dshx:border-field-border')
      expect(classes(trigger)).toContain('dshx:not-disabled:hover:border-field-border')
    }
    for (const field of [view.getByRole('textbox', { name: 'Name' }), view.getByRole('textbox', { name: 'Notes' })])
      expect(rest(field)).toEqual(expect.arrayContaining(['dshx:border-field-border', 'dshx:bg-background']))
  })

  it.each(schemes)('paints the round-10 fill on the page and one step off every other surface, text AA and edges 3:1 on it (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const dark = scheme === 'dark'
    expect(ThemeCss.blockDeclarations(WARM_STONE, scheme)).toContain(`  --dshx-trigger-fill: ${PaletteMath.toCss(p.triggerFill)};`)
    const surfaces = {
      bg: p.neutral[0]!,
      panel: p.neutral[1]!,
      raised: p.neutral[2]!,
      nav: p.navSurface,
      selected: p.selectedWash,
      dialog: dark ? { l: 0.27, c: 0.006, h: 60 } : p.neutral[0]!,
    }
    const fill = (under: Oklch): Oklch => composite(under, p.triggerFill, p.triggerFill.alpha ?? 1)
    // The council's values on the page: oklch(0.955 0.004 65) light, oklch(0.235 0.006 65) dark (8-bit rounding).
    expect(fill(surfaces.bg).l).toBeCloseTo(dark ? 0.235 : 0.955, 2)
    for (const [name, under] of Object.entries(surfaces)) {
      const chip = fill(under)
      // A visible step off its surface, darker in light and lighter in dark: never swallowed, never sunk.
      expect(dark ? chip.l - under.l : under.l - chip.l, name).toBeGreaterThanOrEqual(0.03)
      // Ink and secondary text (the chevron and a placeholder).
      for (const step of [10, 9]) expect(PaletteMath.contrastRatio(p.neutral[step]!, chip), `${name} step ${step}`).toBeGreaterThanOrEqual(4.5)
      // The focus cue (WCAG 2.4.11): the 2px accent outline, 3:1 against the chip and the surface around it.
      expect(PaletteMath.contrastRatio(p.accent.fg, chip), `${name} focus`).toBeGreaterThanOrEqual(3)
      expect(PaletteMath.contrastRatio(p.accent.fg, under), `${name} focus`).toBeGreaterThanOrEqual(3)
    }
    // Where filter rows live (the page, a panel, the nav column) the hover and open edge holds 3:1 on both sides. A
    // placeholder is the secondary step (`data-[placeholder]:text-muted-foreground`), checked above.
    for (const under of [surfaces.bg, surfaces.panel, surfaces.nav]) expect(PaletteMath.contrastRatio(p.fieldBorder, fill(under))).toBeGreaterThanOrEqual(3)
    // The rest hairline (council round 11 A2) is the divider step (`--dsw-alias-border-l2`, neutral step 4). It outlines
    // the chip against every surface it sits on (a step off the surface, like a card's hairline), on the page, a panel
    // and the nav column it also separates from the chip's own fill, and it stays quieter than the 3:1 hover edge, so
    // hover still reads as a change. The fill and this outline identify the control; the 3:1 edge marks interaction.
    const hairline = p.neutral[4]!
    for (const [name, under] of Object.entries(surfaces)) {
      expect(PaletteMath.contrastRatio(hairline, under), `${name} hairline on surface`).toBeGreaterThanOrEqual(1.06)
      expect(PaletteMath.contrastRatio(hairline, fill(under)), `${name} hairline quieter than the edge`).toBeLessThan(PaletteMath.contrastRatio(p.fieldBorder, fill(under)))
    }
    for (const under of [surfaces.bg, surfaces.panel, surfaces.nav]) expect(PaletteMath.contrastRatio(hairline, fill(under))).toBeGreaterThanOrEqual(1.08)
  })
})

describe('typeable combobox at rest (council round 11 A4)', () => {
  const rest = (element: Element): readonly string[] => classes(element).filter(name => !/:(hover|focus|data-|aria-|not-|placeholder|disabled|selection|file|md|dark)/u.test(name.replace(/^dshx:/u, '')))

  it('looks like its trigger pair at rest and takes the field look on focus, while typing and while open', () => {
    expect(typeableTriggerLook.split(' ')).toEqual([
      'dshx:rounded-lg',
      'dshx:border',
      'dshx:border-border',
      'dshx:bg-trigger-fill',
      'dshx:not-disabled:hover:border-field-border',
      'dshx:aria-expanded:border-field-border',
      'dshx:focus-within:border-field-border',
      'dshx:focus-within:bg-background',
    ])
    // The rest look is the quiet trigger's, part for part.
    for (const part of ['dshx:rounded-lg', 'dshx:border', 'dshx:border-border', 'dshx:bg-trigger-fill']) expect(triggerLook.split(' ')).toContain(part)
  })

  it('is an Input option, rest="trigger", that keeps the focus ring and the default field look otherwise', () => {
    const view = render(
      <>
        <Input aria-label="Compare against" role="combobox" aria-expanded={false} rest="trigger" />
        <Input aria-label="Name" />
      </>,
    )
    const typeable = view.getByRole('combobox', { name: 'Compare against' })
    expect(typeable.getAttribute('data-rest')).toBe('trigger')
    expect(rest(typeable)).toEqual(expect.arrayContaining(['dshx:border-border', 'dshx:bg-trigger-fill']))
    expect(rest(typeable)).not.toContain('dshx:border-field-border')
    expect(rest(typeable)).not.toContain('dshx:bg-background')
    expect(classes(typeable)).toEqual(expect.arrayContaining(['dshx:focus-within:border-field-border', 'dshx:focus-within:bg-background', 'dshx:focus-visible:border-ring']))
    const plain = view.getByRole('textbox', { name: 'Name' })
    expect(plain.getAttribute('data-rest')).toBeNull()
    expect(rest(plain)).toEqual(expect.arrayContaining(fieldLook.split(' ')))
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
