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

  it('keeps the custom colour as a lower-case #rrggbb, with no swatch checked while it applies', () => {
    const { onChange } = renderPicker({ kind: 'custom', color: '#12ab34' })
    expect(within(group()).queryByRole('radio', { checked: true })).toBeNull()
    const custom = screen.getByLabelText<HTMLInputElement>('Custom colour for dshfiles')
    expect(custom.value).toBe('#12ab34')
    fireEvent.change(custom, { target: { value: '#ABCDEF' } })
    expect(onChange).toHaveBeenLastCalledWith({ kind: 'custom', color: '#abcdef' })
  })
})
