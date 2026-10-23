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
  backlog: 'Backlog',
  backlogPlaceholder: 'Capture an item…',
  backlogOpen: 'Open capture composer',
  backlogUnavailable: 'Install Backlog to capture this draft.',
  recent: 'Recent',
  threads: 'Threads',
  threadSectionAll: 'All',
  threadSectionLabels: { pinned: 'Pinned', active: 'Active', parked: 'Parked', inactive: 'Inactive', settled: 'Settled' },
  threadDateLabel: 'Updated',
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
  searchLabel: 'Search the command palette',
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
  ask: 'Ask DSH',
  askPlaceholder: 'Ask DSH anything…',
  askHint: 'Tab opens Ask DSH on an empty search',
  askEmpty: 'Type a question about DSH, then press Enter.',
  askPending: 'Sending your question…',
  askSend: 'Send question',
  askExit: 'Back to search',
  askFailed: 'Ask DSH could not send that question.',
}

const context: PaletteActionContext = {
  thread: null,
  workspace: null,
  workspaces: [],
  themePreference: 'system',
}

const mount = (onAsk: (question: string) => Promise<void> = vi.fn(async () => {}), onBacklogCapture: (text: string) => boolean = vi.fn(() => true)) => {
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
      onAsk={onAsk}
      onBacklogCapture={onBacklogCapture}
      onOpenThread={vi.fn()}
      onClose={onClose}
    />,
  )
  return { onAsk, onClose }
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
    const { onClose } = mount()
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
    const { onClose } = mount()
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

  it('routes the < prefix to Backlog and carries capture text into its composer', async () => {
    const capture = vi.fn(() => true)
    const { onClose } = mount(
      vi.fn(async () => {}),
      capture,
    )
    const input = screen.getByRole<HTMLInputElement>('combobox')
    fireEvent.change(input, { target: { value: '<bug: screenshot needs updating' } })

    const row = await screen.findByRole('option', { name: /Open capture composer: bug: screenshot needs updating/ })
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    expect(capture).toHaveBeenCalledWith('bug: screenshot needs updating')
    expect(screen.queryByRole('tab', { name: 'Backlog' })).toBeNull()
    expect(row).toBeTruthy()
  })

  it('keeps the draft open and explains the missing Backlog plugin', async () => {
    const { onClose } = mount(
      vi.fn(async () => {}),
      () => false,
    )
    const input = screen.getByRole<HTMLInputElement>('combobox')
    fireEvent.change(input, { target: { value: '<bug: keep this draft' } })
    await screen.findByRole('option', { name: /Open capture composer: bug: keep this draft/ })

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })

    expect(await screen.findByText('Install Backlog to capture this draft.')).toBeTruthy()
    expect(input.value).toBe('<bug: keep this draft')
    expect(onClose).not.toHaveBeenCalled()
  })

  it('closes the palette when Escape backs out at the root', async () => {
    const { onClose } = mount()
    const input = screen.getByRole<HTMLInputElement>('combobox')
    input.focus()

    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' })

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
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
    const { onClose } = mount()
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

describe('Ask DSH', () => {
  it('opens on Tab from an empty search and returns to search on Escape', async () => {
    const { onAsk } = mount()
    const input = screen.getByRole<HTMLInputElement>('combobox')
    expect(input.getAttribute('placeholder')).toBe('Search everything…')

    fireEvent.keyDown(input, { key: 'Tab', code: 'Tab' })
    await waitFor(() => expect(input.getAttribute('placeholder')).toBe('Ask DSH anything…'))
    expect(screen.getByText('Type a question about DSH, then press Enter.')).toBeTruthy()

    fireEvent.keyDown(input, { key: 'Escape', code: 'Escape' })
    await waitFor(() => expect(input.getAttribute('placeholder')).toBe('Search everything…'))
    expect(onAsk).not.toHaveBeenCalled()
  })

  it('sends the typed question through the palette and closes on success', async () => {
    const ask = vi.fn(async () => {})
    const { onClose } = mount(ask)
    const input = screen.getByRole<HTMLInputElement>('combobox')
    fireEvent.keyDown(input, { key: 'Tab', code: 'Tab' })
    fireEvent.change(input, { target: { value: 'how do I rebind a shortcut?' } })

    const row = await screen.findByRole('option', { name: 'Ask DSH: how do I rebind a shortcut?' })
    fireEvent.click(row)

    await waitFor(() => expect(ask).toHaveBeenCalledWith('how do I rebind a shortcut?'))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('keeps the question and explains a failed send', async () => {
    const ask = vi.fn(async () => {
      throw new Error('no model')
    })
    const { onClose } = mount(ask)
    const input = screen.getByRole<HTMLInputElement>('combobox')
    fireEvent.keyDown(input, { key: 'Tab', code: 'Tab' })
    fireEvent.change(input, { target: { value: 'what does the backlog plugin do?' } })

    fireEvent.click(await screen.findByRole('option', { name: 'Ask DSH: what does the backlog plugin do?' }))

    expect(await screen.findByText('Ask DSH could not send that question.')).toBeTruthy()
    expect(input.value).toBe('what does the backlog plugin do?')
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('Ask DSH keyboard submit', () => {
  it('sends the question on Enter once a row is active', async () => {
    const ask = vi.fn(async () => {})
    mount(ask)
    const input = screen.getByRole<HTMLInputElement>('combobox')
    fireEvent.keyDown(input, { key: 'Tab', code: 'Tab' })
    fireEvent.change(input, { target: { value: 'how do I rebind a shortcut?' } })
    await screen.findByRole('option', { name: 'Ask DSH: how do I rebind a shortcut?' })

    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' })
    await waitFor(() => expect(ask).toHaveBeenCalledWith('how do I rebind a shortcut?'))
  })
})

describe('Threads tab project scope', () => {
  const here = { id: 'session-here', title: 'Here work', project: 'dshfiles', cwd: '/dev/dshfiles', updatedAt: 2 }
  const elsewhere = { id: 'session-elsewhere', title: 'Elsewhere work', project: 'welii', cwd: '/dev/welii', updatedAt: 1, section: 'parked' as const }
  const archived = { id: 'session-archived', title: 'Archived work', project: 'welii', cwd: '/dev/welii', updatedAt: 1, section: 'archived' as const }

  it('shows sidebar section and update date on content-search results', async () => {
    const searchContent = vi.fn(async () => [
      {
        sessionId: 'session-content',
        title: 'Content result',
        project: 'dshfiles',
        cwd: '/dev/dshfiles',
        updatedAt: 1_704_067_200_000,
        snippet: 'needle in the thread body',
      },
    ])
    render(
      <ThreadPalette
        mode="all"
        threads={[]}
        threadSections={new Map([['session-content', 'parked']])}
        context={context}
        additionalActions={[]}
        recentLimit={6}
        mac
        copy={copy}
        searchContent={searchContent}
        onAsk={vi.fn(async () => {})}
        onOpenThread={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByRole('combobox'), { target: { value: '#needle' } })
    const result = await screen.findByRole('option', { name: /needle in the thread body/ })
    expect(result.textContent).toContain('Parked')
    expect(result.textContent).toContain('Updated:')
    expect(searchContent).toHaveBeenCalledWith('needle', expect.any(AbortSignal))
  })

  it('filters threads by sidebar section and shows their update date', async () => {
    render(
      <ThreadPalette
        mode="threads"
        threads={[here, elsewhere, archived]}
        context={context}
        additionalActions={[]}
        recentLimit={6}
        mac
        copy={copy}
        searchContent={null}
        onAsk={vi.fn(async () => {})}
        onOpenThread={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    await screen.findByRole('option', { name: /Elsewhere work/ })
    expect(screen.queryByRole('option', { name: /Archived work/ })).toBeNull()
    expect(screen.getAllByRole('option', { name: /Updated:/ })).toHaveLength(2)
    fireEvent.click(screen.getByRole('tab', { name: 'Parked' }))
    await screen.findByRole('option', { name: /Elsewhere work/ })
    await waitFor(() => expect(screen.queryByRole('option', { name: /Here work/ })).toBeNull())
  })

  it('lists only the current project on Threads and every project on Everything', async () => {
    const view = (mode: 'all' | 'threads') =>
      render(
        <ThreadPalette
          mode={mode}
          threads={[here, elsewhere, archived]}
          projectThreads={[here]}
          context={context}
          additionalActions={[]}
          recentLimit={6}
          mac
          copy={copy}
          searchContent={null}
          onAsk={vi.fn(async () => {})}
          onBacklogCapture={vi.fn()}
          onOpenThread={vi.fn()}
          onClose={vi.fn()}
        />,
      )
    view('threads')
    await screen.findByRole('option', { name: /Here work/ })
    expect(screen.queryByRole('option', { name: /Elsewhere work/ })).toBeNull()
    cleanup()
    view('all')
    await screen.findByRole('option', { name: /Elsewhere work/ })
    expect(screen.getByRole('option', { name: /Here work/ })).toBeTruthy()
  })
})
