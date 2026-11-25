// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { PaletteApi } from './palette-api.js'
import type { PaletteActionContext } from './palette-contract.js'
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
  working: 'Working',
  idle: 'Idle',
  prefixHint: 'Prefixes',
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
  contentStatusRunning: 'Running',
  contentStatusFinished: 'Finished',
  contentStatusLive: 'Live',
  contentStatusSaved: 'Saved',
  actionFailed: 'Action failed.',
  ask: 'Ask DSH',
  askPlaceholder: 'Ask DSH anything…',
  askHint: 'Tab opens Ask DSH on an empty search',
  askEmpty: 'Type a question about DSH, then press Enter.',
  askPending: 'Sending your question…',
  askSend: 'Send question',
  askExit: 'Back to search',
  cancel: 'Cancel',
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

describe('ThreadPalette frame (council round 3 B5)', () => {
  it('keeps a 16 px outer inset, a 16 px query line and the kit dialog surface', () => {
    mount()
    const dialog = screen.getByRole('dialog')
    // The kit dialog's 24 px sm: padding read as a loose frame: 16 px on every side.
    expect(dialog.className).toContain('dshx:p-4!')
    expect(dialog.className).toContain('dshx:phone:p-0!')
    // The kit's floating surface (kit A8) draws the fill, edge and shadow: the palette sets none of its own.
    expect(dialog.className).toContain('dshx:surface-dialog')
    expect(dialog.className).not.toContain('dshx:dark:bg-(--dshx-tone-raised)')
    expect(dialog.className).not.toContain('dshx:shadow-s3')
    const query = screen.getByRole('combobox')
    expect(query.className).toContain('dshx:text-base')
    expect(query.className).not.toContain('dshx:text-sm')
  })
})

describe('ThreadPalette ways out', () => {
  it('returns focus to what was focused when it opened', async () => {
    const row = document.createElement('button')
    row.textContent = 'A thread row'
    document.body.append(row)
    row.focus()
    const view = render(
      <ThreadPalette
        mode="all"
        threads={[]}
        context={context}
        additionalActions={[]}
        recentLimit={6}
        mac
        copy={copy}
        searchContent={null}
        onAsk={vi.fn(async () => {})}
        onBacklogCapture={vi.fn(() => true)}
        onOpenThread={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    await waitFor(() => expect(document.activeElement).not.toBe(row))
    view.unmount()
    await waitFor(() => expect(document.activeElement).toBe(row))
    row.remove()
  })

  it('offers Cancel in its first row, which closes it', () => {
    const { onClose } = mount()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
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
  const here = { id: 'session-here', title: 'Here work', project: 'dshfiles', cwd: '/dev/dshfiles', updatedAt: 2, running: true }
  const elsewhere = { id: 'session-elsewhere', title: 'Elsewhere work', project: 'welii', cwd: '/dev/welii', updatedAt: 1 }

  it('retries empty content results when fresh Host activity updates the thread list', async () => {
    let attempts = 0
    const searchContent = vi.fn(async () => {
      attempts += 1
      if (attempts === 1) return []
      return [{ sessionId: 'session-fresh', snippet: 'fresh marker' }]
    })
    const palette = (updatedAt: number) => (
      <ThreadPalette
        mode="all"
        threads={[{ id: 'session-fresh', title: 'Fresh thread', project: 'dshfiles', cwd: '/dev/dshfiles', updatedAt }]}
        context={context}
        additionalActions={[]}
        recentLimit={6}
        mac
        copy={copy}
        searchContent={searchContent}
        onBacklogCapture={vi.fn(() => true)}
        onAsk={vi.fn(async () => {})}
        onOpenThread={vi.fn()}
        onClose={vi.fn()}
      />
    )
    const view = render(palette(1))
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '#fresh marker' } })
    await waitFor(() => expect(searchContent).toHaveBeenCalledTimes(1))
    await screen.findByText('No matches.', { exact: true })

    view.rerender(palette(2))
    await screen.findByRole('option', { name: /fresh marker/ })
    expect(searchContent).toHaveBeenCalledTimes(2)
  })

  it('shows content-hit metadata without repeating a title used as the snippet prefix', async () => {
    const thread = {
      id: 'session-result',
      title: 'Title from the thread',
      project: '/work/dshfiles',
      cwd: '/work/dshfiles',
      updatedAt: Date.UTC(2026, 9, 25),
      running: true,
    }
    render(
      <ThreadPalette
        mode="all"
        threads={[thread]}
        context={context}
        additionalActions={[]}
        recentLimit={6}
        mac
        copy={copy}
        searchContent={async () => [{ sessionId: thread.id, snippet: 'Title from the thread — useful excerpt' }]}
        onBacklogCapture={vi.fn()}
        onAsk={vi.fn(async () => {})}
        onOpenThread={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '#excerpt' } })

    const result = await screen.findByRole('option', { name: /dshfiles.*2026-10-25.*Running.*useful excerpt/ })

    expect(result.textContent?.match(/Title from the thread/gu)).toHaveLength(1)
    expect(result.textContent).toContain('dshfiles')
    expect(result.textContent).toContain('2026-10-25')
    expect(result.textContent).toContain('Running')
    expect(result.textContent).toContain('useful excerpt')
  })

  it('does not render native content hits that are not in the top-level thread list', async () => {
    let releaseSearch: ((hits: readonly { readonly sessionId: string; readonly snippet: string }[]) => void) | undefined
    const searchContent = vi.fn(
      () =>
        new Promise<readonly { readonly sessionId: string; readonly snippet: string }[]>(resolve => {
          releaseSearch = resolve
        }),
    )
    render(
      <ThreadPalette
        mode="all"
        threads={[{ id: 'session-parent', title: 'Parent thread', project: 'dshfiles', cwd: '/dev/dshfiles', updatedAt: 2 }]}
        context={context}
        additionalActions={[]}
        recentLimit={6}
        mac
        copy={copy}
        searchContent={searchContent}
        onBacklogCapture={vi.fn()}
        onAsk={vi.fn(async () => {})}
        onOpenThread={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    fireEvent.change(screen.getByRole('combobox'), { target: { value: '#subagent-only' } })

    await screen.findByText(copy.contentSearching, { exact: true })
    if (releaseSearch === undefined) throw new Error('Native content search did not start')
    releaseSearch([{ sessionId: 'session-subagent', snippet: 'subagent-only excerpt' }])
    await screen.findByText(copy.empty, { exact: true })
    expect(searchContent).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('subagent-only excerpt')).toBeNull()
  })

  it('shows project, date, and status without the absolute workspace path', async () => {
    render(
      <ThreadPalette
        mode="all"
        threads={[{ ...here, updatedAt: new Date(2026, 9, 30).getTime() }]}
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

    const result = await screen.findByRole('option', { name: /Here work/ })
    expect(result.textContent).toContain('dshfiles')
    expect(result.textContent).toContain('2026')
    expect(result.textContent).toContain('Working')
    expect(result.textContent).not.toContain('/dev/dshfiles')
  })

  it('draws each project as the thread list\'s ProjectMark tile, in the colour the list gives that project', async () => {
    const colorOf = vi.fn((thread: { readonly project: string }) =>
      thread.project === 'dshfiles' ? { className: 'project-tone-balanced-3', tone: 3 } : { color: '#ffd400' },
    )
    render(
      <ThreadPalette
        mode="all"
        threads={[here, elsewhere, { id: 'session-loose', title: 'Loose work', project: '', cwd: '', updatedAt: 0 }]}
        projectColorOf={colorOf}
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
    const markOf = async (name: RegExp) => (await screen.findByRole('option', { name })).querySelector<HTMLElement>('[data-palette-project-mark]')
    const tone = await markOf(/Here work/)
    expect(tone?.getAttribute('data-slot')).toBe('project-mark')
    expect(tone?.className).toContain('project-tone-balanced-3')
    // The sidebar's letters: first letters of two words, else the first two letters.
    expect(tone?.textContent).toBe('DS')
    const custom = await markOf(/Elsewhere work/)
    // A picked colour stays readable: the tile clamps its lightness per scheme instead of painting the raw pick.
    expect(custom?.style.getPropertyValue('--chip')).toBe('#ffd400')
    expect(custom?.style.getPropertyValue('--chip-light')).toBe('oklch(from var(--chip) min(l, 0.52) c h)')
    expect(custom?.style.color).toBe('var(--chip-clamped)')
    expect(custom?.className).toContain('dshx:[--chip-clamped:var(--chip-light)]')
    const loose = await markOf(/Loose work/)
    expect(loose?.className).toContain('dshx:bg-muted')
    expect(colorOf).not.toHaveBeenCalledWith(expect.objectContaining({ id: 'session-loose' }))
  })

  it('uses two-word letters the way the sidebar does (billing-api is BA, not BI)', async () => {
    render(
      <ThreadPalette
        mode="all"
        threads={[{ ...here, project: 'billing-api' }]}
        projectColorOf={() => ({ tone: 0 })}
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
    const mark = (await screen.findByRole('option', { name: /Here work/ })).querySelector<HTMLElement>('[data-palette-project-mark]')
    expect(mark?.textContent).toBe('BA')
  })

  it('keeps project marks neutral when nothing provides project colours', async () => {
    render(
      <ThreadPalette
        mode="all"
        threads={[here]}
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
    const mark = (await screen.findByRole('option', { name: /Here work/ })).querySelector<HTMLElement>('[data-palette-project-mark]')
    expect(mark?.getAttribute('data-slot')).toBe('project-mark')
    expect(mark?.className).not.toMatch(/project-tone-/u)
    expect(mark?.style.color).toBe('currentcolor')
  })

  it('lists only the current project on Threads and every project on Everything', async () => {
    const view = (mode: 'all' | 'threads') =>
      render(
        <ThreadPalette
          mode={mode}
          threads={[here, elsewhere]}
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

describe('ThreadPalette thread actions and keycaps', () => {
  it('lists the thread the user is on first, under its heading, and shows the keys of every row as keycaps', async () => {
    const disposers = [
      PaletteApi.registerAction({
        id: '@journey/test/toggle',
        label: 'Toggle sidebar',
        group: 'command',
        keys: ['Mod+B'],
        suggested: true,
        run: () => undefined,
      }),
      PaletteApi.registerAction({
        id: '@journey/test/thread-done',
        label: 'Settle',
        group: 'thread',
        heading: () => 'Actions for “Fix auth callback”',
        keys: ['E'],
        run: () => undefined,
      }),
      PaletteApi.registerAction({
        id: '@journey/test/new',
        label: 'New thread',
        group: 'action',
        shortcutId: 'commandPalette.newThread',
        run: () => undefined,
      }),
    ]
    render(
      <ThreadPalette
        mode="all"
        threads={[]}
        context={context}
        additionalActions={[]}
        recentLimit={6}
        mac
        hostKeys={id => (id === 'commandPalette.newThread' ? ['⌘', '⇧', 'O'] : undefined)}
        copy={copy}
        searchContent={null}
        onAsk={vi.fn(async () => {})}
        onBacklogCapture={vi.fn(() => true)}
        onOpenThread={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const heading = await screen.findByText('Actions for “Fix auth callback”')
    const options = screen.getAllByRole('option')
    expect(options[0]?.textContent).toContain('Settle')
    expect(heading).toBeTruthy()
    const settle = options.find(option => option.textContent?.includes('Settle'))
    expect(settle?.querySelector('[data-slot="key-hint"]')?.getAttribute('aria-label')).toBe('E')
    const toggle = options.find(option => option.textContent?.includes('Toggle sidebar'))
    expect(toggle?.querySelector('[data-slot="key-hint"]')?.getAttribute('aria-label')).toBe('⌘B')
    const newThread = options.find(option => option.textContent?.includes('New thread'))
    expect(newThread?.textContent).toContain('⌘⇧O')
    for (const dispose of disposers) dispose()
  })
})

describe('ThreadPalette goes to threads', () => {
  const fakeThreads = [
    { id: 'session-fake-1', title: 'Fake provider seeds', project: 'dshfiles', cwd: '/dev/dshfiles', updatedAt: 3 },
    { id: 'session-fake-2', title: 'Fake child run', project: 'dshfiles', cwd: '/dev/dshfiles', updatedAt: 2 },
    { id: 'session-fake-3', title: 'Remove the fake clock', project: 'dshfiles', cwd: '/dev/dshfiles', updatedAt: 1 },
  ]
  const settingsAction = {
    id: '@journey/test/settings-projects',
    label: 'Settings: Projects',
    aliases: ['fake projects', 'workspaces'],
    group: 'destination' as const,
    run: () => undefined,
  }
  const palette = (input: { readonly threadStatusOf?: Parameters<typeof ThreadPalette>[0]['threadStatusOf'] } = {}) => (
    <ThreadPalette
      mode="all"
      threads={fakeThreads}
      {...(input.threadStatusOf === undefined ? {} : { threadStatusOf: input.threadStatusOf })}
      context={context}
      additionalActions={[settingsAction]}
      recentLimit={6}
      mac
      copy={copy}
      searchContent={null}
      onAsk={vi.fn(async () => {})}
      onBacklogCapture={vi.fn(() => true)}
      onOpenThread={vi.fn()}
      onClose={vi.fn()}
    />
  )

  it('orders groups by their best match, so a thread whose title matches comes before a command alias', async () => {
    // "fake" ranked Settings: Projects above three matching threads, so Enter opened Settings (F7).
    render(palette())
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'fake' } })
    await waitFor(() => expect(screen.getAllByRole('option')[0]?.textContent).toContain('Fake provider seeds'))
    expect(screen.getAllByRole('option').some(option => option.textContent?.includes('Settings: Projects'))).toBe(true)
  })

  it('leads with recent threads on an empty query', async () => {
    // The empty palette led with Go to file, Export and Import (F26).
    render(palette())
    await waitFor(() => expect(screen.getAllByRole('option')[0]?.textContent).toContain('Fake provider seeds'))
  })

  it('draws one ⌘N keycap per recent, shown on the highlighted row and under the pointer only (round five B6)', async () => {
    render(palette())
    const row = await screen.findByRole('option', { name: /Fake provider seeds/ })
    const caps = row.querySelectorAll('[data-slot="kbd"]')
    expect(caps).toHaveLength(1)
    expect(caps[0]?.textContent).toBe('⌘1')
    expect(caps[0]?.className).toContain('dshx:opacity-0')
    expect(caps[0]?.className).toContain('dshx:group-data-[selected=true]/item:opacity-100')
    expect(caps[0]?.className).toContain('dshx:group-hover/item:opacity-100')
    expect(row.className).toContain('dshx:group/item')
  })

  it("says a same-day recent's time in whole units, and draws the palette in one frame (round five B6)", async () => {
    const today = [{ id: 'session-today', title: 'Today work', project: 'dshfiles', cwd: '/dev/dshfiles', updatedAt: Date.now() - 2 * 60_000 - 5_000 }]
    render(
      <ThreadPalette
        mode="all"
        threads={today}
        context={context}
        additionalActions={[]}
        recentLimit={6}
        mac
        copy={copy}
        searchContent={null}
        onAsk={vi.fn(async () => {})}
        onBacklogCapture={vi.fn(() => true)}
        onOpenThread={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const row = await screen.findByRole('option', { name: /Today work/ })
    expect(row.textContent).toContain('dshfiles · 2m')
    expect(row.textContent).not.toContain(new Date().toLocaleDateString())
    const search = screen.getByRole('combobox').closest('[data-slot="command-input-wrapper"]')?.parentElement
    expect(search?.className).toContain('dshx:[&_[data-slot=command-input-wrapper]]:outline-none!')
    const dialog = document.querySelector('[data-slot="dialog-content"]')
    // One floating surface: the kit dialog's (council round 3 B5, kit A8).
    expect(dialog?.className).toContain('dshx:surface-dialog')
  })

  it("draws a thread's status with the list's glyph and word", async () => {
    // A thread that waits for an answer read "Working" here while the list said Needs you.
    render(palette({ threadStatusOf: thread => (thread.id === 'session-fake-2' ? { status: 'needs-you', label: 'Needs you' } : undefined) }))
    const row = await screen.findByRole('option', { name: /Fake child run/ })
    expect(row.querySelector('[data-slot="status-glyph"]')?.getAttribute('data-status')).toBe('needs-you')
    expect(row.textContent).toContain('Needs you')
    expect(row.textContent).not.toContain('Working')
    // The row's muted-icon rule must not grey the glyph: Needs you keeps its indigo, Failed its red.
    expect(row.querySelector('[data-slot="status-glyph"]')?.className).toContain('dshx:[&_svg]:text-current!')
  })

  it('replaces the clipped prefix legend with one "? Prefixes" hint that opens the prefix list', async () => {
    render(palette())
    const hint = await screen.findByRole('button', { name: /Prefixes/u })
    expect(hint.querySelector('[data-slot="kbd"]')?.textContent).toBe('?')
    fireEvent.click(hint)
    expect(screen.getByRole<HTMLInputElement>('combobox').value).toBe('?')
  })
})

describe('ThreadPalette on a phone (unslop phone 27)', () => {
  it('is a full-screen search sized to the visual viewport, with no key legend', async () => {
    // The software keyboard leaves 508px of an 844px screen; the palette ends where it starts.
    const listeners = new Map<string, () => void>()
    const viewport = {
      height: 508,
      offsetTop: 0,
      addEventListener: (type: string, listener: () => void) => listeners.set(type, listener),
      removeEventListener: (type: string) => listeners.delete(type),
    }
    vi.stubGlobal('visualViewport', viewport)
    mount()
    const dialog = screen.getByRole('dialog')
    expect(dialog.style.getPropertyValue('--palette-height')).toBe('508px')
    for (const phoneClass of ['dshx:phone:top-[var(--palette-top,0px)]', 'dshx:phone:h-[var(--palette-height,100dvh)]', 'dshx:phone:max-w-none!', 'dshx:phone:rounded-none']) {
      expect(dialog.className).toContain(phoneClass)
    }
    expect(dialog.querySelector('[data-slot="command-list"]')?.className).toContain('dshx:phone:max-h-none')
    viewport.height = 420
    act(() => listeners.get('resize')?.())
    expect(dialog.style.getPropertyValue('--palette-height')).toBe('420px')
    // The ↑ ↓ / Enter / Esc legend is marked for the kit's touch rule, which hides it on a coarse pointer.
    expect(screen.getByText('Navigate').closest('[data-key-legend]')).not.toBeNull()
    // The prefix hint is for a keyboard: a phone keeps that row for a notice or Ask DSH's status only.
    expect(screen.getByRole('button', { name: /Prefixes/u }).className).toContain('dshx:phone:hidden')
  })
})
