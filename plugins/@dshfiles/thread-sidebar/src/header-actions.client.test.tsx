// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState, SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { HeaderThreadActions } from './header-actions.js'
import { storedPreferences, PREFERENCES_STORAGE_KEY } from './preferences.js'
import { SidebarStateProvider } from './sidebar-state.js'

const labels = {
  threadSidebarPin: 'Pin',
  threadSidebarUnpin: 'Unpin',
  threadSidebarPark: 'Park',
  threadSidebarUnpark: 'Unpark',
  threadSidebarArchive: 'Archive',
  threadSidebarRestore: 'Restore',
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
} satisfies Readonly<Record<string, string>>

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

const resizeTitleCluster = (width: number): void => {
  act(() => {
    for (const callback of resizeCallbacks) callback([{ contentRect: { width } }])
  })
}

const mount = (options?: { archived?: boolean; blank?: boolean; running?: boolean; failPin?: boolean; nativeHeader?: boolean }) => {
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
    pinnedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
  }
  const pinSession = vi.fn(async () => {
    if (options?.failPin === true) throw new Error('pin failed')
  })
  const headerActionProps: Parameters<typeof HeaderThreadActions>[0] = {
    sessionId,
    useSessions: select => select(sessions),
    useWorkspaces: select => select(workspaces),
    archiveSession: vi.fn(async () => {}),
    unarchiveSession: vi.fn(async () => {}),
    pinSession,
    unpinSession: vi.fn(async () => {}),
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
  return { ...view, pinSession }
}

const openMoreMenu = (): void => {
  fireEvent.keyDown(screen.getByRole('button', { name: 'More thread actions' }), { key: 'ArrowDown' })
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
  it('keeps Pin as an icon button and moves Park into the More menu', () => {
    const header = mount()
    expect(screen.getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual(['Pin', 'More thread actions'])
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }))
    expect(header.pinSession).toHaveBeenCalledWith('s1')

    openMoreMenu()
    expect(screen.queryByRole('menuitem', { name: 'Pin' })).toBeNull()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Park' }))
    expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).not.toBeNull()
  })

  it('folds Pin into the More menu when the native title has no room, and restores it once there is', () => {
    const header = mount({ nativeHeader: true })
    resizeTitleCluster(120)
    expect(screen.queryByRole('button', { name: 'Pin' })).toBeNull()
    openMoreMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin' }))
    expect(header.pinSession).toHaveBeenCalledWith('s1')

    resizeTitleCluster(180)
    expect(screen.queryByRole('button', { name: 'Pin' })).toBeNull()
    resizeTitleCluster(600)
    expect(screen.getByRole('button', { name: 'Pin' })).toBeTruthy()
  })

  it('snoozes the current thread until tomorrow morning, then offers Unmute', () => {
    mount()
    openMoreMenu()
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Mute thread' }), { key: 'ArrowRight' })
    expect(screen.getByRole('menuitem', { name: 'Unmute' }).getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Until tomorrow morning' }))
    const wake = new Date(storedPreferences.get()?.mutedThreads.s1?.until ?? 0)
    expect(wake.getHours()).toBe(9)
    expect(wake.getTime()).toBeGreaterThan(Date.now())
    expect(storedPreferences.get()?.mutedThreads.s1?.activityAt).toBe(1)
    openMoreMenu()
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Muted' }), { key: 'ArrowRight' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Unmute' }))
    expect(storedPreferences.get()?.mutedThreads).toEqual({})
  })

  it('offers only restore for archived threads and omits controls for blank ones', () => {
    mount({ archived: true })
    expect(screen.queryByRole('button', { name: 'Pin' })).toBeNull()
    openMoreMenu()
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Restore', 'Copy thread ID', 'Copy thread link'])
    cleanup()
    mount({ blank: true })
    expect(screen.queryByRole('group', { name: 'Thread actions' })).toBeNull()
  })

  it('offers copy thread ID and link actions in the header menu', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    window.history.replaceState({}, '', '/?token=private#section')
    mount()
    openMoreMenu()

    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy thread ID' }))
    await vi.waitFor(() => expect(screen.getByRole('status').textContent).toBe('Thread ID copied.'))
    expect(writeText).toHaveBeenCalledWith('s1')

    openMoreMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy thread link' }))
    await vi.waitFor(() => expect(screen.getByRole('status').textContent).toBe('Thread link copied.'))
    expect(writeText).toHaveBeenCalledWith('http://localhost:3000/?thread=s1')
  })

  it('disables park and archive while a thread is running', () => {
    mount({ running: true })
    openMoreMenu()
    expect(screen.getByRole('menuitem', { name: 'Park' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('menuitem', { name: 'Archive' }).getAttribute('aria-disabled')).toBe('true')
  })

  it('reports failed Host mutations beside the action', async () => {
    const header = mount({ failPin: true })
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }))
    await vi.waitFor(() => expect(header.pinSession).toHaveBeenCalledOnce())
    expect((await screen.findByRole('alert')).textContent).toBe('Could not update thread')
  })
})
