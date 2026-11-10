import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResourcePanelHost, createResourcePanelHost } from './resource-panel-host.js'
import { ThreadFacets } from './thread-facets.js'

afterEach(cleanup)

const openTabs = (initial: readonly string[] | undefined) => {
  let open = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => open,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: (next: readonly string[] | undefined) => {
      open = next
      for (const listener of listeners) listener()
    },
  }
}

describe('createResourcePanelHost', () => {
  it('shows a facet page as no thread once its thread tab closes, and its body again when the tab reopens', () => {
    const tabs = openTabs(['session-a'])
    const Panel = createResourcePanelHost({ subscribe: tabs.subscribe, shows: () => ThreadFacets.hasOpenTab('session-a', tabs.getSnapshot()) })
    render(<Panel panelId="session-a/jobs" />)
    expect(screen.queryByRole('status')).toBeNull()
    act(() => tabs.set([]))
    expect(screen.getByRole('status').textContent).toBe('Open a thread to show its panels here.')
    act(() => tabs.set(['session-b', 'session-a']))
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('keeps the body while the Workbench tabs do not own the main region', () => {
    expect(ThreadFacets.hasOpenTab('session-a', undefined)).toBe(true)
    expect(ThreadFacets.hasOpenTab('session-a', [])).toBe(false)
  })
})

describe('ResourcePanelHost', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('says so, with a way out, when the declared view never arrives', () => {
    vi.useFakeTimers()
    render(<ResourcePanelHost panelId="session-a/tab2" />)
    expect(screen.queryByRole('status')).toBeNull()
    act(() => vi.advanceTimersByTime(1000))
    expect(screen.getByRole('status').textContent).toBe('This panel has no view to show.')
    expect(screen.getByRole('button', { name: 'Close panel' })).toBeDefined()
  })

  it('drops the notice as soon as the declarer portals the view in', async () => {
    const { container } = render(<ResourcePanelHost panelId="session-a/tab2" />)
    await act(() => new Promise(resolve => globalThis.setTimeout(resolve, 1000)))
    expect(screen.getByRole('status')).toBeDefined()
    const host = container.querySelector('.dshx\\:relative > div')
    await act(async () => {
      host?.appendChild(document.createElement('section'))
      await Promise.resolve()
    })
    expect(screen.queryByRole('status')).toBeNull()
  })
})
