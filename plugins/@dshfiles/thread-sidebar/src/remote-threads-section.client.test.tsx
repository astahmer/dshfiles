// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { RemoteThreadItem } from './remote-threads-section.js'

const labels = { settle: 'Settle', unsettle: 'Unsettle', park: 'Park', unpark: 'Unpark' }

const mount = (options: { settled?: boolean; parked?: boolean; running?: boolean; selected?: boolean } = {}) => {
  const onOpen = vi.fn()
  const onToggleSettled = vi.fn()
  const onToggleParked = vi.fn()
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
        labels={labels}
        onOpen={onOpen}
        onToggleSettled={onToggleSettled}
        onToggleParked={onToggleParked}
      />
    </TooltipProvider>,
  )
  return { ...view, onOpen, onToggleSettled, onToggleParked }
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
})
