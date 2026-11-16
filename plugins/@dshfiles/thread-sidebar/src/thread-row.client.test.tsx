// @vitest-environment jsdom
import { cleanup, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from './organization.js'
import { renderRow, rowSession, rowStatus, VisibleObserver } from './thread-row.test-support.js'

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', VisibleObserver)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const whereLine = (row: HTMLElement): string => row.querySelector('[data-thread-where]')?.textContent ?? ''

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
    expect(row.querySelector('[data-thread-time]')?.textContent).toBe('7m 51s')
    // The static age would be a second, coarser reading of the same turn.
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

  it('seats Answer on the second line, so the title and the time keep the first', async () => {
    const row = await renderRow(asking)
    const verb = row.querySelector('[data-testid="thread-row-verb"]')
    expect(verb?.closest('[data-verb-seat]')?.getAttribute('data-verb-seat')).toBe('meta')
    expect(row.querySelector('[data-thread-time]')?.textContent).toBe('7m')
    expect(row.querySelector('[data-thread-main-action]')?.className).not.toContain('dshx:pr-20')
    // The question takes the rest of the second line: the project name gives way, its mark stays.
    expect(row.querySelector('[data-thread-where]')?.className).toContain('dshx:pr-20')
    expect(row.querySelector('[data-testid="thread-row-status-detail"]')?.className).not.toContain('dshx:max-w-[60%]')
    expect(row.querySelector('[data-testid="thread-row-project"]')).toBeNull()
  })

  it('keeps the verb beside the title on a row with no second line', async () => {
    const row = await renderRow({
      workStatus: rowStatus({ status: 'ready', verb: 'Land' }),
      projectMark: false,
    })
    expect(row.querySelector('[data-thread-where]')).toBeNull()
    expect(row.querySelector('[data-testid="thread-row-verb"]')?.closest('[data-verb-seat]')?.getAttribute('data-verb-seat')).toBe('head')
    expect(row.querySelector('[data-thread-main-action]')?.className).toContain('dshx:pr-20')
  })
})
