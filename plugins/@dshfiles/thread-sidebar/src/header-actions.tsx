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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { MoreHorizontalIcon } from '@dshfiles/plugin-ui/icons'
import {
  isThreadMuted,
  setThreadMute,
  clearThreadMute,
  snoozeDurations,
  threadNotificationPreferences,
  DEFAULT_THREAD_NOTIFICATION_PREFERENCES,
} from './thread-notifications.js'
import { useState } from 'react'
import { threadActionTargetIds } from './thread-children.js'
import { usePreferences } from './sidebar-state.js'
import { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'

interface HeaderThreadActionsInjected {
  archiveSession: (sessionId: SessionSummary['id']) => Promise<void>
  unarchiveSession: (sessionId: SessionSummary['id']) => Promise<void>
  pinSession: (sessionId: SessionSummary['id']) => Promise<void>
  unpinSession: (sessionId: SessionSummary['id']) => Promise<void>
}

type HeaderThreadActionsProps = Pick<PropsRuntime<'conversation.session.header.utilities'>, 'sessionId' | 'useSessions' | 'useWorkspaces'> &
  PropsLocale<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE> &
  HeaderThreadActionsInjected

/** Session-scoped copy of the thread-list management actions for the header overflow. */
export const HeaderThreadActions = ({
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
    const action = { pin: pinSession, unpin: unpinSession, archive: archiveSession, unarchive: unarchiveSession }[operation]
    try {
      for (const targetId of needsChange) await action(targetId)
    } catch {
      setActionFailed(true)
    }
  }
  const updateMute = (until: number | null): void => {
    threadNotificationPreferences.set(setThreadMute(notificationPreferences, sessionId, until))
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={t('threadSidebarContextMenu')}>
          <MoreHorizontalIcon className="dshx:size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="dshx-root dshx:min-w-44" aria-label={t('threadSidebarContextMenu')}>
        {archived ? (
          <DropdownMenuItem onSelect={() => void updateThreadOperation('unarchive')}>{t('threadSidebarRestore')}</DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => void updateThreadOperation(pinned ? 'unpin' : 'pin')}>
              {t(pinned ? 'threadSidebarUnpin' : 'threadSidebarPin')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={session.running} onSelect={updateParked}>
              {t(parked ? 'threadSidebarUnpark' : 'threadSidebarPark')}
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t(muted ? 'threadSidebarNotificationsMuted' : 'threadSidebarNotifications')}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="dshx-root dshx:min-w-44">
                {snoozeDurations.map(duration => (
                  <DropdownMenuItem
                    key={duration.milliseconds}
                    onSelect={() => {
                      updateMute(Date.now() + duration.milliseconds)
                    }}
                  >
                    {t('threadSidebarSnoozeFor')} {t(duration.label)}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuItem
                  onSelect={() => {
                    updateMute(null)
                  }}
                >
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
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem
              disabled={targetIds.some(targetId => sessionState.byId[targetId]?.running === true)}
              onSelect={() => void updateThreadOperation('archive')}
            >
              {t('threadSidebarArchive')}
            </DropdownMenuItem>
          </>
        )}
        {actionFailed ? (
          <div className="dshx:px-2 dshx:py-1.5 dshx:text-destructive" role="alert">
            {t('threadSidebarActionFailure')}
          </div>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
