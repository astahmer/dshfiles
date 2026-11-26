// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  IDENTITY_SLOT_COUNT,
  identitySlotName,
  identityToneClass,
  identityToneColor,
  identityToneIndex,
  PalettePicker,
  useIdentityPaletteNames,
} from '../src/components/palette-picker.js'
import { projectToneIndex } from '../src/components/ui/project-mark.js'
import { IdentityPalette, PALETTE_NAMES_ATTRIBUTE } from '../src/theme/identity-palette.ts'

afterEach(() => {
  cleanup()
  document.documentElement.removeAttribute(PALETTE_NAMES_ATTRIBUTE)
  document.body.removeAttribute('data-ds-dark-theme')
})

const swatches = () => screen.getAllByRole('radio')

describe('identity slot helpers', () => {
  it('has six slots and reuses the project tone classes, colours and hash', () => {
    expect(IDENTITY_SLOT_COUNT).toBe(6)
    expect(identityToneClass(3)).toBe('project-tone-balanced-3')
    expect(identityToneClass(8)).toBe('project-tone-balanced-2')
    expect(identityToneClass(-1)).toBe('project-tone-balanced-5')
    expect(identityToneColor(4)).toBe('var(--dshx-project-balanced-4)')
    expect(identityToneIndex).toBe(projectToneIndex)
    expect(identityToneIndex('dshfiles')).toBe(projectToneIndex('dshfiles'))
  })

  it('names a slot from a list, raising the first letter', () => {
    expect(identitySlotName(0)).toBe('Azure')
    expect(identitySlotName(5)).toBe('Teal')
    expect(identitySlotName(1, ['Cyan', 'Green', 'Orange', 'Purple', 'Pink', 'Yellow'])).toBe('Green')
  })

  it('round-trips the names attribute and ignores malformed values', () => {
    const names = {
      dark: ['Cyan', 'Green', 'Orange', 'Purple', 'Pink', 'Yellow'],
    }
    expect(IdentityPalette.parseNames(IdentityPalette.serializeNames(names))).toEqual(names)
    expect(IdentityPalette.serializeNames({})).toBe('')
    expect(IdentityPalette.parseNames('{"dark":["one"]}')).toEqual({})
    expect(IdentityPalette.parseNames('not json')).toEqual({})
    expect(IdentityPalette.namesFor(names, false)[0]).toBe('azure')
    expect(IdentityPalette.namesFor(names, true)[0]).toBe('Cyan')
  })
})

describe('PalettePicker', () => {
  it('is a named radio group of six swatches painted with the slot variables', () => {
    render(<PalettePicker value={2} onChange={() => undefined} label="Project colour" />)
    const group = screen.getByRole('radiogroup', { name: 'Project colour' })
    expect(group.getAttribute('data-slot')).toBe('palette-picker')
    expect(swatches().map(swatch => swatch.getAttribute('aria-label'))).toEqual(['Azure', 'Olive', 'Copper', 'Violet', 'Magenta', 'Teal'])
    swatches().forEach((swatch, slot) => {
      const tone = swatch.querySelector<HTMLElement>('[data-slot="palette-swatch-tone"]')!
      expect(tone.style.backgroundColor).toBe(`var(--dshx-project-balanced-${slot})`)
    })
  })

  it('rings the chosen swatch in ink and makes it the one tab stop', () => {
    render(<PalettePicker value={2} onChange={() => undefined} label="Tag colour" />)
    const checked = swatches().filter(swatch => swatch.getAttribute('aria-checked') === 'true')
    expect(checked.map(swatch => swatch.getAttribute('aria-label'))).toEqual(['Copper'])
    const ring = checked[0]!.querySelector('[data-slot="palette-swatch-ring"]')!
    expect(ring.className).toContain('dshx:border-foreground')
    expect(ring.className).not.toContain('dshx:border-dashed')
    expect(swatches().map(swatch => swatch.tabIndex)).toEqual([-1, -1, 0, -1, -1, -1])
  })

  it('marks the default slot "Default" with a dashed ring while nothing is chosen', () => {
    const { rerender } = render(<PalettePicker value={undefined} defaultSlot={4} onChange={() => undefined} label="Agent colour" />)
    const swatch = screen.getByRole('radio', { name: 'Magenta, Default' })
    expect(swatch.getAttribute('aria-checked')).toBe('true')
    expect(swatch.getAttribute('data-state')).toBe('default')
    expect(swatch.querySelector('[data-slot="palette-swatch-ring"]')!.className).toContain('dshx:border-dashed')
    expect(swatch.tabIndex).toBe(0)
    rerender(<PalettePicker value={1} defaultSlot={4} onChange={() => undefined} label="Agent colour" />)
    expect(screen.queryByRole('radio', { name: /Default/u })).toBeNull()
    expect(screen.getByRole('radio', { name: 'Olive' }).getAttribute('aria-checked')).toBe('true')
  })

  it('chooses on click, and arrow keys, Home and End move focus and choose', () => {
    const onChange = vi.fn<(slot: number) => void>()
    render(<PalettePicker value={0} onChange={onChange} label="Project colour" />)
    fireEvent.click(swatches()[3]!)
    expect(onChange).toHaveBeenLastCalledWith(3)
    fireEvent.keyDown(swatches()[0]!, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith(1)
    expect(document.activeElement).toBe(swatches()[1])
    fireEvent.keyDown(swatches()[0]!, { key: 'ArrowLeft' })
    expect(onChange).toHaveBeenLastCalledWith(5)
    fireEvent.keyDown(swatches()[2]!, { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith(3)
    fireEvent.keyDown(swatches()[2]!, { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith(1)
    fireEvent.keyDown(swatches()[2]!, { key: 'End' })
    expect(onChange).toHaveBeenLastCalledWith(5)
    fireEvent.keyDown(swatches()[2]!, { key: 'Home' })
    expect(onChange).toHaveBeenLastCalledWith(0)
    onChange.mockClear()
    fireEvent.keyDown(swatches()[2]!, { key: 'a' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('gives each swatch a 44px seat on a coarse pointer, and a compact one otherwise', () => {
    const { rerender } = render(<PalettePicker value={0} onChange={() => undefined} label="Project colour" />)
    for (const swatch of swatches()) expect(swatch.className.split(/\s+/u)).toEqual(expect.arrayContaining(['dshx:size-7', 'dshx:pointer-coarse:size-11']))
    rerender(<PalettePicker value={0} size="sm" onChange={() => undefined} label="Project colour" />)
    for (const swatch of swatches()) expect(swatch.className.split(/\s+/u)).toEqual(expect.arrayContaining(['dshx:size-6', 'dshx:pointer-coarse:size-11']))
    expect(swatches()[0]!.querySelector('[data-slot="palette-swatch-tone"]')!.className).toContain('dshx:size-4')
  })

  it('disables every swatch when disabled', () => {
    render(<PalettePicker value={0} disabled onChange={() => undefined} label="Project colour" />)
    for (const swatch of swatches()) expect(swatch.hasAttribute('disabled')).toBe(true)
  })

  it('names swatches after the active theme, per scheme, and follows changes', async () => {
    render(<PalettePicker value={0} onChange={() => undefined} label="Project colour" />)
    const names = {
      dark: ['cyan', 'green', 'orange', 'purple', 'pink', 'yellow'],
      light: ['Colour 1', 'Colour 2', 'Colour 3', 'Colour 4', 'Colour 5', 'Colour 6'],
    }
    await act(async () => {
      document.documentElement.setAttribute(PALETTE_NAMES_ATTRIBUTE, IdentityPalette.serializeNames(names))
      await Promise.resolve()
    })
    expect(swatches()[0]!.getAttribute('aria-label')).toBe('Colour 1')
    await act(async () => {
      document.body.setAttribute('data-ds-dark-theme', '')
      await Promise.resolve()
    })
    expect(swatches().map(swatch => swatch.getAttribute('aria-label'))).toEqual(['Cyan', 'Green', 'Orange', 'Purple', 'Pink', 'Yellow'])
    await act(async () => {
      document.documentElement.removeAttribute(PALETTE_NAMES_ATTRIBUTE)
      await Promise.resolve()
    })
    expect(swatches()[0]!.getAttribute('aria-label')).toBe('Azure')
  })
})

describe('useIdentityPaletteNames', () => {
  it('returns the default names without a theme', () => {
    const Probe = () => <span data-testid="names">{useIdentityPaletteNames().join(',')}</span>
    render(<Probe />)
    expect(screen.getByTestId('names').textContent).toBe('azure,olive,copper,violet,magenta,teal')
  })
})
