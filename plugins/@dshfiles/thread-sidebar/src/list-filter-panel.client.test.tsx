// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { PaletteMath, WARM_STONE, type Oklch } from '@dshfiles/plugin-ui/theme/palette'
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

  it('offers a reset while a filter is on, and Clear clears the statuses', () => {
    const props = panel({ status: { selected: ['working', 'unread'], onChange: vi.fn() }, reset: { disabled: false, onReset: vi.fn() } })
    render(<ListFilterPanel {...props} />)
    expect(screen.getByRole('button', { name: 'threadSidebarWorking', pressed: true })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'threadSidebarFilterClear' }))
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
  it('keeps the menu order and drops anything that is not a status', () => {
    expect(nextStatusFilters(['all', 'unread', 'working'])).toEqual(['working', 'unread'])
    expect(nextStatusFilters([])).toEqual([])
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

// Council round 27, item 4: the status sub-groups reach assistive tech ("Done" is a preset and a stored status).
describe('the status sub-groups (round 28, item 4)', () => {
  it('puts each status group in its own labelled group, and every chip in one', () => {
    render(<ListFilterPanel {...panel()} />)
    fireEvent.click(screen.getByRole('button', { name: 'threadSidebarFilterMoreStatuses' }))
    const status = screen.getByRole('toolbar', { name: 'threadSidebarFilterStatus' })
    const groups = within(status).getAllByRole('group')
    expect(groups.map(group => group.getAttribute('aria-label') ?? document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent)).toEqual([
      'threadSidebarFilterGroupActivity',
      'threadSidebarFilterGroupAttention',
      'threadSidebarFilterGroupStorage',
    ])
    // No label is hidden from assistive tech, and the stored Done chip sits in the Storage group.
    // A chip's seat is decoration beside its label; nothing else in the toolbar is hidden.
    expect(Array.from(status.querySelectorAll('[aria-hidden="true"]')).filter(element => element.closest('[data-chip-seat]') === null)).toEqual([])
    expect(within(groups[2] as HTMLElement).getByRole('button', { name: 'threadSidebarSettled' })).toBeTruthy()
    const chips = within(status).getAllByRole('button')
    expect(chips.every(chip => chip.closest('[role="group"]') !== null)).toBe(true)
  })
})

/** `over` (with its alpha) on an opaque `under`, composited in gamma sRGB as a browser paints it. */
const paint = (under: Oklch, over: Oklch): Oklch => {
  const alpha = over.alpha ?? 1
  const channels = (color: Oklch): readonly number[] => (PaletteMath.toHex({ ...color, alpha: 1 }).slice(1, 7).match(/../g) ?? []).map(pair => Number.parseInt(pair, 16))
  const [u, o] = [channels(under), channels(over)]
  return PaletteMath.hexToOklch(`#${u.map((value, i) => Math.round(value * (1 - alpha) + (o[i] ?? 0) * alpha).toString(16).padStart(2, '0')).join('')}`)
}

// Council round 27, item 6: a selected chip reads at a glance, in both schemes and on the phone sheet.
describe('the selected state (round 28, item 6)', () => {
  it('draws a selected chip as the segment thumb with the field edge and the 550 ink; a resting one in secondary ink', () => {
    render(<ListFilterPanel {...panel({ status: { selected: ['working'], onChange: vi.fn() } })} />)
    const on = screen.getByRole('button', { name: 'threadSidebarWorking', pressed: true })
    const off = screen.getByRole('button', { name: 'threadSidebarUnread', pressed: false })
    for (const token of ['dshx:data-[state=on]:bg-(--dshx-segment-thumb)', 'dshx:data-[state=on]:border-field-border', 'dshx:data-[state=on]:font-selected', 'dshx:data-[state=on]:text-foreground'])
      expect(on.className).toContain(token)
    // Not the selected wash, which sat one step off the light phone sheet and darker than its neighbours in dark.
    expect(on.className).not.toContain('bg-selected-wash')
    expect(off.className).toContain('dshx:text-muted-foreground')
  })

  it('shows a 12px check on a selected status chip, so the multi-select reads as checkboxes', () => {
    render(<ListFilterPanel {...panel({ status: { selected: ['working'], onChange: vi.fn() } })} />)
    const on = screen.getByRole('button', { name: 'threadSidebarWorking', pressed: true })
    const seat = on.querySelector('[data-chip-seat]')
    expect(seat?.className).toContain('dshx:size-3')
    expect(seat?.querySelector('[data-chip-check]')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'threadSidebarUnread', pressed: false }).querySelector('[data-chip-check]')).toBeNull()
  })

  it.each(['light', 'dark'] as const)('holds AA for the labels and 3:1 for the edge on every surface a chip sits on (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const ink = p.neutral[10] as Oklch
    const secondary = p.neutral[9] as Oklch
    // The desktop popover and the phone sheet: paper in light (raised before round 28's item 7), the dialog step in dark.
    const surfaces = scheme === 'light' ? [p.neutral[0], p.neutral[2]] : [p.neutral[2]]
    for (const surface of surfaces as Oklch[]) {
      expect(PaletteMath.contrastRatio(secondary, paint(surface, p.triggerFill))).toBeGreaterThanOrEqual(4.5)
      // WCAG 1.4.11: the selected chip's edge against the surface around it.
      expect(PaletteMath.contrastRatio(p.fieldBorder, surface)).toBeGreaterThanOrEqual(3)
    }
    expect(PaletteMath.contrastRatio(ink, p.segmentThumb)).toBeGreaterThanOrEqual(4.5)
  })
})

// Council round 27, item 9: status chips carry their status glyph; no "Any" chip (no status on means any), and a
// ghost Clear in the Status heading while one is on.
describe('status chips (round 28, item 9)', () => {
  it('carries each status its glyph in the 12px seat beside its label', () => {
    render(<ListFilterPanel {...panel()} />)
    fireEvent.click(screen.getByRole('button', { name: 'threadSidebarFilterMoreStatuses' }))
    const mark = (name: string): string | null | undefined =>
      screen.getByRole('button', { name }).querySelector('[data-chip-seat] [data-chip-mark]')?.getAttribute('data-chip-mark')
    expect(mark('threadSidebarWorking')).toBe('working')
    expect(mark('threadSidebarFilterNotRunning')).toBe('idle')
    expect(mark('threadSidebarFilterAttention')).toBe('needs-you')
    expect(mark('threadSidebarApprovalNeeded')).toBe('needs-you')
    expect(mark('threadSidebarTurnFinished')).toBe('ready')
    expect(mark('threadSidebarInterrupted')).toBe('failed')
    expect(mark('threadSidebarSettled')).toBe('done')
    expect(mark('threadSidebarArchived')).toBe('archived')
  })

  it('has no Any chip, and offers Clear in the heading only while a status is on', () => {
    const { unmount } = render(<ListFilterPanel {...panel()} />)
    expect(screen.queryByRole('button', { name: 'threadSidebarFilterNone' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'threadSidebarFilterClear' })).toBeNull()
    unmount()
    const onChange = vi.fn()
    render(<ListFilterPanel {...panel({ status: { selected: ['working', 'unread'], onChange } })} />)
    const clear = screen.getByRole('button', { name: 'threadSidebarFilterClear' })
    expect(clear.closest('[data-thread-status-heading]')).not.toBeNull()
    fireEvent.click(clear)
    expect(onChange).toHaveBeenCalledWith([])
    // A chip toggles itself off; the others stay.
    fireEvent.click(screen.getByRole('button', { name: 'threadSidebarWorking', pressed: true }))
    expect(onChange).toHaveBeenLastCalledWith(['unread'])
  })
})
