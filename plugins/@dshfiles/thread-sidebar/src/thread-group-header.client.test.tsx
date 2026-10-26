// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ThreadGroupHeader } from './thread-group-header.js'

const mount = (options: { collapsed?: boolean; projectId?: string; label?: string } = {}) => {
  const onToggle = vi.fn()
  const startProjectSession = vi.fn()
  const props: Parameters<typeof ThreadGroupHeader>[0] = {
    label: options.label ?? 'Shared project',
    count: 12,
    collapsed: options.collapsed ?? false,
    projectId: options.projectId,
    className: 'dshx:sticky dshx:top-0',
    onToggle,
    startProjectSession,
    t: (_key, params) => `New chat in ${String(params?.project)}`,
  }
  const view = render(
    <TooltipProvider>
      <ThreadGroupHeader {...props} />
    </TooltipProvider>,
  )
  return { ...view, onToggle, startProjectSession }
}

afterEach(cleanup)

describe('ThreadGroupHeader', () => {
  it.each([false, true])('keeps create visible and independent of collapse (collapsed=%s)', collapsed => {
    const header = mount({ collapsed, projectId: 'project:explicit' })
    const create = screen.getByRole('button', { name: 'New chat in Shared project' })
    const toggle = screen.getByRole('button', { name: 'Shared project (12)' })

    expect(header.container.querySelector('button button')).toBeNull()
    expect(create.parentElement).toBe(toggle.parentElement)
    expect(toggle.getAttribute('aria-expanded')).toBe(String(!collapsed))
    expect(create.getAttribute('hidden')).toBeNull()
    expect(create.className).not.toMatch(/opacity-0|invisible|group-hover/)
    fireEvent.click(create)
    expect(header.startProjectSession).toHaveBeenCalledExactlyOnceWith('project:explicit')
    expect(header.onToggle).not.toHaveBeenCalled()
    expect(toggle.getAttribute('aria-expanded')).toBe(String(!collapsed))

    fireEvent.click(toggle)
    expect(header.onToggle).toHaveBeenCalledOnce()
    expect(header.startProjectSession).toHaveBeenCalledOnce()
  })

  it('uses a focusable native button and accepts keyboard-origin clicks independently', () => {
    const header = mount({ projectId: 'keyboard-project' })
    const create = screen.getByRole('button', { name: 'New chat in Shared project' })
    expect(create.tagName).toBe('BUTTON')
    expect(create.getAttribute('type')).toBe('button')
    expect(create.tabIndex).toBe(0)
    create.focus()
    expect(document.activeElement).toBe(create)
    // Keyboard activation delivers a click with detail=0; actual Enter/Space synthesis needs a browser, not jsdom.
    fireEvent.click(create, { detail: 0 })
    expect(header.startProjectSession).toHaveBeenCalledExactlyOnceWith('keyboard-project')
    expect(header.onToggle).not.toHaveBeenCalled()
  })

  it('does not offer creation without an explicit registered project target', () => {
    const header = mount()
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'New chat in Shared project' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Shared project (12)' }))
    expect(header.onToggle).toHaveBeenCalledOnce()
    expect(header.startProjectSession).not.toHaveBeenCalled()
  })

  it('truncates long project names without shrinking or hover-hiding creation at narrow widths', () => {
    const label = 'An extremely long project name that does not fit in a narrow sidebar'
    const header = mount({ label, projectId: 'long-project' })
    const create = screen.getByRole('button', { name: `New chat in ${label}` })
    const title = screen.getByText(label)
    const toggle = screen.getByRole('button', { name: `${label} (12)` })
    expect(title.className).toContain('dshx:truncate')
    expect(toggle.className).toContain('dshx:min-w-0')
    expect(create.className).toContain('dshx:shrink-0')
    expect(create.parentElement?.className).toContain('dshx:min-w-0')
    expect(header.container.querySelector('[title]')).toBeNull()
    fireEvent.click(create)
    expect(header.startProjectSession).toHaveBeenCalledExactlyOnceWith('long-project')
  })
})
