// @vitest-environment jsdom
import { SessionId, SessionSeq } from '@deepseek-ai/dsh-session/types'
import { cleanup, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from './organization.js'
import { renderRow, rowProps, rowSession, rowStatus, VisibleObserver } from './thread-row.test-support.js'

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', VisibleObserver)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const whereLine = (row: HTMLElement): string => row.querySelector('[data-thread-where]')?.textContent ?? ''

describe('pressing a row', () => {
  it('answers a tap or click with the accent fill within the hover duration (80ms)', async () => {
    const row = await renderRow()
    const button = row.querySelector<HTMLElement>('[data-thread-main-action]')
    expect(button?.className).toContain('dshx:active:bg-accent')
    expect(button?.className).toContain('dshx:transition-[background-color]')
    expect(button?.className).toContain('dshx:duration-(--dshx-duration-hover)')
  })
})

describe('a working thread row', () => {
  const working = { session: rowSession({ running: true }), workStatus: rowStatus({ status: 'working' }) }

  it('does not repeat the state name under the Working heading: without a known step the second line keeps where it runs', async () => {
    const row = await renderRow({ ...working, liveTurn: { startedAt: Date.now() - 471_000, step: null } })
    expect(whereLine(row)).not.toContain('threadSidebarWorking')
    expect(whereLine(row)).toContain('sample')
  })

  it('shows the elapsed time once, in the time slot of the first line', async () => {
    const row = await renderRow({ ...working, liveTurn: { startedAt: Date.now() - 471_000, step: 'Running pnpm test' } })
    expect(row.querySelectorAll('[data-live-elapsed]')).toHaveLength(1)
    expect(row.querySelector('[data-thread-where] [data-live-elapsed]')).toBeNull()
    // Whole units in the list (round five B3): "7m", never "7m 51s".
    expect(row.querySelector('[data-thread-time]')?.textContent).toBe('7m')
    // The static age would be a second reading of the same turn.
    expect(row.textContent).not.toContain('7m7m')
    expect(whereLine(row)).toContain('Running pnpm test')
  })

  it('keeps the age when the start of the turn is unknown', async () => {
    const row = await renderRow({ ...working, liveTurn: { startedAt: undefined, step: null } })
    expect(row.querySelector('[data-thread-time]')?.textContent).toBe('7m')
  })
})

const stripLabels = (row: HTMLElement): (string | null)[] =>
  Array.from(row.querySelectorAll('[data-testid="thread-row-actions"] button')).map(button => button.getAttribute('aria-label'))

describe('the hover actions of a thread row', () => {
  it('shows one verb and the row menu by default, and keeps the title readable beside them', async () => {
    const row = await renderRow()
    expect(stripLabels(row)).toEqual(['threadSidebarSettle', 'threadSidebarContextMenu'])
    // The first line gives the two seats their width while they show, so the title truncates before them instead of
    // sitting under a floating strip; the time they replace steps aside.
    const head = row.querySelector<HTMLElement>('[data-thread-head]')
    expect(head?.style.getPropertyValue('--thread-row-strip')).toBe('3.5rem')
    expect(head?.className).toContain('dshx:not-pointer-coarse:group-hover/row:pr-(--thread-row-strip)')
    expect(row.querySelector('[data-thread-time]')?.className).toContain('dshx:not-pointer-coarse:group-hover/row:hidden')
    expect(row.querySelector('[data-testid="thread-row-actions"]')?.className).not.toContain('dshx:bg-popover')
  })

  it('still draws every action the Customize sidebar setting shows, then the row menu', async () => {
    const row = await renderRow({ rowActions: DEFAULT_PREFERENCES.rowActionOrder })
    expect(stripLabels(row)).toEqual([
      'threadSidebarPin',
      'threadSidebarPark',
      'threadSidebarMute',
      'threadSidebarArchive',
      'threadSidebarSettle',
      'threadSidebarContextMenu',
    ])
  })

  it('opens the row menu from the strip', async () => {
    const row = await renderRow()
    const opened = vi.fn()
    row.querySelector('article')?.addEventListener('contextmenu', opened)
    fireEvent.click(row.querySelector('[data-testid="thread-row-actions"] button[aria-label="threadSidebarContextMenu"]') ?? row)
    expect(opened).toHaveBeenCalledOnce()
  })
})

describe('a row that needs you', () => {
  const asking = { workStatus: rowStatus({ status: 'needs-you', verb: 'Answer', detail: 'Asks: Which layout should the release notes use?' }) }

  it('keeps the title and time on line 1 and puts Answer at line 2\'s trailing edge as attention text (council round 8 B3)', async () => {
    const row = await renderRow(asking)
    const verb = row.querySelector<HTMLElement>('[data-testid="thread-row-verb"]')
    expect(verb?.closest('[data-verb-seat]')?.getAttribute('data-verb-seat')).toBe('meta')
    // One layer of colour: the row keeps its wash, the verb is attention text on a transparent fill.
    expect(verb?.getAttribute('data-variant')).toBe('attention-text')
    // 24px drawn; the kit gives it a 44px hit area on touch, painted above the row after it.
    expect(verb?.className).toContain('dshx:h-6')
    expect(verb?.className).toContain('dshx:z-10')
    // Line 1 is the title at full width and the time: no verb seat there any more.
    expect(row.querySelector('[data-thread-time]')?.textContent).toBe('7m')
    expect(row.querySelector('[data-thread-head]')?.className).not.toContain('dshx:pr-17.5')
    // Line 2 keeps the verb's own width at its end (council round 14 B1), never a fixed 70px: an invisible copy of the
    // verb's label holds its seat, so the project and the kind take the rest.
    const where = row.querySelector<HTMLElement>('[data-thread-where]')
    expect(where?.className).not.toMatch(/dshx:pr-(17\.5|34)\b/u)
    const reserve = where?.querySelector<HTMLElement>(':scope > [data-verb-reserve]')
    expect(reserve?.textContent).toBe(verb?.textContent)
    expect(reserve?.getAttribute('aria-hidden')).toBe('true')
    expect(reserve?.className).toContain('dshx:invisible')
    expect(reserve?.className).toContain('dshx:shrink-0')
    expect(reserve?.className).toContain('dshx:px-2')
    expect(reserve?.className).toContain('dshx:text-xs')
    expect(reserve?.className).toContain('dshx:font-medium')
    // Only its width counts: it keeps line 2 at 16px instead of the verb's 24px, so the row never grows.
    expect(reserve?.className).toContain('dshx:h-4')
    expect(reserve?.className).not.toMatch(/dshx:(pointer-coarse:)?h-[67]\b/u)
    expect(row.querySelector('[data-testid="thread-row-status-kind"]')?.className).toContain('dshx:flex-1')
  })

  it('lets a Needs-you title wrap to two lines at 13/18, weight 550', async () => {
    const row = await renderRow(asking)
    const title = row.querySelector<HTMLElement>('[data-thread-title]')
    expect(title?.className).toContain('dshx:line-clamp-2')
    expect(title?.className).not.toContain('dshx:truncate')
    expect(title?.className).toContain('dshx:text-sm/[18px]')
    expect(title?.className).toContain('dshx:font-[550]')
    const idle = await renderRow({ workStatus: rowStatus({ status: 'idle' }) })
    expect(idle.querySelector<HTMLElement>('[data-thread-title]')?.className).toContain('dshx:truncate')
  })


  it('gives a failed row\'s verb the danger text (council round 8 B3)', async () => {
    const row = await renderRow({ workStatus: rowStatus({ status: 'failed', verb: 'Retry', detail: 'Turn failed' }) })
    expect(row.querySelector('[data-testid="thread-row-verb"]')?.getAttribute('data-variant')).toBe('danger-text')
  })

  it('reads the kind or failure under the title in the secondary ink at 12/16 (council round 14)', async () => {
    for (const workStatus of [asking.workStatus, rowStatus({ status: 'failed', verb: 'Retry', detail: 'Turn failed' })]) {
      const row = await renderRow({ workStatus })
      const detail = row.querySelector<HTMLElement>('[data-testid="thread-row-status-kind"]')
      expect(detail?.className).toContain('dshx:text-xs/4')
      expect(detail?.className).toContain('dshx:text-muted-foreground')
      expect(detail?.className).not.toContain('dshx:text-foreground')
    }
  })

  it('lets a Failed title wrap to two lines like a Needs-you one', async () => {
    const row = await renderRow({ workStatus: rowStatus({ status: 'failed', verb: 'Retry', detail: 'Turn failed' }) })
    const title = row.querySelector<HTMLElement>('[data-thread-title]')
    expect(title?.className).toContain('dshx:line-clamp-2')
    expect(title?.className).not.toContain('dshx:truncate')
  })

  it('opens its sub-rows from a real chevron in a 24 px seat, not a 12 px caret', async () => {
    const children = ['c1'].map(id => rowSession({ id: SessionId(id), parentId: SessionId('session-1'), origin: 'subagent' }))
    const row = await renderRow({ childThreads: children })
    const toggle = row.querySelector<HTMLElement>('[data-thread-children-toggle]')
    expect(toggle?.className).toContain('dshx:h-6')
    const seat = toggle?.querySelector<HTMLElement>('[data-children-chevron]')
    expect(seat?.className).toContain('dshx:size-6')
    expect(seat?.querySelector('svg')?.getAttribute('class')).toContain('dshx:size-4')
  })

  it('drops the counter\'s dots and number when line 2 already says how many subagents it waits on (round five B1)', async () => {
    const child = rowSession({ id: SessionId('c1'), parentId: SessionId('s1'), origin: 'subagent', running: true })
    const row = await renderRow({ childThreads: [child], workStatus: rowStatus({ status: 'working', detail: 'Waiting on 1 subagent' }) })
    const toggle = row.querySelector<HTMLElement>('[data-thread-children-toggle]')
    expect(toggle?.textContent).toBe('')
    expect(toggle?.querySelector('[data-children-chevron]')).not.toBeNull()
    // The spoken name keeps the count.
    expect(toggle?.getAttribute('aria-label')).toBe('threadSidebarShowChildren (1)')
    cleanup()
    const plain = await renderRow({ childThreads: [child], workStatus: rowStatus({ status: 'idle' }) })
    expect(plain.querySelector('[data-thread-children-toggle]')?.textContent).toBe('1')
  })

  it('keeps the question readable beside a subagent counter', async () => {
    // The verb and the counter share line 2's end; the question keeps the rest of the line.
    const children = ['c1', 'c2', 'c3'].map(id => rowSession({ id: SessionId(id), parentId: SessionId('session-1'), origin: 'subagent' }))
    const row = await renderRow({ ...asking, childThreads: children })
    const end = row.querySelector('[data-thread-row-end]')
    expect(end?.querySelector('[data-testid="thread-row-verb"]')).not.toBeNull()
    expect(end?.querySelector('[data-thread-children-toggle]')).not.toBeNull()
    // The verb's own width (its invisible copy) plus the counter's 72px, not a fixed 136px.
    const where = row.querySelector<HTMLElement>('[data-thread-where]')
    expect(where?.className).not.toContain('dshx:pr-34')
    expect(where?.className).toContain('dshx:pr-18')
    expect(where?.querySelector('[data-verb-reserve]')?.textContent).toBe(end?.querySelector('[data-testid="thread-row-verb"]')?.textContent)
  })

  it('ends a touch row\'s verb label at the time column above it, the counter at the menu column (round nine B5)', async () => {
    const row = await renderRow(asking)
    const end = row.querySelector<HTMLElement>('[data-thread-row-end]')
    // The verb button's 8px padding reaches into the 44px menu column, so its label ends where the time does.
    expect(end?.className).toContain('dshx:pointer-coarse:right-9')
    expect(end?.className).not.toContain('dshx:pointer-coarse:right-11')
    expect(row.querySelector('[data-testid="thread-row-verb"]')?.className).toContain('dshx:px-2')
    cleanup()
    const children = ['c1'].map(id => rowSession({ id: SessionId(id), parentId: SessionId('session-1'), origin: 'subagent' }))
    const counted = await renderRow({ ...asking, childThreads: children })
    expect(counted.querySelector('[data-thread-row-end]')?.className).toContain('dshx:pointer-coarse:right-11')
    // A touch row's reservation reaches 8px into the menu column like the verb does; beside a counter it does not.
    expect(row.querySelector('[data-verb-reserve]')).toBeNull()
    expect(counted.querySelector('[data-verb-reserve]')?.className).not.toContain('dshx:pointer-coarse:-mr-2')
  })

  it('keeps the attention verb to Needs-you and Failed rows: a Ready row carries no Land button', async () => {
    const row = await renderRow({
      workStatus: rowStatus({ status: 'ready', verb: 'Land' }),
      projectMark: false,
    })
    expect(row.querySelector('[data-testid="thread-row-verb"]')).toBeNull()
    expect(row.querySelector('[data-thread-head]')?.className).not.toContain('dshx:pr-17.5')
  })

  it('reads `[mark] project · kind` through the kit AttentionMeta, the mark on the rail under the glyph (council round 14 B1)', async () => {
    const parts = (line: HTMLElement | null): (string | null)[] =>
      Array.from(line?.querySelectorAll(':scope > [data-attention-meta-part]') ?? []).map(part => part.getAttribute('data-attention-meta-part'))
    const text = (line: HTMLElement | null, part: string): string | undefined => line?.querySelector(`:scope > [data-attention-meta-part="${part}"]`)?.textContent ?? undefined
    for (const [workStatus, kind] of [
      [asking.workStatus, 'threadSidebarAskQuestion'],
      [rowStatus({ status: 'needs-you', verb: 'Approve', detail: 'git push --force origin main' }), 'threadSidebarAskApproval'],
      [rowStatus({ status: 'needs-you', verb: 'Review', detail: 'Publish the preview build' }), 'threadSidebarAskApproval'],
      [rowStatus({ status: 'failed', verb: 'Retry', detail: 'Turn failed' }), 'Turn failed'],
    ] as const) {
      const row = await renderRow({ workStatus })
      const line = row.querySelector<HTMLElement>('[data-testid="thread-row-status-kind"]')
      expect(line?.getAttribute('data-slot')).toBe('attention-meta')
      expect(line?.getAttribute('data-mark-seat')).toBe('rail')
      // One formatter for every surface: the mark in its rail seat, then the name, then the kind.
      expect(parts(line)).toEqual(['rail', 'name', 'sep', 'kind'])
      expect(text(line, 'name')).toBe('sample')
      expect(text(line, 'kind')).toBe(kind)
      // On the desktop sidebar the name outlasts the kind: the glyph and the verb already say the kind (lead, round 14).
      expect(line?.getAttribute('data-keep')).toBe('name')
      // One mark on the line, in the rail seat under the status glyph, so every row's marks form one column.
      const marks = row.querySelectorAll<HTMLElement>('[data-thread-where] [data-slot="project-mark"]')
      expect(marks).toHaveLength(1)
      expect(marks[0]?.parentElement?.getAttribute('data-attention-meta-part')).toBe('rail')
      expect(marks[0]?.getAttribute('data-size')).toBe('dense')
      // The line is the meta line itself, not a second seat beside one.
      expect(line?.parentElement?.hasAttribute('data-thread-where')).toBe(true)
      expect(row.querySelectorAll('[data-thread-where] > span.dshx\\:w-4')).toHaveLength(0)
      cleanup()
    }
  })
})

describe('the trailing column and the phone row (council round 17 B1.2)', () => {
  const asking = { workStatus: rowStatus({ status: 'needs-you', verb: 'Answer', detail: 'Asks: ok?' }) }
  const children = ['c1'].map(id => rowSession({ id: SessionId(id), parentId: SessionId('session-1'), origin: 'subagent' }))
  const classOf = (row: HTMLElement, selector: string): string => row.querySelector<HTMLElement>(selector)?.className ?? ''

  it('ends the age, the verb label and the chevron glyph on one edge: the time column\'s', async () => {
    // Comfortable rows pad their content 10px: the age ends 10px in. The verb's 8px padding and the chevron's 8px of
    // seat and glyph inset need their box 2px in, not 6px (the 4–5px ragged column the council measured).
    const comfortable = { ...rowProps().rowStyle, density: 'comfortable' as const }
    const row = await renderRow({ ...asking, childThreads: children, rowStyle: comfortable })
    expect(classOf(row, '[data-thread-main-action]')).toContain('dshx:px-2.5')
    const end = classOf(row, '[data-thread-row-end]')
    expect(end).toContain('dshx:right-0.5')
    expect(end).not.toMatch(/(?<![:-])dshx:right-1\.5\b/u)
    // Touch keeps its columns: the counter at the menu column.
    expect(end).toContain('dshx:pointer-coarse:right-11')
    // The verb's invisible copy follows it 8px past line 2's end.
    expect(classOf(row, '[data-verb-reserve]')).toContain('dshx:-mr-2')
    cleanup()
    // A compact row pads 8px: its trailing parts sit on the row's edge box.
    const compact = await renderRow({ ...asking, rowStyle: { ...rowProps().rowStyle, density: 'compact' } })
    expect(classOf(compact, '[data-thread-main-action]')).toContain('dshx:px-2')
    expect(classOf(compact, '[data-thread-row-end]').split(' ')).toContain('dshx:right-0')
    cleanup()
    // A chevron alone ends the time column on touch, out of the row menu's column (council round 18 B1.3).
    const plain = await renderRow({ childThreads: children, workStatus: rowStatus({ status: 'idle' }), rowStyle: comfortable })
    expect(classOf(plain, '[data-thread-row-end]')).toContain('dshx:right-0.5')
    expect(classOf(plain, '[data-thread-row-end]')).toContain('dshx:pointer-coarse:right-11')
  })

  it('draws the touch row menu ⋯ in the tertiary ink at 16px', async () => {
    const row = await renderRow()
    const menu = row.querySelector<HTMLElement>('[data-testid="thread-row-menu"]')
    expect(menu?.className).toContain('dshx:text-(--dsw-alias-label-tertiary)')
    expect(menu?.className).not.toContain('dshx:text-muted-foreground')
    expect(menu?.querySelector('[data-slot="overflow-glyph"]')?.getAttribute('class')).toContain('dshx:size-4')
  })

  it('drops the selected edge on the phone list, keeping it on the desktop sidebar', async () => {
    const row = await renderRow({ selected: true, workStatus: rowStatus({ status: 'working' }) })
    const fill = classOf(row, 'article > div')
    expect(fill).toContain('dshx:group-data-[selected=true]/row:selected-edge')
    expect(fill).toContain('dshx:phone:group-data-[selected=true]/row:shadow-none')
  })
})

describe('the glyph column (council round 15 B1)', () => {
  const SEAT = 'dshx:w-[var(--attention-meta-rail-seat,20px)]'

  it('seats the status glyph at the rail seat\'s 20px width, centred, so glyph and mark share one axis', async () => {
    for (const workStatus of [
      rowStatus({ status: 'needs-you', verb: 'Approve', detail: 'git push --force origin main' }),
      rowStatus({ status: 'failed', verb: 'Retry', detail: 'Turn failed' }),
      rowStatus({ status: 'idle' }),
    ]) {
      const row = await renderRow({ selected: true, workStatus })
      const lead = row.querySelector<HTMLElement>('[data-thread-lead]')
      expect(lead?.className).toContain(SEAT)
      expect(lead?.className).toContain('dshx:justify-center')
      expect(lead?.className).not.toContain('dshx:size-4')
      // Line 2's mark sits in a seat as wide: the kit's rail on an attention row, the row's own seat otherwise.
      const seat = row.querySelector<HTMLElement>('[data-attention-meta-part="rail"]') ?? row.querySelector<HTMLElement>('[data-thread-mark-seat]')
      expect(seat?.className).toContain(SEAT)
      expect(seat?.querySelector('[data-slot="project-mark"]')).not.toBeNull()
      cleanup()
    }
  })
})

describe('colour in a row', () => {
  const wash = (row: HTMLElement): HTMLElement | null => row.querySelector<HTMLElement>('[data-row-wash]')

  it('holds a soft indigo wash on a Needs-you row and a softer red one on a Failed row', async () => {
    const asking = await renderRow({ workStatus: rowStatus({ status: 'needs-you', verb: 'Answer', detail: 'Asks: ok?' }) })
    expect(wash(asking)?.getAttribute('data-row-wash')).toBe('needs-you')
    expect(wash(asking)?.className).toContain('dshx:bg-wash-needs-you')
    cleanup()
    const failed = await renderRow({ workStatus: rowStatus({ status: 'failed', detail: 'Turn failed' }) })
    expect(wash(failed)?.getAttribute('data-row-wash')).toBe('failed')
    expect(wash(failed)?.className).toContain('dshx:bg-wash-failed')
    cleanup()
    const idle = await renderRow({ workStatus: rowStatus({ status: 'idle' }) })
    expect(wash(idle)).toBeNull()
  })

  it('paints the selected row with the selected wash, not the grey hover fill', async () => {
    const row = await renderRow({ selected: true })
    const fill = row.querySelector<HTMLElement>('article > div')
    expect(fill?.className).toContain('dshx:group-data-[selected=true]/row:bg-selected-wash')
    expect(fill?.className).toContain('dshx:group-data-[selected=true]/row:selected-marker')
    expect(fill?.className).not.toContain('dshx:group-data-[selected=true]/row:bg-accent')
    expect(row.querySelector('[data-thread-title]')?.className).toContain('dshx:group-data-[selected=true]/row:font-selected')
  })

  it('draws no marker pill beside a leading status glyph: the selected wash and the 550 title carry it (council round 11 B3)', async () => {
    const row = await renderRow({ selected: true, workStatus: rowStatus({ status: 'working' }) })
    expect(row.querySelector('[data-thread-lead]')?.hasAttribute('data-leading-glyph')).toBe(true)
    expect(row.querySelector('[data-marker]')).toBeNull()
  })

  it('outlines the selected glyph-led row with the kit selected edge on its wash (council round 12 B1)', async () => {
    const row = await renderRow({ selected: true, workStatus: rowStatus({ status: 'working' }) })
    const fill = row.querySelector<HTMLElement>('article > div')
    // The wash alone measured 1.10:1 off the dark list; a 1px neutral inset edge (3:1 on the wash) outlines it.
    expect(fill?.className).toContain('dshx:group-data-[selected=true]/row:selected-edge')
    expect(fill?.className).toContain('dshx:group-data-[selected=true]/row:bg-selected-wash')
    cleanup()
    // A Needs-you or Failed row keeps its attention wash and its pill, no edge.
    const asking = await renderRow({ selected: true, workStatus: rowStatus({ status: 'needs-you', verb: 'Answer', detail: 'Asks: ok?' }) })
    expect(asking.querySelector<HTMLElement>('[data-row-wash]')?.className).not.toContain('selected-edge')
  })

  it('keeps the pill on a selected Needs-you or Failed row, whose attention wash replaces the selected wash (council round 11 B3)', async () => {
    for (const workStatus of [rowStatus({ status: 'needs-you', verb: 'Answer', detail: 'Asks: ok?' }), rowStatus({ status: 'failed', detail: 'Turn failed' })]) {
      const row = await renderRow({ selected: true, workStatus })
      const fill = row.querySelector<HTMLElement>('[data-row-wash]')
      // The kit's `MARKER_KEEP` on the element that carries `selected-marker`: it beats the leading-glyph rule.
      expect(fill?.className).toContain('dshx:group-data-[selected=true]/row:selected-marker')
      expect(fill?.getAttribute('data-marker')).toBe('pill')
      cleanup()
    }
  })

  it('keeps a selected Needs-you row on its attention wash and adds only the marker', async () => {
    const row = await renderRow({ selected: true, workStatus: rowStatus({ status: 'needs-you', verb: 'Answer', detail: 'Asks: ok?' }) })
    const fill = row.querySelector<HTMLElement>('[data-row-wash]')
    expect(fill?.className).toContain('dshx:bg-wash-needs-you')
    expect(fill?.className).toContain('dshx:group-data-[selected=true]/row:selected-marker')
    expect(fill?.className).not.toContain('dshx:group-data-[selected=true]/row:bg-selected-wash')
  })
})

describe('the project on line 2', () => {
  it('is a 16px ProjectMark tile in the seat under the status glyph, with the name in muted text', async () => {
    const row = await renderRow({ workStatus: rowStatus({ status: 'idle' }) })
    const mark = row.querySelector<HTMLElement>('[data-thread-where] [data-slot="project-mark"]')
    expect(mark?.getAttribute('data-size')).toBe('dense')
    expect(mark?.textContent).toBe('SA')
    const name = row.querySelector<HTMLElement>('[data-testid="thread-row-project"]')
    expect(name?.textContent).toBe('sample')
    expect(name?.className).not.toMatch(/project-tone-/u)
  })

  it('uses the colour picked for the project', async () => {
    const row = await renderRow({ projectChipTone: 4, workStatus: rowStatus({ status: 'idle' }) })
    expect(row.querySelector('[data-slot="project-mark"]')?.className).toContain('project-tone-balanced-4')
  })

  it('reads a working reason through the same AttentionMeta, the mark on the rail (council round 14 B1)', async () => {
    const row = await renderRow({ workStatus: rowStatus({ status: 'working', detail: 'Waiting on 1 subagent' }) })
    const line = row.querySelector<HTMLElement>('[data-thread-where] > [data-slot="attention-meta"]')
    expect(line?.getAttribute('data-mark-seat')).toBe('rail')
    expect(line?.querySelector(':scope > [data-attention-meta-part="kind"]')?.textContent).toBe('Waiting on 1 subagent')
    // The reason is the line's news: it outlasts the name.
    expect(line?.getAttribute('data-keep')).toBe('kind')
    // The name shows while it fits and gives way, whole, to the mark when it does not (the kit measures it).
    expect(line?.querySelector(':scope > [data-attention-meta-part="name"]')?.textContent).toBe('sample')
    expect(line?.querySelector(':scope > [data-attention-meta-part="rail"] [data-slot="project-mark"]')).not.toBeNull()
  })
})

describe('a thread that runs a background job', () => {
  it('says so with a muted job chip and stays Idle, never Working', async () => {
    const row = await renderRow({ runningJobs: 1, workStatus: rowStatus({ status: 'idle' }) })
    const chip = row.querySelector('[data-thread-jobs]')
    expect(chip?.textContent).toMatch(/threadSidebarRunningJobs/u)
    expect(chip?.className).toContain('dshx:text-muted-foreground')
    expect(row.querySelector('[data-slot="status-glyph"]')?.getAttribute('data-status')).toBe('idle')
  })

  it('drops the job chip when line 2 already says it waits on its subagents', async () => {
    const child = rowSession({ id: SessionId('c1'), parentId: SessionId('s1'), origin: 'subagent', running: true })
    const row = await renderRow({ runningJobs: 1, childThreads: [child], workStatus: rowStatus({ status: 'working', detail: 'Waiting on 1 subagent' }) })
    const detail = row.querySelector('[data-thread-where] > [data-slot="attention-meta"]')
    expect(detail?.querySelector(':scope > [data-attention-meta-part="kind"]')?.textContent).toBe('Waiting on 1 subagent')
    // The reason's line takes the rest of line 2.
    expect(detail?.className).toContain('dshx:flex-1')
    expect(row.querySelector('[data-thread-jobs]')).toBeNull()
  })

  it('shows no chip without a running job', async () => {
    const row = await renderRow({ workStatus: rowStatus({ status: 'idle' }) })
    expect(row.querySelector('[data-thread-jobs]')).toBeNull()
  })
})

describe('a subagent row under its parent', () => {
  it('is titled with the name the parent gave the subagent, not with the prompt it was sent', async () => {
    const child = rowSession({
      id: SessionId('child-1'),
      parentId: SessionId('s1'),
      origin: 'subagent',
      displayTitle: '[[once call bash {"command":"sleep 3000"}]] check the release',
      projectionValues: { subagent: { mode: 'continuable', label: 'Release check', seq: SessionSeq(3) } },
    })
    const unnamed = rowSession({ id: SessionId('child-2'), parentId: SessionId('s1'), origin: 'subagent', displayTitle: 'Summarise the diff' })
    // No time column: the age helper comes from the Host's primitives, which this environment does not load.
    const row = await renderRow({
      childThreads: [child, unnamed],
      childrenOpen: true,
      allChildrenShown: true,
      rowStyle: { ...rowProps().rowStyle, time: false },
    })
    const titles = Array.from(row.querySelectorAll('ul [data-thread-main-action]')).map(button => button.querySelector('span.dshx\\:truncate')?.textContent)
    expect(titles).toEqual(['Release check', 'Summarise the diff'])
  })

  it('names the model it runs on in line 2, `[mark] model · state`, and no line 2 for an unknown model (council round 17 B1.1)', async () => {
    const routed = rowSession({
      id: SessionId('child-1'),
      parentId: SessionId('s1'),
      origin: 'subagent',
      running: true,
      // A held child has not answered: the route projection holds the route its descriptor started it on (the parent's).
      projectionValues: {
        threadSidebarModelRoute: 'dshx_fake_commandcode/gpt-6-luna',
        subagent: { mode: 'continuable', label: 'Audit', seq: SessionSeq(3) },
      },
    })
    const backendOnly = rowSession({
      id: SessionId('child-2'),
      parentId: SessionId('s1'),
      origin: 'subagent',
      projectionValues: { threadSidebarModelRoute: null, subagent: { mode: 'continuable', label: 'Lint', seq: SessionSeq(4) } },
    })
    const row = await renderRow({
      childThreads: [routed, backendOnly],
      childrenOpen: true,
      allChildrenShown: true,
      rowStyle: { ...rowProps().rowStyle, time: false },
      childStatuses: new Map([
        [routed.id, rowStatus({ status: 'working' })],
        [backendOnly.id, rowStatus({ status: 'failed' })],
      ]),
    })
    const [first, second] = Array.from(row.querySelectorAll<HTMLElement>('ul [data-thread-main-action]'))
    const meta = first?.querySelector<HTMLElement>('[data-thread-child-meta]')
    expect(meta?.querySelector('[data-slot="route-model"]')?.textContent).toBe('gpt-6-luna')
    expect(meta?.querySelector('[data-model-mark="openai"]')).not.toBeNull()
    // Council round 18 B1.1: the working glyph says Working, so line 2 is the model alone.
    expect(meta?.querySelector('[data-thread-child-state]')).toBeNull()
    expect(meta?.className).toContain('dshx:text-xs/4')
    expect(meta?.className).toContain('dshx:text-muted-foreground')
    // Line 2 starts under the title: the 16px glyph seat and line 1's 8px gap.
    expect(meta?.className).toContain('dshx:pl-6')
    expect(first?.querySelector('[data-thread-child-lead]')?.className).toContain('dshx:w-4')
    expect(first?.textContent).not.toContain('dshx_fake_commandcode')
    // No known model: one line, and its Failed word stays on it.
    expect(second?.querySelector('[data-thread-child-meta]')).toBeNull()
    expect(second?.querySelector('[data-slot="route-model"]')).toBeNull()
    expect(second?.querySelector('[data-thread-child-head]')?.textContent).toContain('threadSidebarStateFailed')
  })

  it('drops line 2\'s state word where the glyph already says it, and keeps the words the glyph cannot (council round 18 B1.1)', async () => {
    const statuses = ['working', 'idle', 'ready', 'done', 'needs-you', 'failed'] as const
    const children = statuses.map((status, index) =>
      rowSession({
        id: SessionId(`child-${status}`),
        parentId: SessionId('s1'),
        origin: 'subagent',
        projectionValues: {
          threadSidebarModelRoute: 'dshx_fake_commandcode/gpt-6-luna',
          subagent: { mode: 'continuable', label: status, seq: SessionSeq(index + 3) },
        },
      }),
    )
    const row = await renderRow({
      childThreads: children,
      childrenOpen: true,
      allChildrenShown: true,
      rowStyle: { ...rowProps().rowStyle, time: false, maxChildren: 10 },
      childStatuses: new Map(children.map((child, index) => [child.id, rowStatus({ status: statuses[index] ?? 'idle' })])),
    })
    const words = Array.from(row.querySelectorAll<HTMLElement>('ul [data-thread-child-meta]')).map(
      meta => meta.querySelector('[data-thread-child-state]')?.textContent ?? null,
    )
    expect(words).toEqual([null, null, null, null, 'threadSidebarStateNeedsYou', 'threadSidebarStateFailed'])
    // Without a word, line 2 is the model alone: no dangling separator.
    const working = row.querySelector<HTMLElement>('ul [data-thread-child-meta]')
    expect(working?.textContent).toBe('gpt-6-luna')
  })

  it('says why a failed child failed, "Turn failed", beside its Failed glyph (round 21 D4)', async () => {
    const child = rowSession({
      id: SessionId('child-failed'),
      parentId: SessionId('s1'),
      origin: 'subagent',
      projectionValues: {
        threadSidebarModelRoute: 'dshx_fake_commandcode/claude-sonnet-5-5',
        subagent: { mode: 'continuable', label: 'Diff the ledger', seq: SessionSeq(3) },
      },
    })
    const row = await renderRow({
      childThreads: [child],
      childrenOpen: true,
      allChildrenShown: true,
      rowStyle: { ...rowProps().rowStyle, time: false },
      childStatuses: new Map([[child.id, rowStatus({ status: 'failed', detail: 'Turn failed' })]]),
    })
    const button = row.querySelector<HTMLElement>('ul [data-thread-main-action]')
    expect(button?.querySelector('[data-thread-child-lead] [data-status="failed"]')).not.toBeNull()
    expect(button?.querySelector('[data-thread-child-meta]')?.textContent).toBe('claude-sonnet-5-5·Turn failed')
  })
})

describe('the phone list (council round 18 B1.3)', () => {
  const children = ['c1'].map(id => rowSession({ id: SessionId(id), parentId: SessionId('session-1'), origin: 'subagent', running: true }))
  const waiting = { childThreads: children, workStatus: rowStatus({ status: 'working', detail: 'Waiting on 1 subagent' }) }
  const classOf = (row: HTMLElement, selector: string): string => row.querySelector<HTMLElement>(selector)?.className ?? ''

  it('seats the row ⋯ in a 44pt column flush with the row edge, centred on line 1', async () => {
    const row = await renderRow()
    const menu = classOf(row, '[data-testid="thread-row-menu"]')
    // 44pt wide from the row's edge: its glyph centre sits 22pt in (x ≈ 349 at 390pt), and its hit area ends on the row.
    expect(menu).toContain('dshx:pointer-coarse:right-0')
    expect(menu).toContain('dshx:pointer-coarse:w-11')
    // Line 1 is the row's 6px padding and an 18px line: a 28px button 1px down centres on it.
    expect(menu).toContain('dshx:pointer-coarse:top-px')
  })

  it('moves the expand chevron out of the ⋯ column into line 2\'s time column', async () => {
    const row = await renderRow(waiting)
    const end = classOf(row, '[data-thread-row-end]')
    expect(end).toContain('dshx:pointer-coarse:right-11')
    expect(end).not.toContain('dshx:pointer-coarse:right-1.5')
    // A 44pt toggle that ends where the ⋯ column starts, so the two hit areas never share a square.
    const toggle = classOf(row, '[data-thread-children-toggle]')
    expect(toggle).toContain('dshx:pointer-coarse:min-w-11')
    expect(toggle).toContain('dshx:pointer-coarse:justify-end')
    // The glyph ends on the time's edge: its seat reaches 8px past the toggle (its own 4px inset and the glyph's),
    // drawn only, so the overhang takes no taps.
    const seat = classOf(row, '[data-children-chevron]')
    expect(seat).toContain('dshx:pointer-coarse:-mr-2')
    expect(seat).toContain('dshx:pointer-events-none')
    // Line 2 keeps the toggle's 44pt clear of its words.
    expect(classOf(row, '[data-thread-where]')).toContain('dshx:pointer-coarse:pr-11')
  })

  it('gives every row one title-to-meta pitch: an 18px title line, 6px, a 16px line 2', async () => {
    for (const props of [
      {},
      waiting,
      { workStatus: rowStatus({ status: 'needs-you', verb: 'Answer', detail: 'Asks: Which layout?' }) },
      { workStatus: rowStatus({ status: 'failed', verb: 'Retry', detail: 'Turn failed' }) },
    ]) {
      const row = await renderRow(props)
      const button = classOf(row, '[data-thread-main-action]')
      expect(button).toContain('dshx:pointer-coarse:py-1.5')
      expect(button).toContain('dshx:pointer-coarse:gap-1.5')
      const title = classOf(row, '[data-thread-title]')
      expect(title.includes('dshx:text-sm/[18px]') || title.includes('dshx:pointer-coarse:leading-[18px]')).toBe(true)
      const where = classOf(row, '[data-thread-where]')
      expect(where).toContain('dshx:pointer-coarse:h-4')
      expect(where).toContain('dshx:pointer-coarse:text-xs/4')
      // The verb no longer stretches line 2 to 28px: it centres on the 16px line instead.
      expect(where).not.toContain('dshx:pointer-coarse:min-h-7')
      const end = row.querySelector<HTMLElement>('[data-thread-row-end]')
      if (end !== null) expect(end.className).toContain('dshx:pointer-coarse:bottom-0')
      cleanup()
    }
  })

  it('keeps a subagent child row on the same pitch: a 28px line 1 and 1px to its 16px line 2', async () => {
    const child = rowSession({
      id: SessionId('child-1'),
      parentId: SessionId('s1'),
      origin: 'subagent',
      projectionValues: { threadSidebarModelRoute: 'dshx_fake_commandcode/gpt-6-luna', subagent: { mode: 'continuable', label: 'Audit', seq: SessionSeq(3) } },
    })
    for (const density of ['compact', 'comfortable'] as const) {
      const row = await renderRow({ childThreads: [child], childrenOpen: true, allChildrenShown: true, rowStyle: { ...rowProps().rowStyle, time: false, density } })
      expect(classOf(row, 'ul [data-thread-main-action]')).toContain('dshx:pointer-coarse:gap-px')
      // A compact list's 24px head measured a 21pt pitch at 390pt: on touch the head is 28px whatever the density.
      expect(classOf(row, 'ul [data-thread-child-head]')).toContain('dshx:pointer-coarse:h-7')
      cleanup()
    }
  })
})
