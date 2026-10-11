import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ArchiveIcon, BellIcon, PauseIcon, PinIcon } from '@dshfiles/plugin-ui/icons'
import { useState, type ReactNode } from 'react'
import {
  isThreadMuted,
  setThreadMute,
  clearThreadMute,
  snoozeDurations,
  threadNotificationPreferences,
  DEFAULT_THREAD_NOTIFICATION_PREFERENCES,
} from './thread-notifications.js'
import { threadActionTargetIds } from './thread-children.js'
import { usePreferences } from './sidebar-state.js'
import { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'

export type HeaderThreadActionKind = 'pin' | 'park' | 'notifications' | 'archive'

interface HeaderThreadActionsInjected {
  action: HeaderThreadActionKind
  archiveSession: (sessionId: SessionSummary['id']) => Promise<void>
  unarchiveSession: (sessionId: SessionSummary['id']) => Promise<void>
  pinSession: (sessionId: SessionSummary['id']) => Promise<void>
  unpinSession: (sessionId: SessionSummary['id']) => Promise<void>
}

type HeaderThreadActionsProps = PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>
  & HeaderThreadActionsInjected

export const HeaderThreadActions = ({
  action,
  sessionId,
  useSessions,
  useWorkspaces,
  archiveSession,
  unarchiveSession,
  pinSession,
  unpinSession,
  t,
}: HeaderThreadActionsProps) => {
  const sessionState = useSessions(state => state)
  const session = sessionState.byId[sessionId]
  const workspaceState = useWorkspaces(state => state)
  const { preferences, updatePreferences } = usePreferences()
  const notificationPreferences = threadNotificationPreferences.useValue() ?? DEFAULT_THREAD_NOTIFICATION_PREFERENCES
  const [actionFailed, setActionFailed] = useState(false)
  if (session === undefined || session.blank) return null

  const archived = workspaceState.archivedSessionIds.includes(sessionId)
  const pinned = workspaceState.pinnedSessionIds.includes(sessionId)
  const parked = preferences.parkedSessionIds.includes(sessionId)
  const muted = isThreadMuted(notificationPreferences, sessionId, Date.now())
  const actionThreads = Object.values(sessionState.byId).filter(candidate => !candidate.blank)
  const targetIds = threadActionTargetIds({
    threadId: sessionId,
    threads: actionThreads,
    cascadeToChildren: preferences.applyActionsToChildThreads,
  })
  const updateParked = (): void => {
    if (session.running) return
    const parkedIds = new Set(preferences.parkedSessionIds)
    const shouldPark = !parked
    for (const targetId of targetIds) {
      if (shouldPark) parkedIds.add(targetId)
      else parkedIds.delete(targetId)
    }
    updatePreferences({ parkedSessionIds: [...parkedIds] })
  }
  const updateThreadOperation = async (operation: 'pin' | 'unpin' | 'archive' | 'unarchive'): Promise<void> => {
    setActionFailed(false)
    const needsChange = targetIds.filter(targetId => {
      if (operation === 'pin') return !workspaceState.pinnedSessionIds.includes(targetId)
      if (operation === 'unpin') return workspaceState.pinnedSessionIds.includes(targetId)
      if (operation === 'archive') return !workspaceState.archivedSessionIds.includes(targetId)
      return workspaceState.archivedSessionIds.includes(targetId)
    })
    if (operation === 'archive' && needsChange.some(targetId => sessionState.byId[targetId]?.running === true)) return
    const actionHandler = { pin: pinSession, unpin: unpinSession, archive: archiveSession, unarchive: unarchiveSession }[operation]
    try {
      for (const targetId of needsChange) await actionHandler(targetId)
    } catch {
      setActionFailed(true)
    }
  }
  const updateMute = (until: number | null): void => {
    threadNotificationPreferences.set(setThreadMute(notificationPreferences, sessionId, until))
  }
  const actionButton = (label: string, icon: ReactNode, onClick?: () => void, disabled = false) => (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      {label}
    </Button>
  )
  const error = actionFailed ? (
    <span className="dshx:px-2 dshx:py-1.5 dshx:text-destructive" role="alert">
      {t('threadSidebarActionFailure')}
    </span>
  ) : null
  if (action !== 'archive' && archived) return null

  if (action === 'pin') {
    const label = t(pinned ? 'threadSidebarUnpin' : 'threadSidebarPin')
    return (
      <span className="dshx-root">
        {actionButton(label, <PinIcon className="dshx:size-4" aria-hidden="true" />, () => void updateThreadOperation(pinned ? 'unpin' : 'pin'))}
        {error}
      </span>
    )
  }

  if (action === 'park') {
    const label = t(parked ? 'threadSidebarUnpark' : 'threadSidebarPark')
    return (
      <span className="dshx-root">
        {actionButton(label, <PauseIcon className="dshx:size-4" aria-hidden="true" />, updateParked, session.running)}
      </span>
    )
  }

  if (action === 'notifications') {
    const label = t(muted ? 'threadSidebarNotificationsMuted' : 'threadSidebarNotifications')
    return (
      <span className="dshx-root">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {actionButton(label, <BellIcon className="dshx:size-4" aria-hidden="true" />)}
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="dshx-root dshx:min-w-44" aria-label={t('threadSidebarNotifications')}>
            {snoozeDurations.map(duration => (
              <DropdownMenuItem
                key={duration.milliseconds}
                onSelect={() => updateMute(Date.now() + duration.milliseconds)}
              >
                {t('threadSidebarSnoozeFor')} {t(duration.label)}
              </DropdownMenuItem>
            ))}
            <DropdownMenuItem onSelect={() => updateMute(null)}>
              {t('threadSidebarMuteUntilEnabled')}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!muted}
              onSelect={() => {
                threadNotificationPreferences.set(clearThreadMute(notificationPreferences, sessionId))
              }}
            >
              {t('threadSidebarUnmute')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </span>
    )
  }

  const label = t(archived ? 'threadSidebarRestore' : 'threadSidebarArchive')
  const disabled = !archived && targetIds.some(targetId => sessionState.byId[targetId]?.running === true)
  return (
    <span className="dshx-root">
      {actionButton(label, <ArchiveIcon className="dshx:size-4" aria-hidden="true" />, () => void updateThreadOperation(archived ? 'unarchive' : 'archive'), disabled)}
      {error}
    </span>
  )
}
