// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProjectColorChoice } from './project-tone.js'
import { ProjectTonePicker } from './project-tone-picker.js'

afterEach(cleanup)

const renderPicker = (choice: ProjectColorChoice) => {
  const onChange = vi.fn<(choice: ProjectColorChoice) => void>()
  const view = render(<ProjectTonePicker choice={choice} name="dshfiles" onChange={onChange} />)
  return { ...view, onChange }
}

const group = (): HTMLElement => screen.getByRole('radiogroup')
const swatch = (index: number): HTMLElement => {
  const radio = within(group()).getAllByRole('radio')[index]
  if (radio === undefined) throw new Error(`no swatch ${index}`)
  return radio
}

describe('ProjectTonePicker', () => {
  it('draws the six theme swatches as one kit palette radio group, the custom colour beside it', () => {
    renderPicker({ kind: 'tone', tone: 2 })
    expect(group().getAttribute('data-slot')).toBe('palette-picker')
    expect(group().getAttribute('aria-label')).toBe('Project colour')
    const radios = within(group()).getAllByRole('radio')
    expect(radios.map(radio => radio.getAttribute('aria-label') ?? radio.textContent)).toEqual([
      expect.stringMatching(/^azure/iu),
      expect.stringMatching(/^olive/iu),
      expect.stringMatching(/^copper/iu),
      expect.stringMatching(/^violet/iu),
      expect.stringMatching(/^magenta/iu),
      expect.stringMatching(/^teal/iu),
    ])
    expect(radios.map(radio => radio.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true', 'false', 'false', 'false'])
    // The custom `#rrggbb` (upstream #287) is not one of the theme's slots, so it sits outside the radio group.
    const custom = screen.getByLabelText('Custom colour for dshfiles')
    expect(group().contains(custom)).toBe(false)
  })

  it('moves and selects with the arrow keys, as a radio group does', () => {
    const { onChange } = renderPicker({ kind: 'tone', tone: 2 })
    const checked = within(group()).getByRole('radio', { checked: true })
    fireEvent.keyDown(checked, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'tone', tone: 3 })
    fireEvent.keyDown(checked, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'tone', tone: 1 })
  })

  it('stores a clicked swatch as its palette tone', () => {
    const { onChange } = renderPicker({ kind: 'tone', tone: 0 })
    fireEvent.click(swatch(4))
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'tone', tone: 4 })
  })

  it('seats the custom colour like a palette swatch: 28 px, 44 pt on a coarse pointer, ringed when chosen', () => {
    const { rerender, onChange } = renderPicker({ kind: 'tone', tone: 0 })
    const seat = (): HTMLElement => {
      const label = screen.getByLabelText('Custom colour for dshfiles').closest('label')
      if (label === null) throw new Error('the custom colour input lost its label seat')
      return label
    }
    for (const size of ['dshx:size-7', 'dshx:pointer-coarse:size-11']) {
      expect(swatch(0).classList).toContain(size)
      expect(seat().classList).toContain(size)
    }
    expect(seat().getAttribute('data-state')).toBe('unchecked')
    rerender(<ProjectTonePicker choice={{ kind: 'custom', color: '#12ab34' }} name="dshfiles" onChange={onChange} />)
    expect(seat().getAttribute('data-state')).toBe('checked')
  })

  it('rings the custom seat for its own focus and hover only, not for any group around the picker', () => {
    renderPicker({ kind: 'tone', tone: 0 })
    const label = screen.getByLabelText('Custom colour for dshfiles').closest('label')
    const classes = [label, ...(label?.querySelectorAll('*') ?? [])].flatMap(element => [...(element?.classList ?? [])])
    // An unnamed `group-*` variant answers to the nearest ancestor with `group` anywhere on the page (a settings row,
    // a kit swatch's parent), so the custom seat lit up while a palette swatch had the focus.
    expect(classes.filter(name => /^dshx:group(?:-[a-z-]+)?:/u.test(name) || name === 'dshx:group')).toEqual([])
    expect(classes).toContain('dshx:group/custom-colour')
    expect(classes).toContain('dshx:group-has-focus-visible/custom-colour:ring-2')
  })

  it('wraps its label above the swatches when six 44 pt seats do not fit beside it', () => {
    renderPicker({ kind: 'tone', tone: 0 })
    expect(screen.getByText('Project colour').parentElement?.classList).toContain('dshx:flex-wrap')
  })

  it('keeps the custom colour as a lower-case #rrggbb, with no swatch checked while it applies', () => {
    const { onChange } = renderPicker({ kind: 'custom', color: '#12ab34' })
    expect(within(group()).queryByRole('radio', { checked: true })).toBeNull()
    const custom = screen.getByLabelText<HTMLInputElement>('Custom colour for dshfiles')
    expect(custom.value).toBe('#12ab34')
    fireEvent.change(custom, { target: { value: '#ABCDEF' } })
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'custom', color: '#abcdef' })
  })
})
