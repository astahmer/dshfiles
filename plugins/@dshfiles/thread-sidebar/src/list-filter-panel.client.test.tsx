// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { act, cleanup, fireEvent, render as renderUi, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import { PaletteMath, WARM_STONE, type Oklch } from '@dshfiles/plugin-ui/theme/palette'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { filterPanelInitialFocus, ListFilterPanel, nextStatusFilters, type ListFilterPanelProps } from './list-filter-panel.js'

afterEach(cleanup)

/** The panel's icon buttons carry kit tooltips, which need the provider the sidebar mounts. */
const render = (ui: ReactElement): ReturnType<typeof renderUi> => renderUi(ui, { wrapper: TooltipProvider })

/** The element a query found, or a failure that names what was missing. */
const element = (found: Element | null | undefined): HTMLElement => {
  if (!(found instanceof HTMLElement)) throw new Error('The element the test reads is not on the page.')
  return found
}

// A path, not a URL: under jsdom `URL` is the window's, which Node's fs does not take.
const client = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'client.tsx'), 'utf8')
const locales = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'locales.ts'), 'utf8')
/** The panel's own source. */
const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'list-filter-panel.tsx'), 'utf8')
/** The English table is the first one in the file. */
const english = locales.slice(0, locales.indexOf('const zh'))
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
      { id: 'all', label: 'All threads', count: null },
      { id: 'working', label: 'Working', count: 2 },
      { id: 'done', label: 'Done', count: 3 },
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
    expect(within(presets).getByRole('radio', { name: 'Done, threadSidebarPresetThreads_other' }).getAttribute('aria-checked')).toBe('false')
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

  it('offers save for an edited preset', () => {
    const props = panel()
    const presets = props.presets
    if (presets === undefined) throw new Error('The fixture has presets.')
    render(<ListFilterPanel {...props} presets={{ ...presets, activeId: 'working', edited: true }} />)
    fireEvent.click(screen.getByRole('button', { name: /threadSidebarPresetSaveChanges/u }))
    expect(presets.onSaveChanges).toHaveBeenCalledOnce()
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
  it('names its row ", edited" and marks it current', () => {
    const base = panel()
    const presets = base.presets
    if (presets === undefined) throw new Error('The fixture has presets.')
    render(<ListFilterPanel {...base} presets={{ ...presets, activeId: 'working', edited: true }} />)
    const row = screen.getByRole('radio', { name: 'Working, threadSidebarPresetThreads_other, threadSidebarPresetEditedShort' })
    expect(row.getAttribute('aria-current')).toBe('true')
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
    const status = screen.getByRole('region', { name: 'threadSidebarFilterStatus' })
    const groups = within(status).getAllByRole('group')
    expect(groups.map(group => group.getAttribute('aria-label') ?? document.getElementById(group.getAttribute('aria-labelledby') ?? '')?.textContent)).toEqual([
      'threadSidebarFilterGroupActivity',
      'threadSidebarFilterGroupAttention',
      'threadSidebarFilterGroupStorage',
    ])
    // No label is hidden from assistive tech, and the stored Done chip sits in the Storage group.
    // A chip's seat is decoration beside its label; nothing else in the status group is hidden.
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
  it('draws a selected chip as the segment thumb with the segment edge and the 550 ink; a resting one in secondary ink', () => {
    render(<ListFilterPanel {...panel({ status: { selected: ['working'], onChange: vi.fn() } })} />)
    const on = screen.getByRole('button', { name: 'threadSidebarWorking', pressed: true })
    const off = screen.getByRole('button', { name: 'threadSidebarUnread', pressed: false })
    for (const token of ['dshx:data-[state=on]:bg-(--dshx-segment-thumb)', 'dshx:data-[state=on]:border-(--dshx-segment-edge)', 'dshx:data-[state=on]:font-selected', 'dshx:data-[state=on]:text-foreground'])
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
    expect(mark('threadSidebarFilterInterrupted')).toBe('failed')
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
    expect(source.className).toContain('dshx:bg-segment-track')
    const all = within(source).getByRole('radio', { name: 'All sources' })
    expect(all.className).toContain('dshx:data-[state=on]:bg-(--dshx-segment-thumb)')
    expect(all.querySelector('[data-slot="segment-label"]')?.getAttribute('data-label')).toBe('All')
  })

  it('puts Group by in its own Display section under a hairline, Manual standing for Arrange manually', () => {
    render(<ListFilterPanel {...panel()} />)
    const display = screen.getByRole('region', { name: 'threadSidebarGroupBy' })
    const group = within(display).getByRole('radiogroup', { name: 'threadSidebarGroupBy' })
    expect(group.hasAttribute('data-segmented')).toBe(true)
    const manual = within(group).getByRole('radio', { name: 'Arrange manually' })
    expect(manual.textContent).toBe('Manual')
    // Its own top-level block, so the panel's hairline divides it from the filters; the filters hold no grouping.
    expect(display.parentElement?.hasAttribute('data-thread-list-filter-panel')).toBe(true)
    expect(screen.getByRole('region', { name: 'threadSidebarFilterStatus' }).closest('section')?.contains(group)).toBe(false)
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
    expect(optionsMenu).toContain("props.tSidebar('threadSidebarPresetSaveAsNew')")
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
    // Save and Discard are icon buttons in the edited row since round 29 (item 6).
    const quiet = [
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
  const counting = (key: string, params?: { readonly count?: number }): string =>
    ({
      threadSidebarPresetThreads_one: '1 thread',
      threadSidebarPresetThreads_other: `${String(params?.['count'])} threads`,
    })[key] ?? key

  it('counts the rows a preset shows, in secondary ink, and names it from what is drawn', () => {
    const base = panel()
    const presets = base.presets
    if (presets === undefined) throw new Error('The fixture has presets.')
    render(
      <ListFilterPanel
        {...base}
        // SAFETY: the panel only calls `t` with its own keys and a `{ count }` param, which `counting` answers.
        t={counting as ListFilterPanelProps['t']}
        presets={{
          ...presets,
          items: [
            { id: 'working', label: 'Working', count: 2 },
            { id: 'done', label: 'Done', count: 3 },
            { id: 'empty', label: 'Empty', count: 0 },
          ],
        }}
      />,
    )
    const working = screen.getByRole('radio', { name: 'Working, 2 threads' })
    expect(working.querySelector('[data-preset-count]')?.textContent).toBe('2')
    expect(working.querySelector('[data-preset-count]')?.className).toContain('dshx:text-muted-foreground')
    expect(working.querySelector('[data-slot="status-glyph"]')).toBeNull()
    expect(screen.getByRole('radio', { name: 'Done, 3 threads' }).querySelector('[data-slot="status-glyph"]')).toBeNull()
    const empty = screen.getByRole('radio', { name: 'Empty' })
    expect(empty.querySelector('[data-preset-count]')?.textContent).toBe('')
    expect(empty.querySelector('[data-slot="status-glyph"]')).toBeNull()
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

// Council round 28, item 5: an edited preset keeps its identity.
describe('an edited preset keeps its identity (round 29, item 5)', () => {
  const edited = () => {
    const base = panel()
    const presets = base.presets
    if (presets === undefined) throw new Error('The fixture has presets.')
    const onApply = vi.fn()
    const props: ListFilterPanelProps = { ...base, presets: { ...presets, activeId: 'working', edited: true, onApply } }
    return { props, onApply }
  }

  it('stays checked, with its check and the tag inline after the label', () => {
    render(<ListFilterPanel {...edited().props} />)
    const row = screen.getByRole('radio', { name: 'Working, threadSidebarPresetThreads_other, threadSidebarPresetEditedShort' })
    expect(row.getAttribute('aria-checked')).toBe('true')
    expect(row.getAttribute('data-state')).toBe('on')
    const seat = row.querySelector('[data-preset-seat]')
    expect(seat?.querySelector('svg')).not.toBeNull()
    const label = row.querySelector('[data-preset-label]')
    expect(label?.textContent).toBe('Working · threadSidebarPresetEditedShort')
    const tag = label?.querySelector('[data-preset-edited-tag]')
    expect(tag?.className).toContain('dshx:text-xs')
    expect(tag?.className).toContain('dshx:text-muted-foreground')
  })

  it('does nothing when the current preset is pressed again: Discard is the way to drop edits', () => {
    const { props, onApply } = edited()
    render(<ListFilterPanel {...props} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Working, threadSidebarPresetThreads_other, threadSidebarPresetEditedShort' }))
    expect(onApply).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('radio', { name: 'All threads' }))
    expect(onApply).toHaveBeenCalledWith('all')
  })
})

// Council round 28, item 6: editing never moves the chips under the pointer: Save and Discard live in the preset's row.
describe('Save and Discard in the edited row (round 29, item 6)', () => {
  it('puts them in the active row as two icon buttons with names, adding nothing below the presets', () => {
    const base = panel()
    const presets = base.presets
    if (presets === undefined) throw new Error('The fixture has presets.')
    const { container, rerender } = render(<ListFilterPanel {...base} />)
    // Laid over the edited row (absolutely, outside the radiogroup since round 30), so no row is added or moved.
    const group = (): HTMLElement => screen.getByRole('radiogroup', { name: 'threadSidebarPresets' })
    const rowsBefore = group().children.length
    rerender(<ListFilterPanel {...base} presets={{ ...presets, activeId: 'working', edited: true }} />)
    expect(group().children.length).toBe(rowsBefore)
    expect(element(container.querySelector('[data-preset-actions]')).className).toContain('dshx:absolute')
    const save = screen.getByRole('button', { name: 'threadSidebarPresetSaveChanges' })
    const discard = screen.getByRole('button', { name: 'threadSidebarPresetDiscardChanges' })
    for (const button of [save, discard]) {
      expect(button.className).toContain('dshx:size-6')
      expect(button.className).toContain('dshx:pointer-coarse:h-11')
    }
    fireEvent.click(discard)
    expect(presets.onDiscard).toHaveBeenCalledOnce()
    // The other rows carry no buttons.
    expect(within(element(screen.getByRole('radio', { name: 'All threads' }).closest('[data-preset-row]'))).queryAllByRole('button')).toHaveLength(0)
  })
})

// Council round 28, item 7: the header (Filters · Reset) stays in view: the panel itself is the scroll container.
describe('the panel scrolls under its header (round 29, item 7)', () => {
  it('scrolls the panel, not the popover, so the sticky header is pinned to the scroller it lives in', () => {
    const { container } = render(<ListFilterPanel {...panel()} />)
    const root = element(container.querySelector('[data-thread-list-filter-panel]'))
    for (const token of ['dshx:min-h-0', 'dshx:overflow-y-auto', 'dshx:overscroll-contain']) expect(root.className).toContain(token)
    const header = element(root.querySelector('[data-thread-filter-header]'))
    expect(header.parentElement).toBe(root)
    expect(header.className).toContain('dshx:top-0')
    // The phone sheet's grabber padding now sits outside the scroller, so the header needs no offset there.
    expect(header.className).not.toContain('dshx:phone:-top-5')
    expect(filterControl).toMatch(/className="dshx-root dshx:flex [^"]*dshx:w-80 dshx:max-w-\[calc\(100vw-1rem\)\] dshx:flex-col dshx:overflow-hidden dshx:p-0/u)
  })
})

// Council round 28, item 8: the closed desktop trigger says a filter is on with the phone's count badge, no lone dot.
describe('the closed trigger (round 29, item 8)', () => {
  it('draws the filters-on count badge on a desktop and a phone alike, and no edited dot or status mark', () => {
    const trigger = filterControl.slice(filterControl.indexOf('<PopoverTrigger asChild>'), filterControl.indexOf('</PopoverTrigger>'))
    // A desktop's count sits in the funnel slot since round 32 (item 1), a phone's after "Filters".
    expect(trigger).toContain('{scopeSlot === null && scopeCount !== null ? (')
    expect(trigger).toContain('data-testid="thread-scope-count"')
    expect(trigger).not.toContain('thread-preset-edited-dot')
    expect(trigger).not.toContain('thread-view-attention-dot')
  })
})

// Council round 28, item 9: selecting a chip never shifts its neighbours: its label reserves its 550 width.
describe('chip widths (round 29, item 9)', () => {
  it('wraps every status chip label in a segment label that reserves the selected weight', () => {
    render(<ListFilterPanel {...panel()} />)
    fireEvent.click(screen.getByRole('button', { name: 'threadSidebarFilterMoreStatuses' }))
    const chips = within(screen.getByRole('region', { name: 'threadSidebarFilterStatus' }))
      .getAllByRole('button')
      .filter(chip => !chip.hasAttribute('data-thread-status-more'))
    expect(chips.length).toBeGreaterThan(10)
    for (const chip of chips) {
      const label = chip.querySelector('[data-slot="segment-label"]')
      expect(label?.className).toContain('dshx:segment-label')
      expect(label?.getAttribute('data-label')).toBe(label?.textContent)
    }
  })
})

// Council round 28, item 11: one heading, "Group by", under the hairline; Reset says what it covers in its description.
describe('one Group by label (round 29, item 11)', () => {
  it('heads the grouping section "Group by" alone, and names Reset\'s scope in its description', () => {
    render(<ListFilterPanel {...panel()} />)
    const section = screen.getByRole('region', { name: 'threadSidebarGroupBy' })
    expect(within(section).getAllByRole('heading').map(heading => heading.textContent)).toEqual(['threadSidebarGroupBy'])
    expect(screen.queryByText('threadSidebarFilterDisplay')).toBeNull()
    expect(within(section).getByRole('radiogroup', { name: 'threadSidebarGroupBy' })).toBeTruthy()
    const reset = screen.getByRole('button', { name: 'threadSidebarFilterResetLabel' })
    expect(document.getElementById(reset.getAttribute('aria-describedby') ?? '')?.textContent).toBe('threadSidebarFilterResetScope')
  })
})

// Council round 28, item 12: the preset ⋯ menu: its name as a quiet kit label, one text edge, one verb name.
describe('the preset menu (round 29, item 12)', () => {
  const optionsMenu = client.slice(client.indexOf('const presetOptionsMenu = ('), client.indexOf('const filterMenu = ('))
  it('labels the menu with the preset name in 12px secondary, puts every verb on one text edge and names Save one way', () => {
    expect(optionsMenu).toContain('<DropdownMenuLabel className="dshx:truncate dshx:text-xs dshx:font-normal dshx:text-muted-foreground">')
    // No verb carries an icon, so every label starts on one edge.
    expect(optionsMenu).not.toMatch(/Icon aria-hidden/u)
    expect(optionsMenu).not.toContain("'threadSidebarPresetUpdate'")
    expect(optionsMenu).toContain("props.tSidebar('threadSidebarPresetSaveChanges', { name: activeViewTab?.label ?? '' })")
  })
})

// Council round 28, item 13: the built-in All threads cannot be overwritten.
describe('the built-in All threads (round 29, item 13)', () => {
  it('offers Save as new preset… and Discard when edited, never Save changes', () => {
    const base = panel()
    const presets = base.presets
    if (presets === undefined) throw new Error('The fixture has presets.')
    const onSaveAs = vi.fn()
    render(<ListFilterPanel {...base} presets={{ ...presets, activeId: 'all', edited: true, builtInId: 'all', onSaveAs }} />)
    expect(screen.queryByRole('button', { name: 'threadSidebarPresetSaveChanges' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'threadSidebarPresetSaveAsNew' }))
    expect(onSaveAs).toHaveBeenCalledOnce()
    expect(presets.onSaveChanges).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'threadSidebarPresetDiscardChanges' })).toBeTruthy()
  })

  it('knows All threads as the built-in preset', () => {
    expect(client).toContain('const activeIsBuiltIn = listThreadView.id === ALL_THREADS_VIEW_ID')
  })
})

// Council round 28, item 14: one selected look across chips and segments.
describe('one selected look (round 29, item 14)', () => {
  it('draws the segmented track with the kit track token and a chip\'s on state as the segment thumb with its edge', () => {
    render(<ListFilterPanel {...panel({ status: { selected: ['working'], onChange: vi.fn() } })} />)
    const track = screen.getByRole('radiogroup', { name: 'threadSidebarFilterSource' })
    expect(track.className).toContain('dshx:bg-segment-track')
    expect(track.className).not.toContain('dshx:dark:bg-trigger-fill')
    const chip = screen.getByRole('button', { name: 'threadSidebarWorking', pressed: true })
    expect(chip.className).toContain('dshx:data-[state=on]:border-(--dshx-segment-edge)')
    // The segment thumb carries no shadow (DESIGN.md › One selected segment), so a selected chip carries none either:
    // the same thumb, the same edge (and the design-token check allows no default shadow here).
    expect(chip.className).not.toMatch(/shadow-(?:xs|sm)\b/u)
    expect(chip.className).not.toContain('dshx:data-[state=on]:border-field-border')
  })
})

// Council round 28, item 15: the subgroup holding Idle and Turn finished is "Thread state", not "Waiting on you"; its
// label and Storage's are 11px tertiary, 8px over their chips.
describe('status subgroup labels (round 29, item 15)', () => {
  it('names the second subgroup Thread state and sets both labels at 11px tertiary with 8px above', () => {
    expect(english).toContain("threadSidebarFilterGroupAttention: 'Thread state',")
    render(<ListFilterPanel {...panel()} />)
    fireEvent.click(screen.getByRole('button', { name: 'threadSidebarFilterMoreStatuses' }))
    for (const name of ['threadSidebarFilterGroupAttention', 'threadSidebarFilterGroupStorage']) {
      const group = screen.getByRole('group', { name })
      const label = element(document.getElementById(group.getAttribute('aria-labelledby') ?? ''))
      for (const token of ['dshx:text-2xs', 'dshx:text-(--dsw-alias-label-tertiary)', 'dshx:pt-2']) expect(label.className).toContain(token)
    }
  })

  it.each(['light', 'dark'] as const)('keeps the tertiary label at AA on the popover and the phone sheet (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const tertiary = p.neutral[8]
    const popover = p.neutral[scheme === 'light' ? 0 : 2]
    if (tertiary === undefined || popover === undefined) throw new Error('The palette has no tertiary or popover step.')
    expect(PaletteMath.contrastRatio(tertiary, popover)).toBeGreaterThanOrEqual(4.5)
  })
})

// Council round 28, item 16: the footer's places read in the secondary ink, ink on hover, below the filters.
describe('footer rows (round 29, item 16)', () => {
  it('draws Board and the settings rows in the secondary ink, the ink on hover', () => {
    render(<ListFilterPanel {...panel()} />)
    const row = screen.getByRole('button', { name: 'Thread list settings' })
    expect(row.className).toContain('dshx:text-muted-foreground')
    expect(row.className).toContain('dshx:hover:text-foreground')
  })
})

// Council round 28, item 17: the chip says "Interrupted"; the visible "Subagents" is the segment's name (label in name).
describe('chip and segment names (round 29, item 17)', () => {
  it('labels the interrupted filter Interrupted, keeping the row label as it was', () => {
    expect(english).toContain("threadSidebarFilterInterrupted: 'Interrupted',")
    const manager = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'thread-view-manager.tsx'), 'utf8')
    expect(manager).toContain("interrupted: 'threadSidebarFilterInterrupted',")
  })

  it('names the Subagents segment by its visible label', () => {
    expect(filterControl).toContain("subagents: { short: props.tSidebar('threadSidebarFilterSubagentsShort'), name: props.tSidebar('threadSidebarFilterSubagentsShort') }")
  })
})

// Council round 28, item 18: the buttons that vanish after they act hand focus on, never to the page.
describe('focus after Clear, Save and Discard (round 29, item 18)', () => {
  it('moves focus to the first status chip after Clear', () => {
    render(<ListFilterPanel {...panel({ status: { selected: ['working'], onChange: vi.fn() } })} />)
    const clear = screen.getByRole('button', { name: 'threadSidebarFilterClear' })
    clear.focus()
    fireEvent.click(clear)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'threadSidebarWorking' }))
  })

  it.each(['threadSidebarPresetSaveChanges', 'threadSidebarPresetDiscardChanges'])('moves focus to the active preset after %s', name => {
    const base = panel()
    const presets = base.presets
    if (presets === undefined) throw new Error('The fixture has presets.')
    render(<ListFilterPanel {...base} presets={{ ...presets, activeId: 'working', edited: true }} />)
    const button = screen.getByRole('button', { name })
    button.focus()
    fireEvent.click(button)
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: /^Working, /u }))
  })
})

// Found on the scratch (round 29, item 2): the Working preset read 4 while the list's Working group, once applied,
// showed 2; the tally counted subagent rows the list leaves out under Source: All. A preset counts the rows it shows.
describe('a preset counts the rows the list shows (round 29, item 2)', () => {
  /** One memo's source: from its declaration to the next declaration in the component. */
  const memo = (name: string): string => {
    const start = client.indexOf(`const ${name} = useMemo(`)
    return client.slice(start, client.indexOf('\n  const ', start + 1))
  }
  it('takes its rows and status match from the same helpers as the list', () => {
    expect(client).toContain('const threadEntriesForSource = ')
    expect(client).toContain('const matchesListStatus = ')
    expect(memo('sourceFilteredThreadEntries')).toContain('threadEntriesForSource(threadView.sourceFilter)')
    expect(memo('visibleThreadEntries')).toContain('matchesListStatus(entry, listView)')
    const tallies = memo('presetTallies')
    expect(tallies).toContain('threadEntriesForSource(view.sourceFilter)')
    expect(tallies).toContain('matchesListStatus(entry, view)')
    expect(tallies).not.toContain('matchesAttentionView')
  })
})

// Council round 29, item 1: the edited dot on the check read as one odd glyph; "· edited" and Save/Discard say it.
describe('no edited dot (round 30, item 1)', () => {
  it('draws only the check in an edited preset seat', () => {
    const base = panel()
    const presets = base.presets
    if (presets === undefined) throw new Error('The fixture has presets.')
    const { container } = render(<ListFilterPanel {...base} presets={{ ...presets, activeId: 'working', edited: true }} />)
    expect(container.querySelector('[data-preset-edited-dot]')).toBeNull()
    const seat = element(container.querySelector('[data-preset-active] [data-preset-seat]'))
    expect(seat.children).toHaveLength(1)
  })
})

// Council round 29, item 2: the built-in preset's menu has no dead rows, says why in one line, and names its one save
// verb as the row button does.
describe('the built-in preset menu (round 30, item 2)', () => {
  const optionsMenu = client.slice(client.indexOf('const presetOptionsMenu = ('), client.indexOf('const filterMenu = ('))
  it('hides Rename, Save changes and Delete for All threads and shows the built-in line under its label', () => {
    expect(optionsMenu).not.toMatch(/disabled=\{[^}]*activeIsBuiltIn/u)
    expect(optionsMenu).toContain("props.tSidebar('threadSidebarPresetBuiltInHint')")
  })

  it('calls its save verb Save as new preset… in the menu and on the row alike', () => {
    expect(optionsMenu).toContain("props.tSidebar('threadSidebarPresetSaveAsNew')")
    expect(client).not.toContain("'threadSidebarPresetSaveAs')")
    expect(english).not.toContain('Save current filters as preset')
  })
})

// Council round 29, item 3: the forced-open disclosure says why on screen, and never folds under the pointer.
describe('the forced-open disclosure (round 30, item 3)', () => {
  it('shows the fold hint on screen, which the button is described by', () => {
    render(<ListFilterPanel {...panel({ status: { selected: ['archived'], onChange: vi.fn() } })} />)
    const more = screen.getByRole('button', { name: 'threadSidebarFilterFewerStatuses' })
    const hint = element(document.getElementById(more.getAttribute('aria-describedby') ?? ''))
    expect(hint.textContent).toBe('threadSidebarFilterFoldHint')
    expect(hint.className).not.toContain('sr-only')
    // On screen; its style is round 31's group-label line (item 5).
    expect(hint.getClientRects).toBeDefined()
  })

  it('stays open after the last revealed status is turned off, so nothing folds under the pointer', () => {
    const base = panel({ status: { selected: ['archived'], onChange: vi.fn() } })
    const { rerender } = render(<ListFilterPanel {...base} />)
    const chip = screen.getByRole('button', { name: 'threadSidebarArchived' })
    chip.focus()
    rerender(<ListFilterPanel {...base} status={{ selected: [], onChange: vi.fn() }} />)
    const more = screen.getByRole('button', { name: 'threadSidebarFilterFewerStatuses' })
    expect(more.getAttribute('aria-expanded')).toBe('true')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'threadSidebarArchived' }))
    // Now nothing holds it open: it folds on request, and the caption is gone.
    expect(more.hasAttribute('aria-disabled')).toBe(false)
    fireEvent.click(more)
    expect(more.getAttribute('aria-expanded')).toBe('false')
  })
})

// Council round 29, item 7 (lead's choice): every preset held a thread that needs you, so every row drew the diamond and
// said nothing new; the list header already shows the marks. Preset rows keep their count, and no mark.
describe('preset rows draw no mark (round 30, item 7)', () => {
  it('draws no diamond or cross on any preset row, and names a row by its label and count only', () => {
    const base = panel()
    const presets = base.presets
    if (presets === undefined) throw new Error('The fixture has presets.')
    const rows = [{ ...presets.items[2], id: 'done', label: 'Done', count: 3, needsYou: 1, failed: 2 }]
    // SAFETY: the extra fields are what the round-29 row type carried; the round-30 type ignores them.
    render(<ListFilterPanel {...base} presets={{ ...presets, items: rows as unknown as typeof presets.items }} />)
    const done = screen.getByRole('radio', { name: 'Done, threadSidebarPresetThreads_other' })
    expect(done.querySelector('[data-slot="status-glyph"]')).toBeNull()
    expect(done.querySelector('[data-preset-count]')?.textContent).toBe('3')
    expect(english).not.toContain('threadSidebarPresetNeedsYou_one')
  })
})

// Council round 29, item 6: fixed end columns. Every preset row ends on one 20px right-aligned tabular count column,
// edited or not, empty at zero; Save and Discard sit after the "edited" tag and before that column; an edited preset
// counts what the list draws.
describe('preset end columns (round 30, item 6)', () => {
  const COLUMN = ['dshx:w-5', 'dshx:shrink-0', 'dshx:text-right', 'dshx:tabular-nums']
  it('ends every row on the same count column, empty at zero, the edited row included', () => {
    const base = panel()
    const presets = base.presets
    if (presets === undefined) throw new Error('The fixture has presets.')
    render(
      <ListFilterPanel
        {...base}
        presets={{ ...presets, activeId: 'working', edited: true, items: [...presets.items, { id: 'empty', label: 'Empty', count: 0 }] }}
      />,
    )
    const rows = within(screen.getByRole('radiogroup', { name: 'threadSidebarPresets' })).getAllByRole('radio')
    for (const row of rows) {
      const count = element(row.querySelector('[data-preset-count]'))
      for (const token of COLUMN) expect(count.className, row.getAttribute('aria-label') ?? '').toContain(token)
      // The count ends line 1; an edited row's coarse-pointer second line follows it (round 31, item 1).
      expect(Array.from(row.children).filter(child => !child.className.includes('dshx:pointer-coarse:basis-full')).at(-1)).toBe(count)
    }
    expect(screen.getByRole('radio', { name: 'Empty' }).querySelector('[data-preset-count]')?.textContent).toBe('')
  })

  it('puts Save and Discard before the count column, never over it', () => {
    const base = panel()
    const presets = base.presets
    if (presets === undefined) throw new Error('The fixture has presets.')
    const { container } = render(<ListFilterPanel {...base} presets={{ ...presets, activeId: 'working', edited: true }} />)
    // The row's 6px padding, the 20px column and an 8px gap: the buttons end 34px from the row's end.
    // Laid over the row's own seat before the count since round 31 (item 1), outside the radiogroup.
    expect(element(container.querySelector('[data-preset-actions]')).className).toContain('dshx:absolute')
    expect(element(container.querySelector('[data-preset-actions-seat]')).nextElementSibling?.hasAttribute('data-preset-count')).toBe(true)
  })

  it('counts an edited preset by what the list draws, in its row and its name', () => {
    expect(filterControl).toContain('view.id === listThreadView.id && presetEdited ? visibleThreadEntries.length')
  })
})

// Council round 29, item 8: on a coarse pointer the edited row's Save and Discard are words, not bare icons.
describe('labelled Save and Discard on a phone (round 30, item 8)', () => {
  const edited = (activeId: string) => {
    const base = panel()
    const presets = base.presets
    if (presets === undefined) throw new Error('The fixture has presets.')
    return <ListFilterPanel {...base} presets={{ ...presets, activeId, edited: true, builtInId: 'all', onSaveAs: vi.fn() }} />
  }
  it('shows Save and Discard as 13px words in a 44pt seat on a coarse pointer, the icon on a mouse', () => {
    render(edited('working'))
    for (const [name, word] of [
      ['threadSidebarPresetSaveChanges', 'threadSidebarPresetSaveShort'],
      ['threadSidebarPresetDiscardChanges', 'threadSidebarPresetDiscardShort'],
    ] as const) {
      const button = screen.getByRole('button', { name })
      for (const token of ['dshx:pointer-coarse:h-11', 'dshx:pointer-coarse:w-auto', 'dshx:pointer-coarse:text-sm']) expect(button.className).toContain(token)
      const text = element(button.querySelector('[data-row-button-text]'))
      expect(text.textContent).toBe(word)
      expect(text.className).toContain('dshx:hidden dshx:pointer-coarse:inline')
      expect(button.querySelector('[data-row-button-icon]')?.className).toContain('dshx:pointer-coarse:hidden')
    }
  })

  it('says Save as new… for the built-in preset', () => {
    render(edited('all'))
    expect(screen.getByRole('button', { name: 'threadSidebarPresetSaveAsNew' }).querySelector('[data-row-button-text]')?.textContent).toBe('threadSidebarPresetSaveAsNew')
  })
})

// Council round 29, item 13: roles that match the keys, Save and Discard outside the radiogroup, and a live region that
// names the change when the count does not move.
describe('roles and announcements (round 30, item 13)', () => {
  it('groups the status chips as a labelled group, not a toolbar of several Tab stops', () => {
    render(<ListFilterPanel {...panel()} />)
    expect(screen.queryByRole('toolbar')).toBeNull()
    // Named by its section since round 31 (item 11), its groups labelled one by one.
    expect(screen.getByRole('region', { name: 'threadSidebarFilterStatus' }).querySelector('[data-thread-status-filters]')).not.toBeNull()
  })

  it('keeps Save and Discard outside the radiogroup', () => {
    const base = panel()
    const presets = base.presets
    if (presets === undefined) throw new Error('The fixture has presets.')
    render(<ListFilterPanel {...base} presets={{ ...presets, activeId: 'working', edited: true }} />)
    const group = screen.getByRole('radiogroup', { name: 'threadSidebarPresets' })
    for (const name of ['threadSidebarPresetSaveChanges', 'threadSidebarPresetDiscardChanges']) expect(group.contains(screen.getByRole('button', { name }))).toBe(false)
    expect(within(group).getAllByRole('radio').length).toBe(3)
  })

  it('names the change in the live region, so a change that leaves the count alone is still heard', () => {
    // Said once the list has answered (round 31, item 6).
    vi.useFakeTimers()
    try {
      const base = panel({ shown: '5 threads shown' })
      render(<ListFilterPanel {...base} />)
      expect(screen.getByRole('status').textContent).toBe('')
      fireEvent.click(screen.getByRole('button', { name: 'threadSidebarUnread' }))
      act(() => vi.advanceTimersByTime(200))
      expect(screen.getByRole('status').textContent).toBe('threadSidebarFilterChangeOn, 5 threads shown')
      fireEvent.click(screen.getByRole('radio', { name: 'Main threads' }))
      act(() => vi.advanceTimersByTime(200))
      expect(screen.getByRole('status').textContent).toBe('Main threads, 5 threads shown')
    } finally {
      vi.useRealTimers()
    }
  })
})

// Council round 29, item 4 (a round-28 regression): the phone sheet scrolled sideways. Measured at 390 px on iPhone
// WebKit: the edited preset row drew 404 px in a 369 px panel (scrollWidth 418), because the panel, the presets section and
// the radiogroup are grids whose one `auto` column grows to the row's min-content (its label never shrinks there); and
// at rest the presets ⋯'s 44 px touch area (a 24 px button 8 px from the edge) reached 2 px past it (scrollWidth 371).
describe('the phone sheet never scrolls sideways (round 30, item 4)', () => {
  it("gives every grid between the panel and the preset row one shrinkable column, and clips the panel's x axis", () => {
    const base = panel()
    const presets = base.presets
    if (presets === undefined) throw new Error('The fixture has presets.')
    const { container } = render(<ListFilterPanel {...base} presets={{ ...presets, activeId: 'working', edited: true }} />)
    const root = element(container.querySelector('[data-thread-list-filter-panel]'))
    expect(root.className).toContain('dshx:overflow-x-clip')
    for (const grid of [root, element(container.querySelector('[data-thread-presets]')), screen.getByRole('radiogroup', { name: 'threadSidebarPresets' })])
      expect(grid.className).toContain('dshx:grid-cols-[minmax(0,1fr)]')
  })

  it("keeps the presets ⋯'s 44 px touch area inside the sheet: it reaches left, not past the edge", () => {
    const trigger = client.slice(client.indexOf('const presetOptionsMenu = ('), client.indexOf('</DropdownMenuTrigger>', client.indexOf('const presetOptionsMenu = (')))
    expect(trigger).toContain('dshx:pointer-coarse:after:right-0 dshx:pointer-coarse:after:-left-5')
  })
})

// Council round 29, item 5: a phone chip keeps its 36pt look and gets a 44pt hit box. Measured on iPhone WebKit
// (elementFromPoint): every status chip already hits 44pt tall, from the kit's coarse-pointer ::after (4pt above and below
// a 36pt chip). This pins the three facts that make it so, and that the 8pt row gap keeps neighbouring hit boxes apart.
describe('phone chip hit areas (round 30, item 5)', () => {
  const kit = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../plugin-ui/src/styles.css'), 'utf8')
  it('draws a 36pt chip that the kit extends to a 44pt hit box on a coarse pointer, rows 8pt apart', () => {
    render(<ListFilterPanel {...panel()} />)
    const chip = screen.getByRole('button', { name: 'threadSidebarWorking' })
    expect(chip.getAttribute('data-slot')).toBe('toggle-group-item')
    expect(chip.className).toContain('dshx:pointer-coarse:h-9')
    expect(element(chip.parentElement).className).toContain('dshx:pointer-coarse:gap-2')
    const coarse = kit.slice(kit.indexOf('@media (pointer: coarse)'))
    const rule = coarse.slice(0, coarse.indexOf('inset: min(0px, calc((100% - 44px) / 2))'))
    expect(rule.slice(rule.lastIndexOf(':where(')).includes("[data-slot='toggle-group-item']") || rule.includes("[data-slot='toggle-group-item']")).toBe(true)
  })
})

// Council round 29, item 9: Source gets its own hairline section, as Group by has.
describe('the Source section (round 30, item 9)', () => {
  it('is its own top-level section of the panel, so the panel hairline divides it from Status', () => {
    const { container } = render(<ListFilterPanel {...panel()} />)
    const root = element(container.querySelector('[data-thread-list-filter-panel]'))
    const source = element(screen.getByRole('radiogroup', { name: 'threadSidebarFilterSource' }).closest('section'))
    expect(source.parentElement).toBe(root)
    expect(source.hasAttribute('data-thread-filter-source')).toBe(true)
    expect(source.contains(screen.getByRole('region', { name: 'threadSidebarFilterStatus' }))).toBe(false)
  })
})

// Council round 29, item 10 (WCAG 2.4.3): the presets ⋯ comes right after the Presets heading in DOM order, before the
// preset radios. It already does; the round-29 keyboard log listed it last only because the panel opens on the checked
// preset and Tab wraps inside the panel. This pins the order: Reset, ⋯, the presets, the chips, More, Source, Group by.
describe('the panel Tab order (round 30, item 10)', () => {
  it('reaches the presets ⋯ right after Reset and before the preset radios', () => {
    const { container } = render(<ListFilterPanel {...panel({ reset: { disabled: false, onReset: vi.fn() } })} />)
    const stops = Array.from(container.querySelectorAll<HTMLElement>('button, [tabindex]')).filter(
      node => node.getAttribute('tabindex') !== '-1' && !node.hasAttribute('disabled') && !node.className.includes('dshx:hidden '),
    )
    const names = stops.map(node => node.getAttribute('aria-label') ?? node.textContent)
    // The radiogroup is the roving group's one Tab stop (Radix hands focus to its checked radio).
    expect(names.slice(0, 3)).toEqual(['threadSidebarFilterResetLabel', 'options', 'threadSidebarPresets'])
    const heading = screen.getByRole('heading', { name: 'threadSidebarPresets' })
    const options = screen.getByRole('button', { name: 'options' })
    expect(heading.compareDocumentPosition(options) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
    expect(options.compareDocumentPosition(screen.getByRole('radiogroup', { name: 'threadSidebarPresets' })) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0)
  })
})

// Council round 29, item 11: the closed trigger's count is a neutral pill, and the trigger's name says it.
describe('the trigger count (round 30, item 11)', () => {
  const trigger = filterControl.slice(filterControl.indexOf('<PopoverTrigger asChild>'), filterControl.indexOf('</PopoverTrigger>'))
  it('draws the count as a 16px neutral pill: the muted fill, the ink, 11px, 5px across', () => {
    // The phone's pill (the desktop count moved into the funnel slot in round 32).
    const badge = trigger.slice(trigger.indexOf('<Badge'))
    // The ink at 20% since round 33 (item 1).
    for (const token of ['dshx:h-4', 'dshx:bg-[color-mix(in_oklab,var(--dsw-alias-label-primary)_20%,transparent)]', 'dshx:text-foreground', 'dshx:text-2xs', 'dshx:px-1.25', 'dshx:rounded-full']) expect(badge.slice(0, 400)).toContain(token)
  })

  it('names the trigger with the count of filters on: "Filter: All threads, 2 filters on"', () => {
    // Built once as the trigger's label since round 33 (item 1), which is also its tooltip.
    expect(client).toContain("${scopeCount === null ? '' : `, ${plural(props.tSidebar, 'threadSidebarFiltersOn', scopeCount)}`}")
    expect(english).toContain("threadSidebarFiltersOn_other: '{count} filters on',")
  })
})

// Found in the round-30 phone capture (item 6): the edited row reserved Save and Discard's width as right padding, after
// the count column, so on a phone the count drew before "Save Discard". The room is a seat before the count instead.
describe("the edited row's count stays at its end (round 30, item 6)", () => {
  it('reserves Save and Discard a seat between the label and the count, never padding after the count', () => {
    const base = panel()
    const presets = base.presets
    if (presets === undefined) throw new Error('The fixture has presets.')
    render(<ListFilterPanel {...base} presets={{ ...presets, activeId: 'working', edited: true }} />)
    const row = screen.getByRole('radio', { name: /^Working, /u })
    expect(row.style.paddingRight).toBe('')
    const seat = element(row.querySelector('[data-preset-actions-seat]'))
    expect(seat.nextElementSibling?.hasAttribute('data-preset-count')).toBe(true)
    expect(seat.previousElementSibling?.hasAttribute('data-preset-label')).toBe(true)
  })
})

// Council round 30, item 1: the phone edited row never truncates "edited" and takes a second line for Discard and Save;
// Save and Discard are placed from the row's own seat and follow it (a ResizeObserver), not from a one-off measure.
describe('the edited row on two lines (round 31, item 1)', () => {
  const edited = (activeId: string, label?: string) => {
    const base = panel()
    const presets = base.presets
    if (presets === undefined) throw new Error('The fixture has presets.')
    const items = label === undefined ? presets.items : presets.items.map(item => (item.id === activeId ? { ...item, label } : item))
    return <ListFilterPanel {...base} presets={{ ...presets, items, activeId, edited: true, builtInId: 'all', onSaveAs: vi.fn() }} />
  }

  it('truncates only the preset name, never the edited tag', () => {
    render(edited('working', 'A very long custom preset name that runs on'))
    const row = screen.getByRole('radio', { name: /^A very long/u })
    const name = element(row.querySelector('[data-preset-name]'))
    const tag = element(row.querySelector('[data-preset-edited-tag]'))
    expect(name.className).toContain('dshx:truncate')
    expect(name.className).toContain('dshx:min-w-0')
    expect(tag.className).toContain('dshx:shrink-0')
    expect(tag.contains(name)).toBe(false)
  })

  it('gives a coarse-pointer edited row a 44pt second line at the label x, and a desktop seat before the count', () => {
    render(edited('working'))
    const row = screen.getByRole('radio', { name: /^Working, /u })
    expect(row.className).toContain('dshx:pointer-coarse:flex-wrap')
    expect(row.className).toContain('dshx:pointer-coarse:h-auto')
    const [desk, line] = Array.from(row.querySelectorAll('[data-preset-actions-seat]'))
    expect(element(desk).className).toContain('dshx:pointer-coarse:hidden')
    expect(element(desk).nextElementSibling?.hasAttribute('data-preset-count')).toBe(true)
    for (const token of ['dshx:hidden', 'dshx:pointer-coarse:block', 'dshx:pointer-coarse:basis-full', 'dshx:pointer-coarse:h-11']) expect(element(line).className).toContain(token)
    expect(element(line).previousElementSibling?.hasAttribute('data-preset-count')).toBe(true)
    // Their words start at the label's x on that line: 24px in (the 16px check and an 8px gap), less the button's 8px.
    expect(element(document.querySelector('[data-preset-actions]')).className).toContain('dshx:pointer-coarse:pl-4')
  })

  it('puts Discard first and spells Save out on a phone: "Save as new preset…" for the built-in, "Save" for a user preset', () => {
    const { unmount } = render(edited('all'))
    const words = () => Array.from(document.querySelectorAll('[data-preset-actions] [data-row-button-text]')).map(node => node.textContent)
    expect(words()).toEqual(['threadSidebarPresetDiscardShort', 'threadSidebarPresetSaveAsNew'])
    unmount()
    render(edited('working'))
    expect(words()).toEqual(['threadSidebarPresetDiscardShort', 'threadSidebarPresetSaveShort'])
  })

  it('follows the seat it lies over with a ResizeObserver, so a rename, a zoom or a rotation never leaves it behind', () => {
    const observed: Element[] = []
    const original = globalThis.ResizeObserver
    globalThis.ResizeObserver = class {
      observe(target: Element): void {
        observed.push(target)
      }
      unobserve(): void {}
      disconnect(): void {}
    }
    try {
      render(edited('working'))
      const seats = Array.from(document.querySelectorAll('[data-preset-actions-seat]'))
      expect(seats.every(seat => observed.includes(seat))).toBe(true)
      expect(observed.includes(element(document.querySelector('[data-thread-presets]')))).toBe(true)
    } finally {
      globalThis.ResizeObserver = original
    }
  })
})

// Council round 30, item 2: "All 2" read as two results. The closed desktop trigger names the preset in full, the count
// pill after it, and its label in the ink while a count shows; the phone keeps "Filters 2".
describe('the closed desktop trigger reads as a state (round 31, item 2)', () => {
  const trigger = filterControl.slice(filterControl.indexOf('<PopoverTrigger asChild>'), filterControl.indexOf('</PopoverTrigger>'))
  it('shows the full preset name, truncating, in the ink while a filter count shows', () => {
    expect(trigger).toContain('{scopeSlot === null ? (presetsOn ? activePresetLabel : activeFilterSummary) : ThreadListScope.label(scopeInput)}')
    expect(client).not.toContain('const activeViewShortLabel')
    // On a phone too since round 33 (item 1).
    expect(trigger).toMatch(/className=\{cn\('dshx:truncate', scopeCount !== null && 'dshx:text-foreground'\)\}/u)
  })
})

// Council round 30, item 4: the preset ⋯ menu stays inside the panel: a fixed 256px width aligned to the ⋯'s end, the
// built-in caption wrapping, no repeated "All threads" label, and Save as new preset… described by the caption.
describe('the preset menu fits the panel (round 31, item 4)', () => {
  const optionsMenu = client.slice(client.indexOf('const presetOptionsMenu = ('), client.indexOf('const filterMenu = ('))
  it('is 256px wide, end-aligned, its caption wrapping', () => {
    expect(optionsMenu).toContain('<DropdownMenuContent align="end" className="dshx-root dshx:w-64"')
    expect(optionsMenu).not.toContain('dshx:min-w-52')
    expect(optionsMenu).toMatch(/data-preset-built-in-hint=""[^>]*>|className="[^"]*dshx:whitespace-normal[^"]*"[^>]*data-preset-built-in-hint/u)
    expect(english).toContain("threadSidebarPresetBuiltInHint: 'Built in. Save changes as a new preset.',")
  })

  it("names the preset in a label only for a user preset, and describes Save as new preset… by the built-in caption", () => {
    expect(optionsMenu).toMatch(/\{activeIsBuiltIn \? null : \(\s*<>\s*<DropdownMenuSeparator \/>\s*<DropdownMenuLabel/u)
    expect(optionsMenu).toContain('aria-describedby={activeIsBuiltIn ? builtInHintId : undefined}')
    expect(optionsMenu).toContain('id={builtInHintId}')
  })
})

// Council round 30, item 5: the forced-open hint is its own line under Fewer statuses, at the label's x (36px), in the
// group-label style, and the control is no fainter than its explanation.
describe('the forced-open hint line (round 31, item 5)', () => {
  it('sits on its own line at the label x in 11px tertiary, and the button keeps its full ink', () => {
    render(<ListFilterPanel {...panel({ status: { selected: ['archived'], onChange: vi.fn() } })} />)
    const more = screen.getByRole('button', { name: 'threadSidebarFilterFewerStatuses' })
    const hint = element(document.getElementById(more.getAttribute('aria-describedby') ?? ''))
    expect(more.nextElementSibling).toBe(hint)
    expect(hint.tagName).toBe('P')
    for (const token of ['dshx:pl-6', 'dshx:text-2xs', 'dshx:text-(--dsw-alias-label-tertiary)']) expect(hint.className).toContain(token)
    expect(more.className).not.toContain('opacity-60')
  })
})

// Council round 30, item 6: an action and the count it leads to are one announcement; the action is cleared once spoken,
// so a later count change alone is said without a verb.
describe('fresh announcements (round 31, item 6)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })
  const status = (): string => screen.getByRole('status').textContent ?? ''

  it('says the action with the count it leads to, once, and then clears it', () => {
    vi.useFakeTimers()
    const base = panel({ shown: '5 threads shown' })
    const { rerender } = render(<ListFilterPanel {...base} />)
    fireEvent.click(screen.getByRole('button', { name: 'threadSidebarUnread' }))
    // The list answers a moment later with its new count; the announcement waits for it.
    rerender(<ListFilterPanel {...base} shown="4 threads shown" />)
    act(() => vi.advanceTimersByTime(200))
    expect(status()).toBe('threadSidebarFilterChangeOn, 4 threads shown')
    act(() => vi.advanceTimersByTime(1200))
    expect(status()).toBe('')
  })

  it('says a count change that no action made without a verb', () => {
    vi.useFakeTimers()
    const base = panel({ shown: '5 threads shown' })
    const { rerender } = render(<ListFilterPanel {...base} />)
    fireEvent.click(screen.getByRole('button', { name: 'threadSidebarUnread' }))
    act(() => vi.advanceTimersByTime(200))
    act(() => vi.advanceTimersByTime(1200))
    rerender(<ListFilterPanel {...base} shown="3 threads shown" />)
    expect(status()).toBe('3 threads shown')
  })
})

// Council round 30, item 7: measured at 1440 × 700, opening More grew the panel past the room below its trigger and
// Radix shifted it from top 88 to top 8. Its height is capped at the room below the trigger, so its top holds and only
// its content scrolls, with a 16px fade at the foot while more content remains.
describe('the desktop panel holds its top (round 31, item 7)', () => {
  it('caps the popover at the room below the trigger as well as the available height', () => {
    expect(filterControl).toContain('dshx:max-h-[min(var(--radix-popover-content-available-height),var(--filter-panel-room,100dvh))]')
    expect(client).toMatch(/'--filter-panel-room': `\$\{String\(filterPanelRoom\)\}px`/u)
    expect(filterControl).toContain('style={filterPanelStyle}')
    // To the status strip since round 33 (item 3), the window's bottom without one.
    expect(client).toContain('floor - trigger.getBoundingClientRect().top - FILTER_PANEL_COLLISION_PADDING')
  })

  it('fades its foot while more content remains below, and drops the fade at the end', () => {
    const { container } = render(<ListFilterPanel {...panel()} />)
    const root = element(container.querySelector('[data-thread-list-filter-panel]'))
    expect(root.className).toContain('dshx:data-[more-below]:[mask-image:linear-gradient(to_bottom,currentcolor_calc(100%-16px),transparent)]')
    Object.defineProperties(root, { scrollHeight: { value: 800, configurable: true }, clientHeight: { value: 600, configurable: true } })
    root.scrollTop = 0
    fireEvent.scroll(root)
    expect(root.hasAttribute('data-more-below')).toBe(true)
    root.scrollTop = 200
    fireEvent.scroll(root)
    expect(root.hasAttribute('data-more-below')).toBe(false)
  })
})

// Council round 30, item 8: on a phone the revealed statuses opened below the fold; they scroll into view.
describe('More statuses reveals into view (round 31, item 8)', () => {
  it('scrolls the revealed region into view, keeping the toggle in view, when More opens it, and not when it folds (round 33, item 2)', () => {
    const calls: { readonly target: Element; readonly options: ScrollIntoViewOptions | boolean | undefined }[] = []
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (this: Element, options?: ScrollIntoViewOptions | boolean) {
      calls.push({ target: this, options })
    }
    try {
      render(<ListFilterPanel {...panel()} />)
      const more = screen.getByRole('button', { name: 'threadSidebarFilterMoreStatuses' })
      fireEvent.click(more)
      const region = document.getElementById(more.getAttribute('aria-controls') ?? '')
      // Nearest since round 33 (item 2; the scroller's scroll padding keeps the fade clear), then the toggle itself, so
      // the control just pressed never scrolls out of view.
      expect(calls).toEqual([
        { target: region, options: { block: 'nearest' } },
        { target: more, options: { block: 'nearest' } },
      ])
      // Its last chip ends at least 24px above the panel's bottom: the scroller's 24px padding and the region's 4px margin.
      expect(region?.className).toContain('dshx:scroll-mb-1')
      fireEvent.click(more)
      expect(calls).toHaveLength(2)
    } finally {
      // jsdom has no scrollIntoView: put the prototype back as it was, not with an own `undefined` property.
      if (original === undefined) Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
      else Element.prototype.scrollIntoView = original
    }
  })
})

// Council round 30, item 9: the kit toggle's hover:bg-muted replaced a resting chip's fill with the dark sheet's own
// step, so a hovered chip lost its shape in dark. A hovered chip keeps its trigger fill; a selected one keeps its thumb.
describe('a hovered chip keeps its fill (round 31, item 9)', () => {
  it('overrides the kit hover fill with the trigger fill, and the selected thumb on hover', () => {
    render(<ListFilterPanel {...panel({ status: { selected: ['working'], onChange: vi.fn() } })} />)
    const off = screen.getByRole('button', { name: 'threadSidebarUnread' })
    expect(off.className).toContain('dshx:hover:bg-trigger-fill')
    const on = screen.getByRole('button', { name: 'threadSidebarWorking', pressed: true })
    expect(on.className).toContain('dshx:data-[state=on]:hover:bg-(--dshx-segment-thumb)')
  })
})

// Council round 30, item 10: the status chips align on a two-column grid, each chip filling its cell from the start.
describe('status chips align (round 31, item 10)', () => {
  it('lays every status group out as two columns, its label across both, each chip full width from the start', () => {
    render(<ListFilterPanel {...panel()} />)
    fireEvent.click(screen.getByRole('button', { name: 'threadSidebarFilterMoreStatuses' }))
    const groups = Array.from(document.querySelectorAll<HTMLElement>('[data-thread-status-group]'))
    expect(groups).toHaveLength(3)
    for (const group of groups) {
      for (const token of ['dshx:grid', 'dshx:grid-cols-2', 'dshx:gap-1', 'dshx:pointer-coarse:gap-2']) expect(group.className).toContain(token)
      expect(group.className).not.toContain('dshx:flex-wrap')
    }
    const label = element(document.getElementById(element(groups[1]).getAttribute('aria-labelledby') ?? ''))
    expect(label.className).toContain('dshx:col-span-2')
    const chip = screen.getByRole('button', { name: 'threadSidebarApprovalNeeded' })
    expect(chip.className).toContain('dshx:w-full')
    expect(chip.className).toContain('dshx:justify-start')
  })
})

// Council round 30, item 11: Reset disables itself as it acts, so focus fell to the page; it hands focus to the active
// preset as Clear, Save and Discard do. And the status chips lose their outer group: the section is already named Status,
// so a screen reader heard "Status" twice.
describe('Reset keeps focus, Status is named once (round 31, item 11)', () => {
  it('moves focus to the active preset as Reset acts', () => {
    const onReset = vi.fn()
    render(<ListFilterPanel {...panel({ reset: { disabled: false, onReset } })} />)
    const reset = screen.getByRole('button', { name: 'threadSidebarFilterResetLabel' })
    reset.focus()
    fireEvent.click(reset)
    expect(onReset).toHaveBeenCalledOnce()
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'All threads' }))
  })

  it('names Status once: the section, with no group around the chips repeating it', () => {
    render(<ListFilterPanel {...panel()} />)
    expect(screen.getAllByRole('region', { name: 'threadSidebarFilterStatus' })).toHaveLength(1)
    expect(screen.queryByRole('group', { name: 'threadSidebarFilterStatus' })).toBeNull()
  })
})

// Council round 30, item 12: copy. Muted, Done and Archived are threads set aside, not storage; the manual grouping is
// \"Custom\" on its segment, still named Arrange manually.
it('names the third status group Set aside and the manual grouping Custom (round 31, item 12)', () => {
  expect(english).toContain("threadSidebarFilterGroupStorage: 'Set aside',")
  expect(english).toContain("threadSidebarGroupManualShort: 'Custom',")
  expect(english).toContain("threadSidebarGroupStatus: 'Arrange manually',")
})

// Council round 31, item 1: "All threa… 2". On a desktop with filters on, the count takes the funnel's slot at the start
// as a 16px filter badge (11px / 600, tabular), so the preset name gets the funnel's room; the phone keeps "Filters 2".
describe('the desktop trigger fits its name (round 32, item 1)', () => {
  const trigger = filterControl.slice(filterControl.indexOf('<PopoverTrigger asChild>'), filterControl.indexOf('</PopoverTrigger>'))
  it('draws the count badge in the funnel slot on a desktop while filters are on, the funnel otherwise', () => {
    expect(trigger).toMatch(/\{scopeSlot === null && scopeCount !== null \? \([\s\S]{0,800}?<span\s+aria-hidden="true"\s+data-testid="thread-scope-count"[\s\S]{0,400}?<ListFilterIcon/u)
    const badge = trigger.slice(trigger.indexOf('data-testid="thread-scope-count"'), trigger.indexOf('<ListFilterIcon'))
    for (const token of ['dshx:size-4', 'dshx:rounded-full', 'dshx:bg-[color-mix(in_oklab,var(--dsw-alias-label-primary)_20%,transparent)]', 'dshx:text-2xs', 'dshx:font-semibold', 'dshx:tabular-nums']) expect(badge).toContain(token)
    // The phone keeps its trailing pill after "Filters".
    expect(trigger).toContain('{scopeSlot !== null && scopeCount !== null ? (')
  })
})

// Council round 31, item 3: the revealed status groups sat in a ToggleGroup without w-full (the kit's is w-fit), so their
// chips came out 18px short of the leading row's on a desktop and 10px on a phone. The region spans the width, one column.
describe('revealed chips share the grid above (round 32, item 3)', () => {
  it('gives the More region the full width and the leading row its column template', () => {
    render(<ListFilterPanel {...panel()} />)
    fireEvent.click(screen.getByRole('button', { name: 'threadSidebarFilterMoreStatuses' }))
    const region = element(document.querySelector('[data-thread-status-more-region]'))
    expect(region.className).toContain('dshx:w-full')
    expect(region.className).toContain('dshx:grid-cols-[minmax(0,1fr)]')
    const leading = element(screen.getByRole('group', { name: 'threadSidebarFilterGroupActivity' }))
    // Each revealed group's layout (the two-column grid, its gaps, the full width) is the leading row's.
    const tokens = leading.className.split(/\s+/u)
    for (const group of Array.from(region.querySelectorAll('[data-thread-status-group]')))
      for (const token of group.className.split(/\s+/u)) expect(tokens, token).toContain(token)
  })
})

// Council round 31, item 4: scrolling under the sticky header. Its bottom rule shows only while the panel is scrolled; the
// scroller keeps a focused control clear of the header (44px) and the bottom fade (24px); More reveals to the start.
describe('scrolling under the header (round 32, item 4)', () => {
  it('draws the header rule only while the panel is scrolled', () => {
    const { container } = render(<ListFilterPanel {...panel()} />)
    const root = element(container.querySelector('[data-thread-list-filter-panel]'))
    const header = element(root.querySelector('[data-thread-filter-header]'))
    expect(header.className).toContain('dshx:border-b-0!')
    expect(header.className).toContain('dshx:data-[scrolled]:border-b!')
    expect(header.hasAttribute('data-scrolled')).toBe(false)
    root.scrollTop = 40
    fireEvent.scroll(root)
    expect(header.hasAttribute('data-scrolled')).toBe(true)
    root.scrollTop = 0
    fireEvent.scroll(root)
    expect(header.hasAttribute('data-scrolled')).toBe(false)
  })

  it('pads the scroller 44px at the top and 24px at the foot, so Tab never lands under the header or the fade', () => {
    const { container } = render(<ListFilterPanel {...panel()} />)
    const root = element(container.querySelector('[data-thread-list-filter-panel]'))
    expect(root.className).toContain('dshx:scroll-pt-11')
    expect(root.className).toContain('dshx:scroll-pb-6')
  })
})

// Council round 31, item 5: Discard is the quiet action on the phone's second line, and says which preset it discards.
describe('Discard is the quiet action (round 32, item 5)', () => {
  it('draws Discard in the secondary ink at 400 and Save in the ink at 600 on a coarse pointer', () => {
    const base = panel()
    const presets = base.presets
    if (presets === undefined) throw new Error('The fixture has presets.')
    render(<ListFilterPanel {...base} presets={{ ...presets, activeId: 'working', edited: true }} />)
    const discard = element(document.querySelector('[data-preset-discard-changes]'))
    const save = element(document.querySelector('[data-preset-save-changes]'))
    for (const token of ['dshx:pointer-coarse:font-normal', 'dshx:pointer-coarse:text-muted-foreground']) expect(discard.className).toContain(token)
    for (const token of ['dshx:pointer-coarse:font-semibold', 'dshx:pointer-coarse:text-foreground']) expect(save.className).toContain(token)
    expect(discard.className).not.toContain('dshx:pointer-coarse:text-foreground')
  })

  it('names Discard by its preset: "Discard changes to “Working”"', () => {
    expect(english).toContain("threadSidebarPresetDiscardChanges: 'Discard changes to “{name}”',")
    expect(source).toContain("label={t('threadSidebarPresetDiscardChanges', { name: preset.label })}")
  })
})

// Council round 31, item 6 (WCAG 2.5.3, label in name): the segment that reads "Custom" is named "Custom, arrange manually".
it('names the Custom segment with its visible word first (round 32, item 6)', () => {
  expect(english).toContain("threadSidebarGroupManualName: 'Custom, arrange manually',")
  expect(filterControl).toContain("status: { short: props.tSidebar('threadSidebarGroupManualShort'), name: props.tSidebar('threadSidebarGroupManualName') }")
})

// Council round 32, item 1: the count badge's bg-muted sat ~1.05:1 on the trigger fill, so \"2 All threads\" read as a
// result count. Both badges (desktop and phone) take the ink at 20% over the button (≥ 1.4:1 against it), the numeral in
// the ink (≥ 4.5:1); the phone label turns ink while a count shows; and the trigger's full name is its kit tooltip.
describe('the count badge has a shape (round 33, item 1)', () => {
  const trigger = filterControl.slice(filterControl.indexOf('<PopoverTrigger asChild>'), filterControl.indexOf('</PopoverTrigger>'))
  const BADGE_FILL = 'dshx:bg-[color-mix(in_oklab,var(--dsw-alias-label-primary)_20%,transparent)]'
  it('fills both badges with the ink at 20%, not the muted step', () => {
    const badges = trigger.split('data-testid="thread-scope-count"').slice(1).map(rest => rest.slice(0, 600))
    expect(badges).toHaveLength(2)
    for (const badge of badges) {
      expect(badge).toContain(BADGE_FILL)
      expect(badge).not.toContain('dshx:bg-muted')
      expect(badge).toContain('dshx:font-semibold')
    }
  })

  it.each(['light', 'dark'] as const)('holds the badge 1.4:1 off the button and its numeral at AA on it (%s)', scheme => {
    const p = PaletteMath.palette({ ...WARM_STONE, scheme })
    const ink = p.neutral[10]
    const [bg, panelStep] = [p.neutral[0], p.neutral[1]]
    if (ink === undefined || bg === undefined || panelStep === undefined) throw new Error('The palette has no ink or surface step.')
    for (const surface of [bg, panelStep, p.navSurface]) {
      const button = paint(surface, p.triggerFill)
      const badge = paint(button, { ...ink, alpha: 0.2 })
      expect(PaletteMath.contrastRatio(badge, button)).toBeGreaterThanOrEqual(1.4)
      expect(PaletteMath.contrastRatio(ink, badge)).toBeGreaterThanOrEqual(4.5)
    }
  })

  it('draws the phone label in the ink while a count shows, and gives the desktop trigger its full name as a tooltip', () => {
    expect(trigger).toContain("<span className={cn('dshx:truncate', scopeCount !== null && 'dshx:text-foreground')}>")
    expect(filterControl).toMatch(/<TooltipContent[^>]*data-thread-list-filter-tooltip=""[^>]*>\s*\{filterTriggerLabel\}/u)
    expect(filterControl).toContain('aria-label={filterTriggerLabel}')
  })
})

// Council round 32, item 3: measured at 1440 × 700 with More open, the panel ended at 692 over the status strip (top 675).
// The room below the trigger now ends 8px above the status strip, or the window's bottom when there is none.
describe('the desktop panel stops above the status bar (round 33, item 3)', () => {
  it('measures its room to the status strip top, less 8px', () => {
    expect(client).toContain("document.querySelector('[data-status-strip]')")
    expect(client).toMatch(/const floor = strip === null \|\| strip\.getClientRects\(\)\.length === 0 \? window\.innerHeight : strip\.getBoundingClientRect\(\)\.top/u)
    expect(client).toContain('floor - trigger.getBoundingClientRect().top - FILTER_PANEL_COLLISION_PADDING')
  })
})

// Council round 32, item 4: "Mark all as read/unread" did not say their scope. They read "Mark 5 shown as read" /
// "… unread" with the count the list draws, act on those rows, sit last in the presets' ⋯ menu after a separator, and
// "unread" shows only while something shown is read.
describe('the mark verbs say their scope (round 33, item 4)', () => {
  const optionsMenu = client.slice(client.indexOf('const presetOptionsMenu = ('), client.indexOf('const filterMenu = ('))
  it('counts the shown rows in both labels and acts on them', () => {
    expect(english).toContain("threadSidebarMarkShownRead_other: 'Mark {count} shown as read',")
    expect(english).toContain("threadSidebarMarkShownUnread_other: 'Mark {count} shown as unread',")
    expect(client).toContain("plural(props.tSidebar, 'threadSidebarMarkShownRead', shownThreadIds.length)")
    expect(client).toContain('const shownThreadIds = visibleThreadEntries.map(entry => entry.session.id)')
    expect(client).not.toContain('const activeViewThreadIds')
  })

  it('offers unread only while something shown is read, and lists both last, after a separator', () => {
    expect(client).toMatch(/\.\.\.\(shownThreadIds\.some\(sessionId => !attention\.records\.has\(sessionId\)\)\s*\?/u)
    const manage = optionsMenu.indexOf("props.tSidebar('threadSidebarPresetManage')")
    const marks = optionsMenu.indexOf('{markViewActions.map(action => (')
    expect(manage).toBeGreaterThan(-1)
    expect(marks).toBeGreaterThan(manage)
    expect(optionsMenu.slice(manage, marks)).toContain('<DropdownMenuSeparator />')
  })
})
