// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import type { SidebarSection } from './organization.js'
import { RemoteThreadItem, type RemoteThreadRowLabels } from './remote-threads-section.js'

const labels: RemoteThreadRowLabels = {
  settle: 'Settle',
  unsettle: 'Unsettle',
  park: 'Park',
  unpark: 'Unpark',
  moveToSection: 'Move to section',
  copyId: 'Copy ID',
  contextMenu: 'Thread actions',
  sectionLabels: { pinned: 'Pinned', active: 'Active', parked: 'Parked', settled: 'Settled', inactive: 'Inactive', archived: 'Archived' },
}

const dropSections: readonly SidebarSection[] = ['active', 'parked', 'inactive', 'settled']

const mount = (
  options: {
    settled?: boolean
    parked?: boolean
    running?: boolean
    selected?: boolean
    section?: SidebarSection
  } = {},
) => {
  const onOpen = vi.fn()
  const onToggleSettled = vi.fn()
  const onToggleParked = vi.fn()
  const onMoveToSection = vi.fn()
  const onCopyId = vi.fn()
  const view = render(
    <TooltipProvider>
      <RemoteThreadItem
        runtimeId="runtime-1"
        sessionId="session-remote"
        label="Fix the parser"
        cwd="/peer/dev/dshfiles"
        hostName="m1-perso"
        workspaceTitle="dshfiles"
        connected
        running={options.running ?? false}
        settled={options.settled ?? false}
        parked={options.parked ?? false}
        selected={options.selected ?? false}
        compact={false}
        age="2h"
        section={options.section}
        dropSections={dropSections}
        labels={labels}
        onOpen={onOpen}
        onToggleSettled={onToggleSettled}
        onToggleParked={onToggleParked}
        onMoveToSection={onMoveToSection}
        onCopyId={onCopyId}
      />
    </TooltipProvider>,
  )
  return { ...view, onOpen, onToggleSettled, onToggleParked, onMoveToSection, onCopyId }
}

const openMenu = (): void => {
  fireEvent.contextMenu(screen.getByRole('button', { name: /Fix the parser/u }), { clientX: 20, clientY: 20 })
}

afterEach(cleanup)

describe('RemoteThreadItem', () => {
  it('draws a local-looking row: title, age and the host on its own meta line', () => {
    mount()
    const row = screen.getByRole('button', { name: /Fix the parser/u })
    expect(row.getAttribute('data-remote-thread-id')).toBe('runtime-1:session-remote')
    expect(row.textContent).toContain('2h')
    expect(row.textContent).toContain('m1-perso')
    expect(row.textContent).toContain('dshfiles')
  })

  it('offers the settle and park verbs the sidebar owns for a remote id', () => {
    const { onToggleSettled, onToggleParked } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Settle' }))
    fireEvent.click(screen.getByRole('button', { name: 'Park' }))
    expect(onToggleSettled).toHaveBeenCalledTimes(1)
    expect(onToggleParked).toHaveBeenCalledTimes(1)
  })

  it('reads a settled row as Unsettle and mutes its title', () => {
    const { container, onToggleSettled } = mount({ settled: true })
    const unsettle = screen.getByRole('button', { name: 'Unsettle' })
    fireEvent.click(unsettle)
    expect(onToggleSettled).toHaveBeenCalledTimes(1)
    expect(container.querySelector('.dshx\\:text-muted-foreground')).not.toBeNull()
  })

  it('withholds the state verbs while the remote thread runs', () => {
    mount({ running: true })
    expect(screen.queryByRole('button', { name: 'Settle' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Park' })).toBeNull()
  })

  it('opens the thread from the row body', () => {
    const { onOpen } = mount()
    fireEvent.click(screen.getByRole('button', { name: /Fix the parser/u }))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('offers the same preference verbs in its context menu and no Host verb', () => {
    const { onToggleSettled, onCopyId } = mount({ section: 'active' })
    openMenu()
    const menu = screen.getByRole('menu', { name: 'Thread actions' })
    expect(menu.textContent).toContain('Settle')
    expect(menu.textContent).toContain('Park')
    // Archive, pin and rename stay on the runtime that owns the Session.
    expect(menu.textContent).not.toContain('Archive')
    expect(menu.textContent).not.toContain('Pin')
    expect(menu.textContent).not.toContain('Rename')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy ID' }))
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settle' }))
    expect(onToggleSettled).toHaveBeenCalledTimes(1)
    expect(onCopyId).toHaveBeenCalledTimes(1)
  })

  it('moves the row into another offered section and disables the one it is already in', () => {
    const { onMoveToSection } = mount({ section: 'active' })
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to section' }))
    expect(screen.getByRole('menuitem', { name: 'Active' }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Settled' }))
    expect(onMoveToSection).toHaveBeenCalledWith('settled')
    expect(screen.queryByRole('menuitem', { name: 'Pinned' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'Archived' })).toBeNull()
  })

  it('disables the state verbs in the menu while the thread runs', () => {
    mount({ running: true })
    openMenu()
    expect(screen.getByRole('menuitem', { name: 'Settle' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('menuitem', { name: 'Park' }).getAttribute('aria-disabled')).toBe('true')
  })
})
