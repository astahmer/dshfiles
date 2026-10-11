// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HeaderThreadActions } from './header-actions.js'
import { storedPreferences, PREFERENCES_STORAGE_KEY } from './preferences.js'
import { threadNotificationPreferences, DEFAULT_THREAD_NOTIFICATION_PREFERENCES } from './thread-notifications.js'
import { SidebarStateProvider } from './sidebar-state.js'

const labels: Readonly<Record<string, string>> = {
  threadSidebarContextMenu: 'Thread actions', threadSidebarPin: 'Pin', threadSidebarUnpin: 'Unpin',
  threadSidebarPark: 'Park', threadSidebarUnpark: 'Unpark', threadSidebarArchive: 'Archive',
  threadSidebarRestore: 'Restore', threadSidebarNotifications: 'Thread notifications',
  threadSidebarNotificationsMuted: 'Notifications muted', threadSidebarSnoozeFor: 'Snooze for',
  threadSidebarSnooze15Minutes: '15 minutes', threadSidebarSnooze1Hour: '1 hour',
  threadSidebarSnooze3Hours: '3 hours', threadSidebarSnooze8Hours: '8 hours',
  threadSidebarSnooze24Hours: '24 hours', threadSidebarMuteUntilEnabled: 'Mute until enabled',
  threadSidebarUnmute: 'Turn notifications back on', threadSidebarActionFailure: 'Could not update thread',
}

const mount = (options?: { archived?: boolean; blank?: boolean; running?: boolean }) => {
  const session = {
    id: 's1', title: 'Thread', displayTitle: 'Thread', cwd: '/workspace', updatedAt: 1,
    running: options?.running ?? false, blank: options?.blank ?? false,
  }
  const pinSession = vi.fn(async () => {})
  const props = {
    sessionId: 's1',
    useSessions: <Value,>(select: (state: unknown) => Value) => select({ ids: ['s1'], byId: { s1: session } }),
    useWorkspaces: <Value,>(select: (state: unknown) => Value) => select({
      archivedSessionIds: options?.archived ? ['s1'] : [], pinnedSessionIds: [],
    }),
    archiveSession: vi.fn(async () => {}), unarchiveSession: vi.fn(async () => {}), pinSession,
    unpinSession: vi.fn(async () => {}), t: (key: string) => labels[key] ?? key,
  }
  const view = render(<SidebarStateProvider><HeaderThreadActions {...(props as never)} /></SidebarStateProvider>)
  return { ...view, props }
}

const openMenu = (): void => {
  const trigger = screen.getByRole('button', { name: 'Thread actions' })
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'Enter', code: 'Enter' })
  fireEvent.keyUp(trigger, { key: 'Enter', code: 'Enter' })
}

beforeEach(() => {
  localStorage.clear()
  storedPreferences.remove()
  threadNotificationPreferences.set(DEFAULT_THREAD_NOTIFICATION_PREFERENCES)
})
afterEach(() => cleanup())

describe('HeaderThreadActions', () => {
  it('pins and parks a thread from the header menu', () => {
    const header = mount()
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pin' }))
    expect(header.props.pinSession).toHaveBeenCalledWith('s1')
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Park' }))
    expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).not.toBeNull()
  })

  it('snoozes the current thread notifications', () => {
    mount()
    openMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Thread notifications' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Snooze for 15 minutes' }))
    expect(threadNotificationPreferences.get()?.mutedUntil.s1).toBeGreaterThan(Date.now())
  })

  it('offers restore for archived threads and omits controls for blank ones', () => {
    mount({ archived: true })
    openMenu()
    expect(screen.getByRole('menuitem', { name: 'Restore' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Pin' })).toBeNull()
    cleanup()
    mount({ blank: true })
    expect(screen.queryByRole('button', { name: 'Thread actions' })).toBeNull()
  })

  it('disables park and archive while a thread is running', () => {
    mount({ running: true })
    openMenu()
    expect(screen.getByRole('menuitem', { name: 'Park' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByRole('menuitem', { name: 'Archive' }).getAttribute('aria-disabled')).toBe('true')
  })
})
