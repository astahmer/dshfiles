// @vitest-environment jsdom
import { cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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
