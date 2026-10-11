// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { PaletteActionContext } from './palette-api.js'
import { ThreadPalette, type ThreadPaletteCopy } from './thread-palette.js'

const copy: ThreadPaletteCopy = {
  title: 'Command palette',
  threadsPlaceholder: 'Search threads…',
  allPlaceholder: 'Search everything…',
  filesPlaceholder: 'Search files…',
  recent: 'Recent',
  threads: 'Threads',
  destinations: 'Destinations',
  commands: 'Commands',
  files: 'Files',
  goToFile: 'Go to file',
  filesIndexing: 'Indexing files…',
  filesTruncated: 'File results truncated.',
  filesNoSession: 'Files need a session.',
  filesUnavailable: 'Files unavailable.',
  empty: 'No matches.',
  navigate: 'Navigate',
  open: 'Open',
  close: 'Close palette',
  clear: 'Clear search',
  back: 'Back',
  searchIn: 'Search in',
  sessionNotFound: 'Session {id} was not found.',
  unassigned: 'Unassigned',
  prefixHint: 'Type ? for prefixes',
  viewAll: 'Everything',
  viewCommands: 'Commands',
  viewContent: 'Thread content',
  viewLine: 'Go to line',
  viewHelp: 'Prefix help',
  commandsPlaceholder: 'Search commands…',
  contentPlaceholder: 'Search content…',
  linePlaceholder: 'Go to line…',
  helpPlaceholder: 'Browse prefixes…',
  helpCommands: 'Search commands',
  helpContent: 'Search content',
  helpLine: 'Go to a line',
  helpSession: 'Search by session ID or link',
  helpThread: 'Search thread titles, projects, or IDs',
  helpNone: 'Search everything',
  goToLine: 'Go to line',
  noEditorFile: 'No editor file.',
  contentSearching: 'Searching thread content…',
  contentUnavailable: 'Thread content is unavailable.',
  actionFailed: 'Action failed.',
}

const context: PaletteActionContext = {
  thread: null,
  workspace: null,
  workspaces: [],
  themePreference: 'system',
}

const mount = () => {
  const onClose = vi.fn()
  render(
    <ThreadPalette
      mode="all"
      threads={[]}
      context={context}
      additionalActions={[]}
      recentLimit={6}
      mac
      copy={copy}
      searchContent={null}
      onOpenThread={vi.fn()}
      onClose={onClose}
    />,
  )
  return onClose
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ThreadPalette navigation', () => {
  it('backs out of a thread prefix before clearing the query', async () => {
    const onClose = mount()
    expect(screen.getByRole('tab', { name: 'Everything' })).toBeTruthy()
    const threadsTab = screen.getByRole('tab', { name: 'Threads' })
    expect(screen.getByRole('tab', { name: 'Files' })).toBeTruthy()
    fireEvent.mouseDown(threadsTab, { button: 0 })
    fireEvent.click(threadsTab)
    expect(threadsTab.getAttribute('aria-selected')).toBe('true')

    const input = screen.getByRole<HTMLInputElement>('combobox')
    input.focus()
    fireEvent.change(input, { target: { value: 'thread:session-missing' } })
    expect(await screen.findByRole('button', { name: 'Back' })).toBeTruthy()
    expect(await screen.findByText('Session session-missing was not found.')).toBeTruthy()

    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(input.value).toBe('session-missing'))
    expect(threadsTab.getAttribute('aria-selected')).toBe('true')
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(input.value).toBe(''))
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })

  it('returns to the parent query when the Back button is clicked', async () => {
    const onClose = mount()
    const input = screen.getByRole<HTMLInputElement>('combobox')
    input.focus()
    fireEvent.change(input, { target: { value: 'thread:session-missing' } })
    const backButton = await screen.findByRole('button', { name: 'Back' })

    fireEvent.click(backButton)

    await waitFor(() => expect(input.value).toBe('session-missing'))
    expect(screen.getByRole('tab', { name: 'Everything' }).getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(input)
    expect(onClose).not.toHaveBeenCalled()
  })
})
