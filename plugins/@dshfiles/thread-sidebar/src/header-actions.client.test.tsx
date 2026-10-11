// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HeaderThreadActions, type HeaderThreadActionKind } from './header-actions.js'
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
}

const mount = (
  action: HeaderThreadActionKind,
  options?: { archived?: boolean; blank?: boolean; running?: boolean; failPin?: boolean; placement?: 'toolbar' | 'overflow' },
) => {
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
    action,
    placement: options?.placement ?? 'overflow',
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
  const view = render(
    <SidebarStateProvider>
      <HeaderThreadActions {...headerActionProps} />
    </SidebarStateProvider>,
  )
  return { ...view, pinSession }
}

beforeEach(() => {
  localStorage.clear()
  storedPreferences.remove()
  threadNotificationPreferences.set(DEFAULT_THREAD_NOTIFICATION_PREFERENCES)
})
afterEach(() => cleanup())

describe('HeaderThreadActions', () => {
  it('renders pin and park as direct overflow actions without an inner ellipsis', () => {
    const header = mount('pin')
    expect(screen.queryByRole('button', { name: 'Thread actions' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }))
    expect(header.pinSession).toHaveBeenCalledWith('s1')

    cleanup()
    mount('park')
    fireEvent.click(screen.getByRole('button', { name: 'Park' }))
    expect(localStorage.getItem(PREFERENCES_STORAGE_KEY)).not.toBeNull()
  })

  it('opens the notification action and snoozes the current thread', () => {
    mount('notifications')
    fireEvent.click(screen.getByRole('button', { name: 'Thread notifications' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Snooze for 15 minutes' }))
    expect(threadNotificationPreferences.get()?.mutedUntil.s1).toBeGreaterThan(Date.now())
  })

  it('offers restore for archived threads and omits controls for blank ones', () => {
    mount('archive', { archived: true })
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Pin' })).toBeNull()
    cleanup()
    mount('pin', { blank: true })
    expect(screen.queryByRole('button', { name: 'Pin' })).toBeNull()
  })

  it('renders a compact toolbar action when moved out of overflow', () => {
    mount('pin', { placement: 'toolbar' })
    const pin = screen.getByRole('button', { name: 'Pin' })
    expect(pin.getAttribute('data-size')).toBe('icon-sm')
    expect(screen.queryByRole('button', { name: 'Thread actions' })).toBeNull()
  })

  it('disables park and archive while a thread is running', () => {
    mount('park', { running: true })
    expect(screen.getByRole('button', { name: 'Park' }).hasAttribute('disabled')).toBe(true)
    cleanup()
    mount('archive', { running: true })
    expect(screen.getByRole('button', { name: 'Archive' }).hasAttribute('disabled')).toBe(true)
  })

  it('reports failed Host mutations beside the action', async () => {
    const header = mount('pin', { failPin: true })
    fireEvent.click(screen.getByRole('button', { name: 'Pin' }))
    await vi.waitFor(() => expect(header.pinSession).toHaveBeenCalledOnce())
    expect((await screen.findByRole('alert')).textContent).toBe('Could not update thread')
  })
})
