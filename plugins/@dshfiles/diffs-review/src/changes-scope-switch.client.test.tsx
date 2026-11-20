// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChangesScopeSwitch } from './changes-scope-switch.js'

afterEach(cleanup)

describe('Changes scope switch', () => {
  it('is the kit segmented control, not a row of outline buttons', () => {
    render(<ChangesScopeSwitch label={scope => scope} onChange={() => undefined} scopes={['This turn', 'Whole thread']} value="This turn" />)
    const group = document.querySelector('[data-slot="toggle-group"]')
    expect(group?.getAttribute('aria-label')).toBe('Changes scope')
    expect(group?.getAttribute('data-variant')).not.toBe('outline')
    expect(group?.querySelectorAll('[data-variant="outline"]')).toHaveLength(0)
  })

  it('reports the scope that was chosen', () => {
    const onChange = vi.fn()
    render(<ChangesScopeSwitch label={scope => scope} onChange={onChange} scopes={['This turn', 'Whole thread']} value="This turn" />)
    expect(screen.getByRole('radio', { name: 'This turn' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: 'Whole thread' }))
    expect(onChange).toHaveBeenCalledWith('Whole thread')
  })
})
