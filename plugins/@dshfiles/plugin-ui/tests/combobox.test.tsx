import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Combobox, type ComboboxOption } from '../src/components/ui/combobox.js'

const options: readonly ComboboxOption[] = [
  { value: 'alpha', label: 'Alpha' },
  { value: 'beta', label: 'Beta', description: '/srv/beta' },
  { value: 'gamma', label: 'Gamma', group: 'Others' },
  { value: 'delta', label: 'Delta', group: 'Others' },
  { value: 'epsilon', label: 'Epsilon', group: 'Others' },
  { value: 'zeta', label: 'Zeta', group: 'Others' },
  { value: 'eta', label: 'Eta', group: 'Others' },
  { value: 'theta', label: 'Theta', group: 'Others' },
  { value: 'iota', label: 'Iota', group: 'Others' },
  { value: 'kappa', label: 'Kappa', group: 'Others', disabled: true },
]

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn()
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
})

afterEach(cleanup)

describe('Combobox', () => {
  it('shows the current label and picks a searched row', () => {
    const onValueChange = vi.fn()
    render(<Combobox label="Project" onValueChange={onValueChange} options={options} value="alpha" />)
    const trigger = screen.getByRole('combobox', { name: 'Project' })
    expect(trigger.textContent).toBe('Alpha')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    fireEvent.change(screen.getByRole('combobox', { name: 'Project search' }), { target: { value: 'gamma' } })
    expect(screen.queryByRole('option', { name: /Alpha/ })).toBeNull()
    fireEvent.click(screen.getByRole('option', { name: /Gamma/ }))
    expect(onValueChange).toHaveBeenCalledWith('gamma')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('shows no search box for a short list, and marks the selected row', () => {
    render(<Combobox label="Confidence" onValueChange={vi.fn()} options={options.slice(0, 3)} value="beta" />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Confidence' }))
    expect(screen.queryByRole('combobox', { name: /search/ })).toBeNull()
    const selected = screen.getByRole('option', { name: /Beta/ })
    expect(selected.querySelector('svg')).not.toBeNull()
    expect(screen.getByRole('option', { name: /Alpha/ }).querySelector('svg')).toBeNull()
  })

  it('does not pick a disabled row and groups rows under their headings', () => {
    const onValueChange = vi.fn()
    render(<Combobox label="Project" onValueChange={onValueChange} options={options} value="alpha" />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Project' }))
    expect(screen.getByText('Others')).not.toBeNull()
    fireEvent.click(screen.getByRole('option', { name: /Kappa/ }))
    expect(onValueChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('option', { name: /Delta/ }))
    expect(onValueChange).toHaveBeenCalledWith('delta')
  })

  it('moves through a short list with the keyboard', () => {
    const onValueChange = vi.fn()
    render(<Combobox label="Confidence" onValueChange={onValueChange} options={options.slice(0, 3)} value="alpha" />)
    fireEvent.click(screen.getByRole('combobox', { name: 'Confidence' }))
    const list = screen.getByRole('listbox')
    fireEvent.keyDown(list, { key: 'ArrowDown' })
    fireEvent.keyDown(list, { key: 'Enter' })
    expect(onValueChange).toHaveBeenCalledWith('beta')
  })

  it('renders a custom trigger and placeholder', () => {
    render(<Combobox label="Scope" onValueChange={vi.fn()} options={options} placeholder="Pick one" value="missing" triggerContent={<span>chip</span>} />)
    const trigger = screen.getByRole('combobox', { name: 'Scope' })
    expect(trigger.textContent).toBe('chip')
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('option', { name: /Alpha/ }))
    expect(screen.queryByRole('option', { name: /Alpha/ })).toBeNull()
  })
})
