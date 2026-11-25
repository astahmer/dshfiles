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

  it('keeps the title and time on line 1 and puts Answer at line 2\'s trailing edge on its attention tint', async () => {
    const row = await renderRow(asking)
    const verb = row.querySelector<HTMLElement>('[data-testid="thread-row-verb"]')
    expect(verb?.closest('[data-verb-seat]')?.getAttribute('data-verb-seat')).toBe('meta')
    expect(verb?.getAttribute('data-variant')).toBe('attention')
    // 24px drawn; the kit gives it a 44px hit area on touch, painted above the row after it.
    expect(verb?.className).toContain('dshx:h-6')
    expect(verb?.className).toContain('dshx:z-10')
    // Line 1 is the title at full width and the time: no verb seat there any more.
    expect(row.querySelector('[data-thread-time]')?.textContent).toBe('7m')
    expect(row.querySelector('[data-thread-head]')?.className).not.toContain('dshx:pr-17.5')
    // Line 2 keeps the verb's width at its end; the question takes the rest.
    expect(row.querySelector('[data-thread-where]')?.className).toContain('dshx:pr-17.5')
    expect(row.querySelector('[data-testid="thread-row-status-detail"]')?.className).toContain('dshx:flex-1')
    expect(row.querySelector('[data-testid="thread-row-project"]')).toBeNull()
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

  it('gives a failed row\'s verb the danger tint', async () => {
    const row = await renderRow({ workStatus: rowStatus({ status: 'failed', verb: 'Retry', detail: 'Turn failed' }) })
    expect(row.querySelector('[data-testid="thread-row-verb"]')?.getAttribute('data-variant')).toBe('danger-tint')
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

  it('keeps the question readable beside a subagent counter', async () => {
    // The verb and the counter share line 2's end; the question keeps the rest of the line.
    const children = ['c1', 'c2', 'c3'].map(id => rowSession({ id: SessionId(id), parentId: SessionId('session-1'), origin: 'subagent' }))
    const row = await renderRow({ ...asking, childThreads: children })
    const end = row.querySelector('[data-thread-row-end]')
    expect(end?.querySelector('[data-testid="thread-row-verb"]')).not.toBeNull()
    expect(end?.querySelector('[data-thread-children-toggle]')).not.toBeNull()
    expect(row.querySelector('[data-thread-where]')?.className).toContain('dshx:pr-34')
  })

  it('keeps the attention verb to Needs-you and Failed rows: a Ready row carries no Land button', async () => {
    const row = await renderRow({
      workStatus: rowStatus({ status: 'ready', verb: 'Land' }),
      projectMark: false,
    })
    expect(row.querySelector('[data-testid="thread-row-verb"]')).toBeNull()
    expect(row.querySelector('[data-thread-head]')?.className).not.toContain('dshx:pr-17.5')
  })

  it('lets the question take two lines and keeps a failed reason to one (round five B4)', async () => {
    const row = await renderRow(asking)
    const detail = row.querySelector<HTMLElement>('[data-testid="thread-row-status-detail"]')
    expect(detail?.className).toContain('dshx:line-clamp-2')
    expect(detail?.className).not.toContain('dshx:truncate')
    expect(row.querySelector('[data-thread-where]')?.className).toContain('dshx:items-start')
    cleanup()
    const failed = await renderRow({ workStatus: rowStatus({ status: 'failed', detail: 'Turn failed' }) })
    expect(failed.querySelector('[data-testid="thread-row-status-detail"]')?.className).toContain('dshx:truncate')
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

  it('drops the truncated name when line 2 carries a reason, and names the tile instead', async () => {
    const row = await renderRow({ workStatus: rowStatus({ status: 'failed', detail: 'Turn failed' }) })
    expect(row.querySelector('[data-testid="thread-row-project"]')).toBeNull()
    expect(row.querySelector('[data-slot="project-mark"]')?.getAttribute('aria-label')).toBe('sample')
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
    const detail = row.querySelector('[data-testid="thread-row-status-detail"]')
    expect(detail?.textContent).toBe('Waiting on 1 subagent')
    // No project name follows a reason any more, so the reason takes the line instead of 60% of it.
    expect(detail?.className).toContain('dshx:flex-1')
    expect(detail?.className).not.toContain('dshx:max-w-[60%]')
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
})
