// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SidebarCustomizationFallback, SidebarCustomizationSeat } from './sidebar-customization.js'
import { SidebarStateProvider, useSidebarState } from './sidebar-state.js'
import { storedPreferences } from './preferences.js'

const EditorFields = ({ onDone }: { readonly onDone: () => void }): JSX.Element => {
  const { preferences, updatePreferences } = useSidebarState()
  return (
    <>
      <label>
        <input type="checkbox" checked={!preferences.hideBrandLogo} onChange={event => updatePreferences({ hideBrandLogo: !event.currentTarget.checked })} />
        Show brand logo
      </label>
      <button onClick={onDone}>Done</button>
    </>
  )
}

const PreferencesProbe = (): JSX.Element => <output aria-label="Brand logo preference">{String(useSidebarState().preferences.hideBrandLogo)}</output>

const EditorOwner = ({ target }: { readonly target: HTMLElement | null }): JSX.Element => {
  const [open, setOpen] = useState(true)
  return (
    <SidebarStateProvider>
      <PreferencesProbe />
      {open ? (
        <SidebarCustomizationSeat target={target} label="Customize sidebar">
          <EditorFields onDone={() => setOpen(false)} />
        </SidebarCustomizationSeat>
      ) : null}
    </SidebarStateProvider>
  )
}

afterEach(() => {
  cleanup()
  storedPreferences.remove()
})

describe('sidebar customization ownership', () => {
  it('removes the fixed header copy whenever real sidebar content is overridden and restores the standalone fallback', () => {
    const onClick = vi.fn()
    const view = render(<SidebarCustomizationFallback contentOverridden label="Sidebar settings" onClick={onClick} />)
    expect(screen.queryByRole('button', { name: 'Sidebar settings' })).toBeNull()
    view.rerender(<SidebarCustomizationFallback contentOverridden={false} label="Sidebar settings" onClick={onClick} expanded={false} />)
    const button = screen.getByRole('button', { name: 'Sidebar settings' })
    expect(button.querySelector('svg.lucide-settings')).toBeTruthy()
    expect(button.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
    view.rerender(<SidebarCustomizationFallback contentOverridden label="Sidebar settings" onClick={onClick} />)
    expect(screen.queryByRole('button', { name: 'Sidebar settings' })).toBeNull()
  })

  it('portals the same Root-owned preference controls into the Threads seat and closes through the owner', () => {
    const hostView = render(<div data-testid="threads-seat" />)
    const host = screen.getByTestId('threads-seat')
    // This root has no SidebarStateProvider: the editor must retain its original React context.
    const view = render(<EditorOwner target={host} />)
    const editor = within(host).getByRole('region', { name: 'Customize sidebar' })
    expect(view.container.querySelector('[aria-label="Customize sidebar"]')).toBeNull()
    expect(editor.classList.contains('dshx:inset-0')).toBe(true)
    expect(editor.classList.contains('dshx:top-12')).toBe(false)
    fireEvent.click(within(editor).getByRole('checkbox', { name: 'Show brand logo' }))
    expect(screen.getByRole('status', { name: 'Brand logo preference' }).textContent).toBe('true')
    expect(storedPreferences.get()?.hideBrandLogo).toBe(true)
    fireEvent.click(within(editor).getByRole('button', { name: 'Done' }))
    expect(host.childElementCount).toBe(0)
    expect(screen.getByRole('status', { name: 'Brand logo preference' }).textContent).toBe('true')
    view.unmount()
    hostView.unmount()
  })

  it('follows a moved seat and falls back locally on release without leaving an editor in the old host', () => {
    render(
      <>
        <div data-testid="left-seat" />
        <div data-testid="right-seat" />
      </>,
    )
    const left = screen.getByTestId('left-seat')
    const right = screen.getByTestId('right-seat')
    const view = render(<EditorOwner target={left} />)
    expect(within(left).getByRole('region', { name: 'Customize sidebar' })).toBeTruthy()
    view.rerender(<EditorOwner target={right} />)
    expect(left.childElementCount).toBe(0)
    expect(within(right).getByRole('region', { name: 'Customize sidebar' })).toBeTruthy()
    expect(screen.getAllByRole('region', { name: 'Customize sidebar' })).toHaveLength(1)
    view.rerender(<EditorOwner target={null} />)
    expect(right.childElementCount).toBe(0)
    const fallback = within(view.container).getByRole('region', { name: 'Customize sidebar' })
    expect(fallback.classList.contains('dshx:top-12')).toBe(true)
    expect(fallback.classList.contains('dshx:inset-0')).toBe(false)
    view.unmount()
    expect(screen.queryByRole('region', { name: 'Customize sidebar' })).toBeNull()
  })
})
