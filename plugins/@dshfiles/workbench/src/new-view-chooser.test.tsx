import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NewViewChooser } from './new-view-chooser.js'
import type { WorkbenchPanelDefinition } from './registry.js'

afterEach(cleanup)

const source = (id: string, title: string, extra: Partial<WorkbenchPanelDefinition> = {}): WorkbenchPanelDefinition => ({
  id,
  title,
  component: () => null,
  ...extra,
})

describe('NewViewChooser', () => {
  it('shows and searches producer-qualified names with stable special-view ordering', () => {
    const definitions = [
      source('backlog', 'Backlog: Items'),
      source('dshfiles-thread-sidebar.workbench-navigation', 'Thread Sidebar: Navigation'),
      source('dshfiles-settings', 'Settings Shell: Settings'),
      source('current-conversation', 'Rich Composer: Current conversation', { allowMultiple: true }),
    ]
    render(<NewViewChooser definitions={definitions} onSelect={() => undefined} />)
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual([
      'Settings Shell: Settings',
      'Thread Sidebar: Navigation',
      'Backlog: Items',
    ])
    fireEvent.change(screen.getByRole('textbox', { name: 'Search views' }), { target: { value: 'Rich Composer' } })
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getByText('No matching views.')).toBeDefined()
  })

  it('lists workspace views without separate current-conversation sources', () => {
    const definitions = [
      source('backlog', 'Backlog'),
      source('settings', 'Settings'),
      source('settings/accounts', 'AI Accounts', { hiddenFromAdd: true }),
      source('current-conversation', 'Current conversation', { allowMultiple: true }),
      source('runtime', 'Thread A', { tabId: 'thread:a' }),
    ]
    const select = vi.fn()
    render(<NewViewChooser definitions={definitions} onSelect={select} />)
    expect(screen.getByRole('region', { name: 'Choose a view' })).toBeDefined()
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Backlog', 'Settings'])
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getAllByRole('button', { name: 'Settings' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Backlog' }))
    expect(select).toHaveBeenCalledWith(definitions[0])
  })

  it('searches view names, supports no matches, and focuses only the active chooser', () => {
    const definitions = [source('current-conversation', 'Current conversation'), source('jj', 'Jujutsu')]
    const view = render(<NewViewChooser definitions={definitions} onSelect={() => undefined} autoFocus={false} />)
    const input = screen.getByRole('textbox', { name: 'Search views' })
    expect(document.activeElement).not.toBe(input)
    view.rerender(<NewViewChooser definitions={definitions} onSelect={() => undefined} autoFocus />)
    expect(document.activeElement).toBe(input)
    fireEvent.change(input, { target: { value: ' Juj ' } })
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Jujutsu'])
    fireEvent.change(input, { target: { value: 'unavailable view' } })
    expect(screen.getByText('No matching views.')).toBeDefined()
    expect(screen.queryByRole('button')).toBeNull()
  })
})
