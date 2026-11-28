// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { HeaderThreadActions } from './header-actions.js'
import { storedPreferences, PREFERENCES_STORAGE_KEY } from './preferences.js'
import { SidebarStateProvider } from './sidebar-state.js'
import { DEFAULT_PREFERENCES } from './organization.js'
import { ThreadViewsModel, type ThreadHeaderMenuAction } from '@dshfiles/rich-composer/thread-views'

const NATIVE_ACTIONS: readonly ThreadHeaderMenuAction[] = [
  { id: 'export/copy', label: 'Copy Session as Markdown', iconKey: 'session-log-download.copy' },
  { id: 'export/download', label: 'Download session log', iconKey: 'session-log-download.download' },
  {
    id: 'open/openWith',
    label: 'Open in',
    iconKey: 'open-in-app.application',
    separatorBefore: true,
    children: [{ id: 'open/openWith/app:zed', label: 'Zed', iconKey: 'open-in-app.application', iconSrc: '/icons/zed' }],
  },
  { id: 'feedback/feedback', label: 'Feedback', iconKey: 'session-log-download.feedback', separatorBefore: true },
]

const labels = {
  threadSidebarPin: 'Pin',
  threadSidebarUnpin: 'Unpin',
  threadSidebarPark: 'Snooze',
  threadSidebarUnpark: 'Unsnooze',
  threadSidebarArchive: 'Archive',
  threadSidebarRestore: 'Restore',
  threadSidebarSettle: 'Done',
  threadSidebarUnsettle: 'Restore from Done',
  threadSidebarOpenIn: 'Open in',
  threadSidebarCopy: 'Copy',
  threadSidebarMore: 'More',
  threadSidebarMute: 'Mute thread',
  threadSidebarMuted: 'Muted',
  threadSidebarMuteFor1Hour: 'For 1 hour',
  threadSidebarMuteFor8Hours: 'For 8 hours',
  threadSidebarMuteFor24Hours: 'For 24 hours',
  threadSidebarMuteUntilTomorrow: 'Until tomorrow morning',
  threadSidebarMuteFor1Week: 'For 1 week',
  threadSidebarMuteForever: 'Until I unmute it',
  threadSidebarUnmute: 'Unmute',
  threadSidebarActionFailure: 'Could not update thread',
  threadSidebarCopyId: 'Copy thread ID',
  threadSidebarCopyLink: 'Copy thread link',
  threadSidebarIdCopied: 'Thread ID copied.',
  threadSidebarLinkCopied: 'Thread link copied.',
  threadSidebarClipboardFailure: 'Could not access the clipboard.',
  threadSidebarThreadActions: 'Thread actions',
  threadSidebarMoreThreadActions: 'More thread actions',
  threadSidebarReferencedBy: 'Referenced by',
  threadSidebarFindInThread: 'Find in thread',
  threadSidebarTurns: 'Turns',
  threadSidebarContinueIn: 'Continue in project',
  threadSidebarCopyAsMarkdown: 'Copy thread as Markdown',
  threadSidebarDownloadLog: 'Download thread log',
} satisfies Readonly<Record<string, string>>

const NO_THREAD_DIRECTORIES: ReadonlyMap<string, string> = new Map()
const labelFor = (key: string): string => Object.entries(labels).find(([label]) => label === key)?.[1] ?? key

type ClusterResize = (entries: readonly { readonly contentRect: { readonly width: number } }[]) => void
const resizeCallbacks: ClusterResize[] = []
class RecordingResizeObserver {
  constructor(callback: ClusterResize) {
    resizeCallbacks.push(callback)
  }
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const mount = (options?: { archived?: boolean; blank?: boolean; running?: boolean; failPin?: boolean; nativeHeader?: boolean; pinned?: boolean }) => {
  const sessionId = SessionId('s1')
  const session: SessionSummary = {
    id: sessionId,
    title: 'Thread',
    displayTitle: 'Thread',
    cwd: '/workspace',
    updatedAt: 1,
    running: options?.running ?? false,
    blank: options?.blank ?? false,
    retainedBy: {},
  }
  const sessions: SessionListState = { ids: [sessionId], byId: { [sessionId]: session }, phase: 'ready', projectionsBySession: {} }
  const workspaces: WorkspaceSnapshot = {
    items: [],
    archivedSessionIds: options?.archived ? [sessionId] : [],
    pinnedSessionIds: options?.pinned ? [sessionId] : [],
    state: 'idle',
    phase: 'ready',
    error: null,
  }
  const pinSession = vi.fn(async () => {
    if (options?.failPin === true) throw new Error('pin failed')
  })
  const unpinSession = vi.fn(async () => {})
  const headerActionProps: Parameters<typeof HeaderThreadActions>[0] = {
    sessionId,
    useSessions: select => select(sessions),
    useWorkspaces: select => select(workspaces),
    archiveSession: vi.fn(async () => {}),
    unarchiveSession: vi.fn(async () => {}),
    pinSession,
    unpinSession,
    openThread: vi.fn(),
    continueInProject: vi.fn(async () => sessionId),
    useThreadDirectories: () => NO_THREAD_DIRECTORIES,
    t: key => labelFor(key),
  }
  const actions = (
    <SidebarStateProvider>
      <HeaderThreadActions {...headerActionProps} />
    </SidebarStateProvider>
  )
  const view = render(
    options?.nativeHeader === true ? (
      <div>
        <div>
          <nav>Thread</nav>
        </div>
        <div>{actions}</div>
        <div data-conversation-header-corner="" />
      </div>
    ) : (
      actions
    ),
  )
  return { ...view, pinSession, unpinSession }
}

const openMoreMenu = (): void => {
  fireEvent.keyDown(screen.getByRole('button', { name: 'More thread actions' }), { key: 'ArrowDown' })
}
/** Open one of the menu's submenus (Open in, Copy, More, or a submenu inside one) from the keyboard. */
const openSubmenu = (name: string): void => {
  fireEvent.keyDown(screen.getByRole('menuitem', { name }), { key: 'ArrowRight' })
}

beforeEach(() => {
  localStorage.clear()
  storedPreferences.remove()
  resizeCallbacks.length = 0
  vi.stubGlobal('ResizeObserver', RecordingResizeObserver)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('HeaderThreadActions', () => {
  it('draws one control in the header, the thread menu, which holds Pin, Snooze and Copy thread link', () => {
    const header = mount()
    // DESIGN.md: the thread header is one row with one ⋯; a verb goes into that menu, not beside it.
    expect(screen.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['More thread actions'])

    openMoreMenu()
    expect(screen.getAllByRole('menuitem', { name: 'Copy thread link' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin' }))
    expect(header.pinSession).toHaveBeenCalledWith('s1')

    openMoreMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Snooze' }))
    expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).not.toBeNull()
  })

  it('leads every row of the menu with an icon, so the labels share one column', () => {
    mount()
    openMoreMenu()
    const rows = screen.getAllByRole('menuitem')
    // The lifecycle verbs and the three most used ones, then one row per submenu: a short list, never the old 13 rows.
    expect(rows.map(row => row.textContent)).toEqual(['Find in threadCtrlF', 'Pin', 'Done', 'Snooze', 'Copy thread link', 'Open in', 'Copy', 'More'])
    expect(rows.filter(row => row.querySelector('svg, img') === null).map(row => row.textContent)).toEqual([])
    openSubmenu('More')
    const moreRows = screen.getAllByRole('menuitem').filter(row => !rows.includes(row))
    expect(moreRows.map(row => row.textContent)).toEqual(['Turns', 'Mute thread', 'Referenced by', 'Archive'])
    expect(moreRows.filter(row => row.querySelector('svg, img') === null).map(row => row.textContent)).toEqual([])
  })

  it("lists the header's own More actions in the same menu, and takes the second ⋯ off the header while it does", () => {
    const select = vi.fn()
    const dispose = vi.fn()
    const withdraw = ThreadViewsModel.provideHeaderMenu(() => ({
      subscribe: () => () => undefined,
      actions: () => NATIVE_ACTIONS,
      select,
      dispose,
    }))
    const header = mount()
    onTestFinished(withdraw)
    expect(ThreadViewsModel.headerMenuHosted()).toBe(true)
    openMoreMenu()
    // Thread wording for the two exports; an unknown action keeps the label its plugin gave it.
    openSubmenu('Copy')
    expect(screen.getByRole('menuitem', { name: 'Copy thread as Markdown' })).toBeTruthy()
    // The Host's own "Open in" list joins this menu's Open in instead of nesting a second one inside it.
    openSubmenu('Open in')
    expect(screen.getAllByRole('menuitem', { name: 'Open in' })).toHaveLength(1)
    expect(screen.getByRole('menuitem', { name: 'Zed' })).toBeTruthy()
    openSubmenu('More')
    expect(screen.getByRole('menuitem', { name: 'Feedback' })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download thread log' }))
    expect(select).toHaveBeenCalledWith('export/download')
    expect(dispose).toHaveBeenCalled()
    header.unmount()
    expect(ThreadViewsModel.headerMenuHosted()).toBe(false)
    withdraw()
  })

  it("does not claim the header's More actions when nothing can resolve them", () => {
    mount()
    expect(ThreadViewsModel.headerMenuHosted()).toBe(false)
  })

  it('snoozes the current thread until tomorrow morning, then offers Unmute', () => {
    mount()
    openMoreMenu()
    openSubmenu('More')
    openSubmenu('Mute thread')
    expect(screen.getByRole('menuitem', { name: 'Unmute' }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Until tomorrow morning' }))
    const wake = new Date(storedPreferences.get()?.mutedThreads.s1?.until ?? 0)
    expect(wake.getHours()).toBe(9)
    expect(wake.getTime()).toBeGreaterThan(Date.now())
    expect(storedPreferences.get()?.mutedThreads.s1?.activityAt).toBe(1)
    openMoreMenu()
    openSubmenu('More')
    openSubmenu('Muted')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unmute' }))
    expect(storedPreferences.get()?.mutedThreads).toEqual({})
  })

  it('offers only restore for archived threads and omits controls for blank ones', () => {
    mount({ archived: true })
    openMoreMenu()
    expect(screen.queryByRole('menuitem', { name: 'Pin' })).toBeNull()
    // Find in thread (with its ⌘F / Ctrl+F keycap) leads the menu, archived or not: a reading tool, not a lifecycle verb.
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Find in threadCtrlF', 'Restore', 'Copy thread link', 'Copy', 'More'])
    openSubmenu('More')
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Turns' })).toBeTruthy()
    cleanup()
    mount({ blank: true })
    expect(screen.queryByRole('group', { name: 'Thread actions' })).toBeNull()
  })

  it('offers the thread-reference submenu without resolving it until it opens', () => {
    mount()
    openMoreMenu()
    openSubmenu('More')

    expect(screen.getByRole('menuitem', { name: 'Referenced by' })).toBeTruthy()
    expect(screen.queryByText('Looking for referencing threads…')).toBeNull()
  })

  it('offers copy thread ID and link actions in the header menu', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    window.history.replaceState({}, '', '/?token=private#section')
    mount()
    openMoreMenu()
    openSubmenu('Copy')

    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy thread ID' }))
    await vi.waitFor(() => expect(screen.getByRole('status').textContent).toBe('Thread ID copied.'))
    expect(writeText).toHaveBeenCalledWith('s1')

    openMoreMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy thread link' }))
    await vi.waitFor(() => expect(screen.getByRole('status').textContent).toBe('Thread link copied.'))
    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/?thread=s1')
  })

  it('settles and unsets the thread from the header menu', async () => {
    storedPreferences.set({ ...DEFAULT_PREFERENCES, parkedSessionIds: ['s1'] })
    const header = mount({ pinned: true })
    openMoreMenu()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Done' }))
    await vi.waitFor(() => expect(storedPreferences.get()?.settledSessionIds).toContain('s1'))
    expect(storedPreferences.get()?.settledAt.s1).toBeGreaterThan(0)
    expect(storedPreferences.get()?.parkedSessionIds).toEqual([])
    await vi.waitFor(() => expect(header.unpinSession).toHaveBeenCalledWith('s1'))

    cleanup()
    const settledHeader = mount({ pinned: true })
    openMoreMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Restore from Done' }))
    expect(storedPreferences.get()?.settledSessionIds).not.toContain('s1')
    expect(settledHeader.unpinSession).not.toHaveBeenCalled()
  })

  it('disables Snooze, Done and Archive while a thread is running', () => {
    mount({ running: true })
    openMoreMenu()
    expect(screen.getByRole('menuitem', { name: 'Snooze' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('menuitem', { name: 'Done' }).getAttribute('aria-disabled')).toBe('true')
    openSubmenu('More')
    expect(screen.getByRole('menuitem', { name: 'Archive' }).getAttribute('aria-disabled')).toBe('true')
  })

  it('reports failed Host mutations beside the action', async () => {
    const header = mount({ failPin: true })
    openMoreMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin' }))
    await vi.waitFor(() => expect(header.pinSession).toHaveBeenCalledOnce())
    expect((await screen.findByRole('alert')).textContent).toBe('Could not update thread')
  })
})

// Council round 35 P2 (Opus, Fable; lead's choice a): on a phone these actions live in the thread's ⋯ sheet, where an icon
// ⋯ inside the ⋯ sheet read as a nested menu. There the control is a labelled row that ends in a chevron, and the menu it
// opens is the row menu's sheet, headed by the thread's title as the list's row menu is (council round 34, B9).
describe('HeaderThreadActions on a phone', () => {
  const phoneScreen = (): void => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: !query.includes('hover: hover'), media: query, addEventListener() {}, removeEventListener() {} }))
  }

  it('is a "More thread actions" row with an ellipsis glyph and a chevron, not a bare ⋯', () => {
    phoneScreen()
    mount()
    const row = screen.getByRole('button', { name: 'More thread actions' })
    expect(row.textContent).toBe('More thread actions')
    expect(row.hasAttribute('data-phone-sheet-row')).toBe(true)
    expect(row.querySelector('svg.lucide-ellipsis')?.getAttribute('class')).toContain('dshx:size-5')
    expect(row.lastElementChild?.getAttribute('class')).toContain('lucide-chevron-right')
    // The row's own type, like the sheet's tool rows: 44px, the full width, 8px in, the label in the ink.
    for (const token of ['dshx:min-h-11', 'dshx:w-full', 'dshx:justify-start', 'dshx:px-2', 'dshx:text-foreground']) expect(row.className).toContain(token)
  })

  it('opens the row menu sheet headed by the thread title', () => {
    phoneScreen()
    mount()
    openMoreMenu()
    const title = document.querySelector('[data-slot="dropdown-menu-content"] [data-thread-menu-title]')
    expect(title?.textContent).toBe('Thread')
    for (const token of ['dshx:line-clamp-2', 'dshx:font-semibold']) expect(title?.className).toContain(token)
    expect(screen.getAllByRole('menuitem', { name: 'Pin' })).toHaveLength(1)
  })

  it('keeps the bare ⋯ and no title off a phone', () => {
    mount()
    const button = screen.getByRole('button', { name: 'More thread actions' })
    expect(button.textContent).toBe('')
    expect(button.hasAttribute('data-phone-sheet-row')).toBe(false)
    openMoreMenu()
    expect(document.querySelector('[data-thread-menu-title]')).toBeNull()
  })
})
