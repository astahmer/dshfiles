// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HeaderThreadActions } from './header-actions.js'
import { storedPreferences, PREFERENCES_STORAGE_KEY } from './preferences.js'
import { threadNotificationPreferences, DEFAULT_THREAD_NOTIFICATION_PREFERENCES } from './thread-notifications.js'
import { SidebarStateProvider } from './sidebar-state.js'

const labels: Readonly<Record<string, string>> = {
  threadSidebarPin: 'Pin',
  threadSidebarUnpin: 'Unpin',
  threadSidebarPark: 'Park',
  threadSidebarUnpark: 'Unpark',
  threadSidebarArchive: 'Archive',
  threadSidebarRestore: 'Restore',
  threadSidebarNotifications: 'Thread notifications',
  threadSidebarNotificationsMuted: 'Notifications muted',
  threadSidebarSnoozeFor: 'Snooze for',
  threadSidebarSnooze15Minutes: '15 minutes',
  threadSidebarSnooze1Hour: '1 hour',
  threadSidebarSnooze3Hours: '3 hours',
  threadSidebarSnooze8Hours: '8 hours',
  threadSidebarSnooze24Hours: '24 hours',
  threadSidebarMuteUntilEnabled: 'Mute until enabled',
  threadSidebarUnmute: 'Turn notifications back on',
  threadSidebarActionFailure: 'Could not update thread',
  threadSidebarThreadActions: 'Thread actions',
  threadSidebarMoreThreadActions: 'More thread actions',
}

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
  const session = {
    id: 's1',
    title: 'Thread',
    displayTitle: 'Thread',
    cwd: '/workspace',
    updatedAt: 1,
    running: options?.running ?? false,
    blank: options?.blank ?? false,
  }
  const pinSession = vi.fn(async () => {
    if (options?.failPin === true) throw new Error('pin failed')
  })
  const props = {
    sessionId: 's1',
    useSessions: <Value,>(select: (state: unknown) => Value) => select({ ids: ['s1'], byId: { s1: session } }),
    useWorkspaces: <Value,>(select: (state: unknown) => Value) =>
      select({
        archivedSessionIds: options?.archived ? ['s1'] : [],
        pinnedSessionIds: [],
      }),
    archiveSession: vi.fn(async () => {}),
    unarchiveSession: vi.fn(async () => {}),
    pinSession,
    unpinSession: vi.fn(async () => {}),
    t: (key: string) => labels[key] ?? key,
  }
  const headerActionProps = props as unknown as Parameters<typeof HeaderThreadActions>[0]
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
  threadNotificationPreferences.set(DEFAULT_THREAD_NOTIFICATION_PREFERENCES)
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

  it('opens the notification submenu and snoozes the current thread', () => {
    mount()
    openMoreMenu()
    fireEvent.keyDown(screen.getByRole('menuitem', { name: 'Thread notifications' }), { key: 'ArrowRight' })
    fireEvent.click(screen.getByRole('menuitem', { name: 'Snooze for 15 minutes' }))
    expect(threadNotificationPreferences.get()?.mutedUntil.s1).toBeGreaterThan(Date.now())
  })

  it('offers only restore for archived threads and omits controls for blank ones', () => {
    mount({ archived: true })
    expect(screen.queryByRole('button', { name: 'Pin' })).toBeNull()
    openMoreMenu()
    expect(screen.getAllByRole('menuitem').map(item => item.textContent)).toEqual(['Restore'])
    cleanup()
    mount({ blank: true })
    expect(screen.queryByRole('group', { name: 'Thread actions' })).toBeNull()
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
