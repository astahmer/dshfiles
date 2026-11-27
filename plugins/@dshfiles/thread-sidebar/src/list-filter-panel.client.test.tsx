// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { PaletteMath, WARM_STONE, type Oklch } from '@dshfiles/plugin-ui/theme/palette'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { filterPanelInitialFocus, ListFilterPanel, nextStatusFilters, presetAttentionOf, type ListFilterPanelProps } from './list-filter-panel.js'

afterEach(cleanup)

/** The element a query found, or a failure that names what was missing. */
const element = (found: Element | null | undefined): HTMLElement => {
  if (!(found instanceof HTMLElement)) throw new Error('The element the test reads is not on the page.')
  return found
}

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
      { id: 'all', label: 'All threads', count: null, needsYou: 0, failed: 0 },
      { id: 'working', label: 'Working', count: 2, needsYou: 0, failed: 0 },
      { id: 'done', label: 'Done', count: 3, needsYou: 1, failed: 0 },
    ],
    activeId: 'all',
    edited: false,
    onApply: vi.fn(),
    onSaveChanges: vi.fn(),
    onDiscard: vi.fn(),
    options: <button type="button">options</button>,
  },
  status: { selected: [], onChange: vi.fn() },
  source: { value: 'all', onChange: vi.fn() },
  sourceLabels: labels,
  group: {
    value: 'state',
    options: ['state', 'project', 'date', 'status', 'none'],
    labels: {
      state: { short: 'Status', name: 'Status' },
      project: { short: 'Project', name: 'Project' },
      date: { short: 'Date', name: 'Date' },
      status: { short: 'Manual', name: 'Arrange manually' },
      none: { short: 'None', name: 'None' },
    },
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
    expect(within(presets).getByRole('radio', { name: 'Done, threadSidebarPresetThreads_other, threadSidebarPresetNeedsYou_other' }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('button', { name: 'threadSidebarWorking', pressed: false })).toBeTruthy()
    expect(screen.getByRole('radio', { name: 'All sources' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Status' }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('button', { name: 'threadSidebarFilterResetLabel' }).hasAttribute('disabled')).toBe(true)
  })

  it('applies a change at once: a preset, a status, a source, a grouping', () => {
    const props = panel()
    render(<ListFilterPanel {...props} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Working, threadSidebarPresetThreads_other' }))
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
    fireEvent.click(screen.getByRole('button', { name: 'threadSidebarFilterResetLabel' }))
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
    fireEvent.click(screen.getByRole('radio', { name: 'Working, threadSidebarPresetThreads_other, threadSidebarPresetEditedShort' }))
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
    expect(screen.getByRole('button', { name: 'threadSidebarFilterFewerStatuses' })).toBe(more)
    expect(document.activeElement).toBe(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(more.querySelector('svg')?.getAttribute('class')).toContain('dshx:rotate-180')
    expect(within(element(region)).getByRole('button', { name: 'threadSidebarArchived' })).toBeTruthy()
    fireEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'threadSidebarArchived' })).toBeNull()
  })

  it('cannot fold while one of the statuses it holds is on', () => {
    render(<ListFilterPanel {...panel({ status: { selected: ['archived'], onChange: vi.fn() } })} />)
    const more = screen.getByRole('button', { name: 'threadSidebarFilterFewerStatuses' })
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(more.getAttribute('aria-disabled')).toBe('true')
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
    const row = screen.getByRole('radio', { name: 'Working, threadSidebarPresetThreads_other, threadSidebarPresetEditedShort' })
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
    expect(
      Array.from(status.querySelectorAll('[aria-hidden="true"]')).filter(element => element.closest('[data-chip-seat], [data-thread-status-more]') === null),
    ).toEqual([])
    expect(within(element(groups[2])).getByRole('button', { name: 'threadSidebarSettled' })).toBeTruthy()
    const chips = within(status).getAllByRole('button').filter(chip => !chip.hasAttribute('data-thread-status-more'))
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
    const step = (index: number): Oklch => {
      const tone = p.neutral[index]
      if (tone === undefined) throw new Error(`The palette has no neutral step ${String(index)}.`)
      return tone
    }
    const ink = step(10)
    const secondary = step(9)
    // The desktop popover and the phone sheet: paper in light (raised before round 28's item 7), the dialog step in dark.
    const surfaces = scheme === 'light' ? [step(0), step(2)] : [step(2)]
    for (const surface of surfaces) {
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

// Council round 27, item 8: Source and Group by are segmented controls, not chips; Group by sits under its own
// hairline in a Display section, below what Reset covers.
describe('Source and Group by (round 28, item 8)', () => {
  it('draws Source as the kit segmented control: a raised track, the thumb on the chosen segment', () => {
    render(<ListFilterPanel {...panel()} />)
    const source = screen.getByRole('radiogroup', { name: 'threadSidebarFilterSource' })
    expect(source.hasAttribute('data-segmented')).toBe(true)
    expect(source.className).toContain('dshx:bg-muted')
    // The dark popover is the raised step itself: the track takes the trigger fill there, one step off it.
    expect(source.className).toContain('dshx:dark:bg-trigger-fill')
    const all = within(source).getByRole('radio', { name: 'All sources' })
    expect(all.className).toContain('dshx:data-[state=on]:bg-(--dshx-segment-thumb)')
    expect(all.querySelector('[data-slot="segment-label"]')?.getAttribute('data-label')).toBe('All')
  })

  it('puts Group by in its own Display section under a hairline, Manual standing for Arrange manually', () => {
    render(<ListFilterPanel {...panel()} />)
    const display = screen.getByRole('region', { name: 'threadSidebarFilterDisplay' })
    const group = within(display).getByRole('radiogroup', { name: 'threadSidebarGroupBy' })
    expect(group.hasAttribute('data-segmented')).toBe(true)
    const manual = within(group).getByRole('radio', { name: 'Arrange manually' })
    expect(manual.textContent).toBe('Manual')
    // Its own top-level block, so the panel's hairline divides it from the filters; the filters hold no grouping.
    expect(display.parentElement?.hasAttribute('data-thread-list-filter-panel')).toBe(true)
    expect(screen.getByRole('toolbar', { name: 'threadSidebarFilterStatus' }).closest('section')?.contains(group)).toBe(false)
  })

  it('names Reset for what it covers', () => {
    render(<ListFilterPanel {...panel()} />)
    expect(screen.getByRole('button', { name: 'threadSidebarFilterResetLabel' }).textContent).toBe('threadSidebarFilterReset')
  })
})

// Council round 27, item 10: the phone sheet opens on what it filters, with a sticky Reset · Filters · Done header.
describe('the phone sheet (round 28, item 10)', () => {
  it('keeps a sticky header: Reset, the title "Filters", and Done, which only a phone shows', () => {
    const onDone = vi.fn()
    render(<ListFilterPanel {...panel({ onDone })} />)
    const header = screen.getByRole('heading', { name: 'threadSidebarFilters' }).closest('[data-thread-filter-header]')
    expect(header?.className).toContain('dshx:sticky')
    expect(header?.className).toContain('dshx:top-0')
    // On the phone sheet it sticks over the sheet's 20px grabber padding, so no row shows above it.
    expect(header?.className).toContain('dshx:phone:-top-5')
    expect(header?.className).toContain('dshx:bg-popover')
    const done = within(element(header)).getByRole('button', { name: 'threadSidebarDone' })
    expect(done.className).toContain('dshx:hidden')
    expect(done.className).toContain('dshx:phone:inline-flex')
    fireEvent.click(done)
    expect(onDone).toHaveBeenCalledOnce()
    // Reset leads on a phone, before the title.
    expect(within(element(header)).getByRole('button', { name: 'threadSidebarFilterResetLabel' }).className).toContain('dshx:phone:order-first')
  })

  it('moves "Save current filters as preset…" out of the panel, keeping Save and Discard in view while edited', () => {
    const base = panel()
    const presets = base.presets
    if (presets === undefined) throw new Error('The fixture has presets.')
    render(<ListFilterPanel {...base} presets={{ ...presets, activeId: 'working', edited: true }} />)
    expect(screen.queryByText('threadSidebarPresetSaveAs')).toBeNull()
    expect(screen.getByRole('button', { name: /threadSidebarPresetSaveChanges/u })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'threadSidebarPresetDiscardChanges' })).toBeTruthy()
  })

  it('opens the sheet at 85dvh, names it Filters, and puts Save as… and an inline Project row where the client builds them', () => {
    expect(filterControl).toContain('dshx:phone:max-h-[85dvh]!')
    expect(filterControl).toContain("aria-label={props.tSidebar('threadSidebarFilters')}")
    const optionsMenu = client.slice(client.indexOf('const presetOptionsMenu = ('), client.indexOf('const filterMenu = ('))
    expect(optionsMenu).toContain("props.tSidebar('threadSidebarPresetSaveAs')")
    // "Project · All projects ›": one row, its label and value inline, not a heading over a field.
    expect(filterControl).toMatch(/data-thread-project-row=""/u)
    expect(filterControl).toContain('<ChevronRightIcon')
  })
})

// Council round 27, item 13: the kit squares the inner corners of a ToggleGroup with no spacing (a joined button bar);
// the preset rows stand apart, so each keeps its own rounded corners.
describe('preset rows (round 28, item 13)', () => {
  it('keeps every preset row rounded: the group has spacing, so the kit never squares an inner corner', () => {
    render(<ListFilterPanel {...panel()} />)
    for (const row of within(screen.getByRole('radiogroup', { name: 'threadSidebarPresets' })).getAllByRole('radio'))
      expect(row.getAttribute('data-spacing')).not.toBe('0')
  })
})

// Council round 27, item 14: the panel opened with focus on the preset ⋯; it opens on the preset in force.
describe('initial focus (round 28, item 14)', () => {
  it('lands on the checked preset, or the current one while it is edited', () => {
    const { container, unmount } = render(<ListFilterPanel {...panel()} />)
    expect(filterPanelInitialFocus(container)).toBe(screen.getByRole('radio', { name: 'All threads' }))
    unmount()
    const base = panel()
    const presets = base.presets
    if (presets === undefined) throw new Error('The fixture has presets.')
    const edited = render(<ListFilterPanel {...base} presets={{ ...presets, activeId: 'working', edited: true }} />)
    expect(filterPanelInitialFocus(edited.container)).toBe(screen.getByRole('radio', { name: 'Working, threadSidebarPresetThreads_other, threadSidebarPresetEditedShort' }))
    edited.unmount()
    // Without presets, the first status chip.
    const plain = render(<ListFilterPanel {...panel({ presets: undefined })} />)
    expect(filterPanelInitialFocus(plain.container)).toBe(screen.getByRole('button', { name: 'threadSidebarWorking' }))
  })

  it('is what the popover focuses when it opens', () => {
    expect(filterControl).toMatch(/onOpenAutoFocus=\{event => \{[^}]*filterPanelInitialFocus\(/su)
  })
})

// Council round 27, item 15: a change applies at once to a list the screen reader user cannot see; say what it shows.
describe('the shown count (round 28, item 15)', () => {
  it('announces the visible thread count politely after a filter change, not on opening', () => {
    const { rerender } = render(<ListFilterPanel {...panel({ shown: '8 threads shown' })} />)
    const status = screen.getByRole('status')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(status.className).toContain('dshx:sr-only')
    expect(status.textContent).toBe('')
    rerender(<ListFilterPanel {...panel({ shown: '2 threads shown' })} />)
    expect(screen.getByRole('status').textContent).toBe('2 threads shown')
  })

  it('counts what the list shows, through the shared plural table', () => {
    expect(filterControl).toMatch(/shown=\{plural\(props\.tSidebar, 'threadSidebarFilterShown', visibleThreadEntries\.length\)\}/u)
  })
})

// Council round 27, item 16: one 12px content inset, one 16px glyph column, labels on one x (12 + 16 + 8 = 36px), and
// the presets' ⋯ and Reset ending on one right edge, the 12px inset.
describe('edges (round 28, item 16)', () => {
  /** A ghost sm button's own padding: 10px (8px beside a glyph); kit button.tsx `sm`. */
  it("ends Reset's label on the 12px inset: the header's 2px plus the button's 10px, on a desktop and a phone", () => {
    render(<ListFilterPanel {...panel()} />)
    const header = screen.getByRole('heading', { name: 'threadSidebarFilters' }).closest('[data-thread-filter-header]')
    expect(header?.className).toContain('dshx:pr-0.5')
    expect(header?.className).toContain('dshx:phone:px-0.5')
    expect(header?.className).toContain('dshx:pl-3')
  })

  it('puts every quiet row on the glyph column: a 16px glyph at 12px, its label 8px after it', () => {
    const base = panel({ status: { selected: [], onChange: vi.fn() } })
    const presets = base.presets
    if (presets === undefined) throw new Error('The fixture has presets.')
    render(<ListFilterPanel {...base} presets={{ ...presets, activeId: 'working', edited: true }} />)
    const quiet = [
      screen.getByRole('button', { name: /threadSidebarPresetSaveChanges/u }),
      screen.getByRole('button', { name: 'threadSidebarPresetDiscardChanges' }),
      screen.getByRole('button', { name: 'threadSidebarFilterMoreStatuses' }),
      screen.getByRole('button', { name: 'Thread list settings' }),
    ]
    for (const row of quiet) {
      expect(row.className, row.textContent ?? '').toContain('dshx:gap-2')
      expect(row.className, row.textContent ?? '').toContain('dshx:[&_svg]:size-4')
      expect(row.className, row.textContent ?? '').toContain('dshx:px-1.5')
    }
    // The preset rows: the same column (6px row padding inside a -6px bleed), the same 8px gap.
    const preset = screen.getByRole('radio', { name: 'All threads' })
    expect(preset.className).toContain('dshx:px-1.5')
    expect(preset.className).toContain('dshx:gap-2')
  })

  it("ends the presets' ⋯ glyph on the same right edge: its 24px box pulled 4px out", () => {
    const optionsMenu = client.slice(client.indexOf('const presetOptionsMenu = ('), client.indexOf('const filterMenu = ('))
    expect(optionsMenu).toMatch(/size="icon-xs"[^>]*?className="[^"]*dshx:-mr-1[^"]*"/su)
  })
})

// Council round 27, item 12: every control has a 44 × 44 hit area on a coarse pointer, and none takes a tap meant for its
// neighbour. Measured on iPhone WebKit: chips and segments already held 44 × 44; the 24px buttons in a heading row (the
// presets' ⋯, Status' Clear) lost 8px of theirs to the row under them. Their rows are 44px on a coarse pointer.
describe('hit areas (round 28, item 12)', () => {
  it("gives a heading row that holds a 24px button a 44px row on a coarse pointer, so its hit area stays in the row", () => {
    render(<ListFilterPanel {...panel({ status: { selected: ['working'], onChange: vi.fn() } })} />)
    const presetsHeading = screen.getByRole('heading', { name: 'threadSidebarPresets' }).parentElement
    expect(presetsHeading?.className).toContain('dshx:pointer-coarse:h-11')
    // The desktop row keeps its tight -4px margins; a coarse pointer drops them.
    expect(presetsHeading?.className).toContain('dshx:pointer-coarse:my-0')
    const statusHeading = screen.getByRole('button', { name: 'threadSidebarFilterClear' }).closest('[data-thread-status-heading]')
    expect(statusHeading?.className).toContain('dshx:pointer-coarse:h-11')
  })
})

// Council round 28, item 2: a preset's number and mark say one thing to eyes and ears.
describe('preset tallies (round 29, item 2)', () => {
  const counting = (key: string, params?: Record<string, unknown>): string =>
    ({
      threadSidebarPresetThreads_one: '1 thread',
      threadSidebarPresetThreads_other: `${String(params?.['count'])} threads`,
      threadSidebarPresetNeedsYou_one: `${String(params?.['count'])} needs you`,
      threadSidebarPresetNeedsYou_other: `${String(params?.['count'])} need you`,
      threadSidebarPresetFailedCount_one: `${String(params?.['count'])} failed`,
      threadSidebarPresetFailedCount_other: `${String(params?.['count'])} failed`,
    })[key] ?? key

  it('counts the rows a preset shows, in secondary ink, and names it from what is drawn', () => {
    const base = panel()
    const presets = base.presets
    if (presets === undefined) throw new Error('The fixture has presets.')
    render(
      <ListFilterPanel
        {...base}
        t={counting as ListFilterPanelProps['t']}
        presets={{
          ...presets,
          items: [
            { id: 'working', label: 'Working', count: 2, needsYou: 0, failed: 0 },
            { id: 'done', label: 'Done', count: 3, needsYou: 1, failed: 2 },
            { id: 'empty', label: 'Empty', count: 0, needsYou: 0, failed: 0 },
          ],
        }}
      />,
    )
    const working = screen.getByRole('radio', { name: 'Working, 2 threads' })
    expect(working.querySelector('[data-preset-count]')?.textContent).toBe('2')
    expect(working.querySelector('[data-preset-count]')?.className).toContain('dshx:text-muted-foreground')
    expect(working.querySelector('[data-slot="status-glyph"]')).toBeNull()
    const done = screen.getByRole('radio', { name: 'Done, 3 threads, 1 needs you, 2 failed' })
    // The diamond before the cross, both only because a row in the preset needs you or failed.
    expect(Array.from(done.querySelectorAll('[data-slot="status-glyph"]')).map(glyph => glyph.getAttribute('data-status'))).toEqual(['needs-you', 'failed'])
    const empty = screen.getByRole('radio', { name: 'Empty' })
    expect(empty.querySelector('[data-preset-count]')).toBeNull()
    expect(empty.querySelector('[data-slot="status-glyph"]')).toBeNull()
  })

  it('reads a row as needing you or failed from its status, else from its attention label; never from an unread finish', () => {
    expect(presetAttentionOf('needs-you', undefined)).toBe('needs-you')
    expect(presetAttentionOf('failed', undefined)).toBe('failed')
    expect(presetAttentionOf('ready', 'threadSidebarTurnFinished')).toBeUndefined()
    expect(presetAttentionOf(undefined, 'threadSidebarApprovalNeeded')).toBe('needs-you')
    expect(presetAttentionOf(undefined, 'threadSidebarInterrupted')).toBe('failed')
    expect(presetAttentionOf(undefined, 'threadSidebarTurnFinished')).toBeUndefined()
  })
})

// Council round 28, item 3: "More statuses" is a disclosure above what it reveals.
describe('the More statuses disclosure, placed (round 29, item 3)', () => {
  it('sits directly under the leading chip row, open or folded, and reads Fewer statuses when open', () => {
    render(<ListFilterPanel {...panel()} />)
    const leading = screen.getByRole('group', { name: 'threadSidebarFilterGroupActivity' })
    const more = screen.getByRole('button', { name: 'threadSidebarFilterMoreStatuses' })
    const follows = (): boolean => (leading.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(follows()).toBe(true)
    fireEvent.click(more)
    expect(more.textContent).toBe('threadSidebarFilterFewerStatuses')
    expect(more.getAttribute('aria-expanded')).toBe('true')
    // The revealed groups come after it, so it stays above what it reveals.
    const revealed = screen.getByRole('group', { name: 'threadSidebarFilterGroupStorage' })
    expect(more.compareDocumentPosition(revealed) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(follows()).toBe(true)
  })

  it('makes the first revealed chip the next Tab stop: the revealed chips are their own roving group', () => {
    render(<ListFilterPanel {...panel()} />)
    fireEvent.click(screen.getByRole('button', { name: 'threadSidebarFilterMoreStatuses' }))
    const region = document.getElementById(screen.getByRole('button', { name: 'threadSidebarFilterFewerStatuses' }).getAttribute('aria-controls') ?? '')
    // A roving group of its own (Radix focuses its first chip when Tab reaches the group), right after the disclosure.
    expect(element(region).getAttribute('tabindex')).toBe('0')
    expect(element(region).querySelector('button')?.textContent).toBe('threadSidebarApprovalNeeded')
    expect(region?.contains(screen.getByRole('button', { name: 'threadSidebarWorking' }))).toBe(false)
  })

  it('stays open while a revealed status is on with aria-disabled and a description, never disabled', () => {
    render(<ListFilterPanel {...panel({ status: { selected: ['archived'], onChange: vi.fn() } })} />)
    const more = screen.getByRole('button', { name: 'threadSidebarFilterFewerStatuses' })
    expect(more.hasAttribute('disabled')).toBe(false)
    expect(more.getAttribute('aria-disabled')).toBe('true')
    expect(document.getElementById(more.getAttribute('aria-describedby') ?? '')?.textContent).toBe('threadSidebarFilterFoldHint')
    fireEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('true')
  })
})

// Council round 28, item 4: the bare check means "on" only; Done at rest draws the row menu's circle-check.
describe('the Done chip at rest (round 29, item 4)', () => {
  it("draws the circle-check in the secondary ink at rest, and the bare check only while it is on", () => {
    const { unmount } = render(<ListFilterPanel {...panel()} />)
    fireEvent.click(screen.getByRole('button', { name: 'threadSidebarFilterMoreStatuses' }))
    const seat = screen.getByRole('button', { name: 'threadSidebarSettled' }).querySelector('[data-chip-seat]')
    const mark = seat?.querySelector('[data-chip-mark]')
    expect(mark?.getAttribute('data-chip-mark')).toBe('done')
    expect(mark?.getAttribute('class')).toContain('lucide-circle-check')
    expect(mark?.getAttribute('class')).toContain('dshx:size-3')
    expect(mark?.getAttribute('class')).toContain('dshx:text-muted-foreground')
    expect(seat?.querySelector('[data-chip-check]')).toBeNull()
    unmount()
    render(<ListFilterPanel {...panel({ status: { selected: ['settled'], onChange: vi.fn() } })} />)
    const on = screen.getByRole('button', { name: 'threadSidebarSettled' }).querySelector('[data-chip-seat]')
    expect(on?.querySelector('[data-chip-check]')).not.toBeNull()
    expect(on?.querySelector('[data-chip-mark]')).toBeNull()
  })
})
