// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ListFilterPanel, nextStatusFilters, presetMark, type ListFilterPanelProps } from './list-filter-panel.js'

afterEach(cleanup)

// A path, not a URL: under jsdom `URL` is the window's, which Node's fs does not take.
const client = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.tsx'), 'utf8')
/** The list's one Filter control, from its declaration to the list's markup. */
const filterControl = client.slice(client.indexOf('const filterMenu = ('), client.indexOf('<TooltipProvider delayDuration={500}>'))

describe("the thread list's Filter (round nine, owner annotation: the menu felt clunky)", () => {
  it('is one panel beside the list, not a menu of submenus', () => {
    // Before: a dropdown whose Group, Status, Source, Preset options and phone Project rows each opened a submenu.
    expect(filterControl).not.toMatch(/<DropdownMenuSub\b/u)
    expect(filterControl).toContain('<Popover open={filterOpen} onOpenChange={setFilterOpen}>')
    // Beside the list on a desktop, so the rows it filters stay in view; the kit makes a popover the phone's sheet.
    expect(filterControl).toContain('side="right"')
    expect(filterControl).toContain('<ListFilterPanel')
  })
})

const labels = {
  all: { short: 'All', name: 'All sources' },
  main: { short: 'Main', name: 'Main threads' },
  subagents: { short: 'Subagents', name: 'Subagent threads' },
} as const

const panel = (overrides: Partial<ListFilterPanelProps> = {}): ListFilterPanelProps => ({
  t: key => key,
  presets: {
    items: [
      { id: 'all', label: 'All threads', accessibleName: 'All threads', count: null, mark: undefined },
      { id: 'working', label: 'Working', accessibleName: 'Working (2)', count: 2, mark: 'working' },
      { id: 'done', label: 'Done', accessibleName: 'Done (1), threadSidebarTurnFinished', count: 1, mark: 'ready' },
    ],
    activeId: 'all',
    edited: false,
    onApply: vi.fn(),
    onSaveChanges: vi.fn(),
    onDiscard: vi.fn(),
    onSaveAs: vi.fn(),
    options: <button type="button">options</button>,
  },
  status: { selected: [], onChange: vi.fn() },
  source: { value: 'all', onChange: vi.fn() },
  sourceLabels: labels,
  group: {
    value: 'state',
    options: ['state', 'project', 'date', 'status', 'none'],
    labels: { state: 'Status', project: 'Project', date: 'Date', status: 'Arrange manually', none: 'None' },
    onChange: vi.fn(),
  },
  reset: { disabled: true, onReset: vi.fn() },
  actions: [{ id: 'thread-list-settings', label: 'Thread list settings', icon: null, onSelect: vi.fn() }],
  ...overrides,
})

describe('the Filter panel', () => {
  it('shows every choice and its current value at one level', () => {
    render(<ListFilterPanel {...panel()} />)
    // No row opens another menu: presets, status, source and grouping are all in view.
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0)
    const presets = screen.getByRole('radiogroup', { name: 'threadSidebarPresets' })
    expect(within(presets).getByRole('radio', { name: 'All threads' }).getAttribute('aria-checked')).toBe('true')
    expect(within(presets).getByRole('radio', { name: 'Done (1), threadSidebarTurnFinished' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('button', { name: 'threadSidebarFilterNone', pressed: true })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'threadSidebarWorking', pressed: false })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'All sources' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Status' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('button', { name: 'threadSidebarFilterReset' }).hasAttribute('disabled')).toBe(true)
  })

  it('applies a change at once: a preset, a status, a source, a grouping', () => {
    const props = panel()
    render(<ListFilterPanel {...props} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Working (2)' }))
    expect(props.presets?.onApply).toHaveBeenCalledWith('working')
    fireEvent.click(screen.getByRole('button', { name: 'threadSidebarWorking' }))
    expect(props.status?.onChange).toHaveBeenCalledWith(['working'])
    fireEvent.click(screen.getByRole('radio', { name: 'Main threads' }))
    expect(props.source?.onChange).toHaveBeenCalledWith('main')
    fireEvent.click(screen.getByRole('radio', { name: 'Project' }))
    expect(props.group?.onChange).toHaveBeenCalledWith('project')
  })

  it('offers a reset while a filter is on, and Any clears the statuses', () => {
    const props = panel({ status: { selected: ['working', 'unread'], onChange: vi.fn() }, reset: { disabled: false, onReset: vi.fn() } })
    render(<ListFilterPanel {...props} />)
    expect(screen.getByRole('button', { name: 'threadSidebarWorking', pressed: true })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'threadSidebarFilterNone' }))
    expect(props.status?.onChange).toHaveBeenCalledWith([])
    fireEvent.click(screen.getByRole('button', { name: 'threadSidebarFilterReset' }))
    expect(props.reset.onReset).toHaveBeenCalledOnce()
  })

  it('marks an edited preset instead of checking it, with its save and discard', () => {
    const props = panel()
    const presets = props.presets
    if (presets === undefined) throw new Error('The fixture has presets.')
    render(<ListFilterPanel {...props} presets={{ ...presets, activeId: 'working', edited: true }} />)
    expect(screen.getAllByRole('radio', { checked: true }).map(radio => radio.getAttribute('aria-label'))).not.toContain('Working (2)')
    expect(screen.getByText('threadSidebarPresetEditedShort')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /threadSidebarPresetSaveChanges/u }))
    expect(presets.onSaveChanges).toHaveBeenCalledOnce()
    // Picking the edited preset again drops its edits.
    fireEvent.click(screen.getByRole('radio', { name: 'Working (2), threadSidebarPresetEditedShort' }))
    expect(presets.onApply).toHaveBeenCalledWith('working')
  })

  it('keeps why a thread waits and where it is stored under More, open while one of them is on', () => {
    const { unmount } = render(<ListFilterPanel {...panel()} />)
    expect(screen.queryByRole('button', { name: 'threadSidebarArchived' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'threadSidebarFilterMoreStatuses' }))
    expect(screen.getByRole('button', { name: 'threadSidebarArchived', pressed: false })).toBeTruthy()
    unmount()
    render(<ListFilterPanel {...panel({ status: { selected: ['archived'], onChange: vi.fn() } })} />)
    expect(screen.getByRole('button', { name: 'threadSidebarArchived', pressed: true })).toBeTruthy()
  })

  it('gives every control a 44pt touch target and a 36pt chip on a coarse pointer', () => {
    render(<ListFilterPanel {...panel()} />)
    expect(screen.getByRole('radio', { name: 'All threads' }).className).toContain('dshx:pointer-coarse:h-11')
    expect(screen.getByRole('button', { name: 'threadSidebarWorking' }).className).toContain('dshx:pointer-coarse:h-9')
    expect(screen.getByRole('button', { name: 'Thread list settings' }).className).toContain('dshx:pointer-coarse:h-11')
  })
})

describe('nextStatusFilters', () => {
  it('keeps the menu order, clears with Any and leaves Any with a status', () => {
    expect(nextStatusFilters([], ['all', 'unread', 'working'])).toEqual(['working', 'unread'])
    expect(nextStatusFilters(['working'], ['working', 'all'])).toEqual([])
    expect(nextStatusFilters(['working'], [])).toEqual([])
  })
})

// Council round 27, item 1: a preset's mark is the list's own glyph for what it counts, and nothing at a count of 0.
describe('preset marks (round 28, item 1)', () => {
  it('maps what a preset counts to the status glyph its rows draw', () => {
    // A Working view counts working threads: its mark is the ring, even when one of them waits on an approval.
    expect(presetMark({ attentionLabel: 'threadSidebarApprovalNeeded', count: 2, countsWorking: true })).toBe('working')
    expect(presetMark({ attentionLabel: 'threadSidebarApprovalNeeded', count: 1, countsWorking: false })).toBe('needs-you')
    expect(presetMark({ attentionLabel: 'threadSidebarInputNeeded', count: null, countsWorking: false })).toBe('needs-you')
    expect(presetMark({ attentionLabel: 'threadSidebarTurnFinished', count: 1, countsWorking: false })).toBe('ready')
    expect(presetMark({ attentionLabel: 'threadSidebarNeedsResume', count: 1, countsWorking: false })).toBe('failed')
    expect(presetMark({ attentionLabel: 'threadSidebarInterrupted', count: 1, countsWorking: false })).toBe('failed')
    expect(presetMark({ attentionLabel: undefined, count: 3, countsWorking: true })).toBe('working')
    expect(presetMark({ attentionLabel: undefined, count: null, countsWorking: false })).toBeUndefined()
  })

  it('draws no mark and no number at a count of 0', () => {
    expect(presetMark({ attentionLabel: 'threadSidebarApprovalNeeded', count: 0, countsWorking: true })).toBeUndefined()
    expect(presetMark({ attentionLabel: undefined, count: 0, countsWorking: true })).toBeUndefined()
    const base = panel()
    const presets = base.presets
    if (presets === undefined) throw new Error('The fixture has presets.')
    render(<ListFilterPanel {...base} presets={{ ...presets, items: [{ id: 'working', label: 'Working', accessibleName: 'Working', count: 0, mark: undefined }] }} />)
    const row = screen.getByRole('radio', { name: 'Working' })
    expect(row.querySelector('[data-slot="status-glyph"]')).toBeNull()
    expect(row.textContent).toBe('Working')
  })

  it("draws the row glyph (diamond, dot, cross, ring) in the preset row, not a generic dot", () => {
    render(<ListFilterPanel {...panel()} />)
    const done = screen.getByRole('radio', { name: 'Done (1), threadSidebarTurnFinished' })
    expect(done.querySelector('[data-slot="status-glyph"]')?.getAttribute('data-status')).toBe('ready')
    expect(done.querySelector('[data-slot="status-dot"]')).toBeNull()
    expect(screen.getByRole('radio', { name: 'Working (2)' }).querySelector('[data-slot="status-glyph"]')?.getAttribute('data-status')).toBe('working')
  })
})

// Council round 27, item 2: More statuses is a real disclosure that stays mounted, says whether it is open and folds again.
describe('the More statuses disclosure (round 28, item 2)', () => {
  it('stays mounted with a truthful aria-expanded and aria-controls, turns its chevron and folds again', () => {
    render(<ListFilterPanel {...panel()} />)
    const more = screen.getByRole('button', { name: 'threadSidebarFilterMoreStatuses' })
    expect(more.getAttribute('aria-expanded')).toBe('false')
    const controls = more.getAttribute('aria-controls')
    expect(controls).toBeTruthy()
    const region = document.getElementById(controls ?? '')
    expect(region).not.toBeNull()
    expect(region?.querySelector('button')).toBeNull()
    more.focus()
    fireEvent.click(more)
    // Same element, still focused, now open; the region it names holds the hidden statuses.
    expect(screen.getByRole('button', { name: 'threadSidebarFilterMoreStatuses' })).toBe(more)
    expect(document.activeElement).toBe(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(more.querySelector('svg')?.getAttribute('class')).toContain('dshx:rotate-180')
    expect(within(region as HTMLElement).getByRole('button', { name: 'threadSidebarArchived' })).toBeTruthy()
    fireEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'threadSidebarArchived' })).toBeNull()
  })

  it('cannot fold while one of the statuses it holds is on', () => {
    render(<ListFilterPanel {...panel({ status: { selected: ['archived'], onChange: vi.fn() } })} />)
    const more = screen.getByRole('button', { name: 'threadSidebarFilterMoreStatuses' })
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(more.hasAttribute('disabled')).toBe(true)
    expect(screen.getByRole('button', { name: 'threadSidebarArchived', pressed: true })).toBeTruthy()
  })
})

// Council round 27, item 3: an edited preset is announced, not only drawn.
describe('an edited preset (round 28, item 3)', () => {
  it('names its row ", edited" and marks it current, while nothing is checked', () => {
    const base = panel()
    const presets = base.presets
    if (presets === undefined) throw new Error('The fixture has presets.')
    render(<ListFilterPanel {...base} presets={{ ...presets, activeId: 'working', edited: true }} />)
    const row = screen.getByRole('radio', { name: 'Working (2), threadSidebarPresetEditedShort' })
    expect(row.getAttribute('aria-current')).toBe('true')
    expect(row.getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('radio', { name: 'All threads' }).hasAttribute('aria-current')).toBe(false)
  })

  it('keeps the plain name while the preset is as saved', () => {
    render(<ListFilterPanel {...panel()} />)
    expect(screen.getByRole('radio', { name: 'All threads' }).getAttribute('aria-current')).toBe('true')
  })
})
