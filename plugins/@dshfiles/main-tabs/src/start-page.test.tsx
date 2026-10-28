import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { MainTabsTranslate } from './locales.js'
import { StartPage, type StartSection } from './start-page.js'

const t: MainTabsTranslate = key => {
  if (key === 'startLabel') return 'Open in this tab'
  if (key === 'startSearch') return 'Search tabs and panels'
  if (key === 'startSearchPlaceholder') return 'What do you want to open?'
  if (key === 'startNoResults') return 'No matching results.'
  return key
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const makeSections = (picks: { readonly thread: () => void; readonly panel: () => void }): StartSection[] => [
  {
    id: 'threads',
    column: 'threads',
    suggestions: [{ id: 'thread', title: 'New thread', description: 'Start a conversation', icon: 'T', shortcut: undefined, pick: picks.thread }],
  },
  {
    id: 'panels',
    column: 'panels',
    suggestions: [{ id: 'panel', title: 'Jujutsu', description: 'Review revisions', icon: 'J', shortcut: undefined, pick: picks.panel }],
  },
]

describe('StartPage', () => {
  it('focuses a searchable input, filters suggestions, and picks the active result', () => {
    const pickThread = vi.fn()
    const pickPanel = vi.fn()
    render(<StartPage sections={makeSections({ thread: pickThread, panel: pickPanel })} t={t} />)

    const input = screen.getByRole('combobox', { name: 'Search tabs and panels' })
    expect(document.activeElement).toBe(input)
    expect(screen.getAllByRole('option')).toHaveLength(2)

    fireEvent.change(input, { target: { value: 'revisions' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByRole('option', { name: 'Jujutsu, Review revisions' }).getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(input, { key: 'Enter' })
    expect(pickPanel).toHaveBeenCalledOnce()
    expect(pickThread).not.toHaveBeenCalled()
  })

  it('focuses only after its connected Dockview-style overlay is revealed and keeps later user focus', async () => {
    const overlay = document.createElement('div')
    overlay.style.visibility = 'hidden'
    document.body.append(overlay)
    const view = render(<StartPage sections={makeSections({ thread: vi.fn(), panel: vi.fn() })} t={t} />, { container: overlay })
    const input = view.container.querySelector('input')
    if (input === null) throw new Error('Start search is missing')
    expect(document.activeElement).not.toBe(input)
    overlay.style.visibility = ''
    await waitFor(() => expect(document.activeElement).toBe(input))
    const elsewhere = document.createElement('button')
    document.body.append(elsewhere)
    elsewhere.focus()
    overlay.className = 'metadata-update'
    await new Promise<void>(resolve => queueMicrotask(resolve))
    expect(document.activeElement).toBe(elsewhere)
    elsewhere.remove()
  })

  it('waits for detached renderer attachment and focuses again when a retained Start panel is revealed', async () => {
    const overlay = document.createElement('div')
    const view = render(<StartPage sections={makeSections({ thread: vi.fn(), panel: vi.fn() })} t={t} />, { container: overlay })
    const input = view.container.querySelector('input')
    document.body.append(overlay)
    await waitFor(() => expect(document.activeElement).toBe(input))
    overlay.style.visibility = 'hidden'
    await new Promise<void>(resolve => queueMicrotask(resolve))
    const elsewhere = document.createElement('button')
    document.body.append(elsewhere)
    elsewhere.focus()
    overlay.style.visibility = ''
    await waitFor(() => expect(document.activeElement).toBe(input))
    elsewhere.remove()
  })

  it('disposes a pending reveal watcher when Start unmounts', async () => {
    const overlay = document.createElement('div')
    overlay.style.visibility = 'hidden'
    document.body.append(overlay)
    const view = render(<StartPage sections={makeSections({ thread: vi.fn(), panel: vi.fn() })} t={t} />, { container: overlay })
    const input = view.container.querySelector('input')
    if (input === null) throw new Error('Start search is missing')
    const focus = vi.spyOn(input, 'focus')
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect')
    disconnect.mockClear()
    view.unmount()
    expect(disconnect).toHaveBeenCalledTimes(1)
    overlay.style.visibility = ''
    await new Promise<void>(resolve => queueMicrotask(resolve))
    expect(focus).not.toHaveBeenCalled()
  })

  it('reports when the filter has no matches', () => {
    render(<StartPage sections={makeSections({ thread: vi.fn(), panel: vi.fn() })} t={t} />)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'missing' } })
    expect(screen.queryAllByRole('option')).toHaveLength(0)
    expect(screen.getByRole('status').textContent).toBe('No matching results.')
  })
})
