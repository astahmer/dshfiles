// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PaletteApi, type PaletteActionContext } from './palette-api.js'
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
  // jsdom has no layout; cmdk scrolls the active row into view.
  Element.prototype.scrollIntoView = vi.fn()
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

describe('ThreadPalette actions', () => {
  it('lists New thread once although four entries register it', () => {
    const disposers = [
      PaletteApi.registerAction({ id: '@dshfiles/command-palette/new-thread', label: 'New thread', group: 'action', run: vi.fn() }),
      PaletteApi.registerAction({ id: '@dshfiles/thread-sidebar/header/new-thread', label: () => 'New thread', group: 'destination', run: vi.fn() }),
      PaletteApi.registerAction({ id: '@dshfiles/thread-sidebar/command/commandPalette.newThread', label: 'New thread', group: 'command', run: vi.fn() }),
      PaletteApi.registerAction({ id: '@dshfiles/thread-sidebar/command/session.new', label: 'New Session', group: 'command', run: vi.fn() }),
    ]
    mount()
    expect(screen.getAllByRole('option', { name: /New (thread|Session)/ })).toHaveLength(1)
    disposers.forEach(dispose => dispose())
  })

  it('selects the first match while typing so Enter runs it', async () => {
    const run = vi.fn()
    const dispose = PaletteApi.registerAction({ id: '@dshfiles/test/zebra', label: 'Zebra mode', group: 'action', run })
    mount()
    const input = screen.getByRole<HTMLInputElement>('combobox')
    input.focus()
    fireEvent.change(input, { target: { value: 'zebra' } })
    await waitFor(() => expect(screen.getByRole('option', { name: /Zebra mode/ }).getAttribute('aria-selected')).toBe('true'))
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1))
    dispose()
  })

  it('shows action failure and retries through the action machine', async () => {
    let attempts = 0
    const dispose = PaletteApi.registerAction({
      id: '@dshfiles/test/retry',
      label: 'Retry action',
      group: 'action',
      run: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('controlled failure')
      },
    })
    const onClose = mount()
    const input = screen.getByRole<HTMLInputElement>('combobox')
    input.focus()
    fireEvent.change(input, { target: { value: 'retry' } })
    const option = await screen.findByRole('option', { name: /Retry action/ })
    await waitFor(() => expect(option.getAttribute('aria-selected')).toBe('true'))

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(screen.getByText(copy.actionFailed)).toBeTruthy())
    expect(attempts).toBe(1)

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(attempts).toBe(2)
    dispose()
  })
})
