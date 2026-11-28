// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BaseCombobox } from './base-combobox.js'

afterEach(cleanup)

describe('Review › Compare against (council round 8, D3)', () => {
  it('is a labelled combobox with a chevron, 176 px wide, between the 160 and 192 px the council set', () => {
    render(
      <>
        <label htmlFor="base">Compare against</label>
        <BaseCombobox id="base" base="main" value="" onValueChange={() => undefined} />
      </>,
    )
    const input = screen.getByRole('combobox', { name: 'Compare against' })
    expect(input.getAttribute('aria-expanded')).toBe('false')
    const field = input.closest('[data-review-base-field]')
    expect(field?.className).toContain('dshx:w-44')
    expect(screen.getByRole('button', { name: 'Show bases' }).querySelector('svg')).not.toBeNull()
  })

  it('shows the default base in ink with a muted "default" tag, and drops the tag for a typed override', () => {
    const { rerender } = render(<BaseCombobox id="base" base="main" value="" onValueChange={() => undefined} />)
    const input = screen.getByRole('combobox')
    expect(input.getAttribute('placeholder')).toBe('main')
    expect(input.className).toContain('dshx:placeholder:text-foreground')
    const tag = document.querySelector('[data-review-base-default]')
    expect(tag?.textContent).toBe('default')
    expect(tag?.className).toContain('dshx:text-muted-foreground')
    rerender(<BaseCombobox id="base" base="main" value="release/2.4" onValueChange={() => undefined} />)
    expect(document.querySelector('[data-review-base-default]')).toBeNull()
  })

  it('lists the default to return to it, and the typed override as the chosen row', () => {
    const onValueChange = vi.fn()
    render(<BaseCombobox id="base" base="main" value="release/2.4" onValueChange={onValueChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'Show bases' }))
    expect(screen.getByRole('combobox').getAttribute('aria-expanded')).toBe('true')
    const options = screen.getAllByRole('option')
    expect(options.map(option => option.textContent)).toEqual(['maindefault', 'release/2.4'])
    expect(options[1]?.getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('option', { name: /^main/u }))
    expect(onValueChange).toHaveBeenCalledWith('')
  })

  it('opens from the keyboard with Alt+ArrowDown and closes with Escape', () => {
    render(<BaseCombobox id="base" base="main" value="" onValueChange={() => undefined} />)
    const input = screen.getByRole('combobox')
    fireEvent.keyDown(input, { key: 'ArrowDown', altKey: true })
    expect(input.getAttribute('aria-expanded')).toBe('true')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.getAttribute('aria-expanded')).toBe('false')
  })

  it('is what the page renders, under 12/16 labels, with a one-line description (council round 17, D4)', () => {
    const panel = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'panel.tsx'), 'utf8')
    expect(panel).toContain('<BaseCombobox')
    for (const label of ['Project or workspace', 'Compare against']) expect(panel).toMatch(new RegExp(`className=\\{REVIEW_CONTROL_LABEL\\}[^>]*>\\s*${label}\\s*<`, 'u'))
    expect(panel).toMatch(/const REVIEW_CONTROL_LABEL = 'dshx:text-xs dshx:leading-4 dshx:text-muted-foreground'/u)
    expect(panel).toContain('description="Changed files, most important first."')
  })
})

describe('Review › Compare against at rest (council round 11, D3)', () => {
  it('takes the trigger look of the project picker beside it at rest, the field edge on focus or typing', () => {
    render(<BaseCombobox id="base" base="main" value="" onValueChange={() => undefined} />)
    const input = screen.getByRole('combobox')
    // The kit's typeable rest look (A4): the trigger fill and hairline at rest, the 3:1 edge on hover, open or typing.
    expect(input.getAttribute('data-rest')).toBe('trigger')
  })
})
