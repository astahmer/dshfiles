// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { groupCountStatusOf, ThreadGroupHeader } from './thread-group-header.js'

const mount = (
  options: {
    collapsed?: boolean
    projectId?: string
    label?: string
    action?: ReactNode
    icon?: ReactNode
    checkoutCount?: number
    statusCounts?: { readonly needsYou: number; readonly failed: number }
    status?: 'working' | 'ready' | 'idle' | 'done'
  } = {},
) => {
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
    t: (_key, params) => `New thread in ${String(params?.project)}`,
  }
  const withAction = options.action === undefined ? props : { ...props, action: options.action }
  const withIcon = options.icon === undefined ? withAction : { ...withAction, icon: options.icon }
  const withCheckouts = options.checkoutCount === undefined ? withIcon : { ...withIcon, checkoutCount: options.checkoutCount }
  const withSplit = options.statusCounts === undefined ? withCheckouts : { ...withCheckouts, statusCounts: options.statusCounts }
  const withCounts = options.status === undefined ? withSplit : { ...withSplit, status: options.status }
  const view = render(
    <TooltipProvider>
      <ThreadGroupHeader {...withCounts} />
    </TooltipProvider>,
  )
  return { ...view, onToggle, startProjectSession }
}

afterEach(cleanup)

describe('ThreadGroupHeader', () => {
  it.each([false, true])('keeps create visible and independent of collapse (collapsed=%s)', collapsed => {
    const header = mount({ collapsed, projectId: 'project:explicit' })
    const create = screen.getByRole('button', { name: 'New thread in Shared project' })
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
    const create = screen.getByRole('button', { name: 'New thread in Shared project' })
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
    expect(screen.queryByRole('button', { name: 'New thread in Shared project' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Shared project (12)' }))
    expect(header.onToggle).toHaveBeenCalledOnce()
    expect(header.startProjectSession).not.toHaveBeenCalled()
  })

  it('keeps a group-wide action beside the toggle, not inside it', () => {
    const onResumeAll = vi.fn()
    const header = mount({
      action: (
        <button type="button" onClick={onResumeAll}>
          Resume all
        </button>
      ),
    })
    const action = screen.getByRole('button', { name: 'Resume all' })
    const toggle = screen.getByRole('button', { name: 'Shared project (12)' })
    expect(action.parentElement).toBe(toggle.parentElement)
    expect(toggle.contains(action)).toBe(false)
    fireEvent.click(action)
    expect(onResumeAll).toHaveBeenCalledOnce()
    expect(header.onToggle).not.toHaveBeenCalled()
  })

  it('renders the project mark inside the row toggle, before its name', () => {
    const header = mount({ label: 'repo', projectId: 'project-1', icon: <span data-project-mark="">R</span> })
    const mark = header.container.querySelector('[data-project-mark]')
    const toggle = screen.getByRole('button', { name: /^R repo \(12\)$/u })
    expect(mark).not.toBeNull()
    expect(toggle.contains(mark)).toBe(true)
  })

  it('tints the Needs you count chips in their status hue and keeps the label and the spoken count unchanged', () => {
    const header = mount({ label: 'Needs you', statusCounts: { needsYou: 2, failed: 1 } })
    const toggle = screen.getByRole('button', { name: 'Needs you (12)' })
    const chips = Array.from(header.container.querySelectorAll<HTMLElement>('[data-group-count]'))
    expect(chips.map(chip => [chip.dataset.groupCount, chip.textContent?.replace(/\s.*$/su, '')])).toEqual([
      ['needs-you', '2'],
      ['failed', '1'],
    ])
    // The kit's StatusCount (round five B3): each number beside its status glyph, so the counts read without colour.
    expect(chips.map(chip => chip.getAttribute('data-slot'))).toEqual(['status-count', 'status-count'])
    expect(chips.map(chip => chip.querySelector('[data-slot="status-glyph"]')?.getAttribute('data-status'))).toEqual(['needs-you', 'failed'])
    expect(chips[0]?.className).toContain('dshx:bg-attention-tint')
    expect(chips[0]?.className).toContain('dshx:text-attention-foreground')
    expect(chips[1]?.className).toContain('dshx:bg-danger-tint')
    expect(chips[1]?.className).toContain('dshx:text-danger-tint-foreground')
    expect(screen.getAllByText('Needs you')[0]?.className).toContain('dshx:truncate')
    expect(toggle.className).toContain('dshx:text-muted-foreground')
    cleanup()
    const plain = mount({ label: 'Working' })
    expect(plain.container.querySelector('[data-group-count]')).toBeNull()
  })

  it.each(['working', 'ready', 'idle'] as const)(
    'counts the %s group with its 10px status glyph in a muted chip, the spoken name unchanged (council round 15 B2)',
    status => {
      const header = mount({ label: 'Group', status })
      screen.getByRole('button', { name: 'Group (12)' })
      const chips = Array.from(header.container.querySelectorAll<HTMLElement>('[data-group-count]'))
      expect(chips.map(chip => [chip.dataset.groupCount, chip.getAttribute('data-slot'), chip.textContent?.replace(/\s.*$/su, '')])).toEqual([
        [status, 'status-count', '12'],
      ])
      const glyph = chips[0]?.querySelector('[data-slot="status-glyph"]')
      expect(glyph?.getAttribute('data-status')).toBe(status)
      expect(glyph?.className).toContain('dshx:size-2.5')
      // Neutral: the muted chip, no new hue.
      expect(chips[0]?.className).toContain('dshx:bg-muted')
      expect(chips[0]?.getAttribute('aria-hidden')).toBe('true')
      // The bracketed total stays for assistive tech only.
      expect(screen.getAllByText('(12)').map(node => node.className)).toEqual(['dshx:sr-only'])
    },
  )

  it('counts the Drafts group with the idle glyph its never-prompted rows carry, as the other groups do (council round 16 B2)', () => {
    // "Drafts (1)" kept the bracketed count beside groups that count in the chip.
    const status = groupCountStatusOf('draft')
    expect(status).toBe('idle')
    if (status === undefined) throw new Error('the Drafts group maps to a status')
    const header = mount({ label: 'Drafts', status })
    const chips = Array.from(header.container.querySelectorAll<HTMLElement>('[data-group-count]'))
    expect(chips.map(chip => chip.getAttribute('data-slot'))).toEqual(['status-count'])
    expect(chips[0]?.querySelector('[data-slot="status-glyph"]')?.getAttribute('data-status')).toBe('idle')
    expect(screen.getAllByText('(12)').map(node => node.className)).toEqual(['dshx:sr-only'])
    // Pinned and project groups keep "(n)": they stand for no one status.
    expect(groupCountStatusOf('pinned')).toBeUndefined()
  })

  it('names how many local checkouts a repository row stands for', () => {
    mount({ label: 'repo', projectId: 'project-1', checkoutCount: 2 })
    expect(screen.getByText('2 checkouts')).toBeTruthy()
    cleanup()
    mount({ label: 'repo', projectId: 'project-1', checkoutCount: 1 })
    expect(screen.queryByText(/checkouts/u)).toBeNull()
  })

  it('truncates long project names without shrinking or hover-hiding creation at narrow widths', () => {
    const label = 'An extremely long project name that does not fit in a narrow sidebar'
    const header = mount({ label, projectId: 'long-project' })
    const create = screen.getByRole('button', { name: `New thread in ${label}` })
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
