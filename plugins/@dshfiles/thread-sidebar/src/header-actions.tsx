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
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ArchiveIcon, ArchiveRestoreIcon, BellIcon, BellOffIcon, EllipsisIcon, PauseIcon, PinIcon, PinOffIcon } from '@dshfiles/plugin-ui/icons'
import { useLayoutEffect, useState } from 'react'
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

interface HeaderThreadActionsInjected {
  archiveSession: (sessionId: SessionSummary['id']) => Promise<void>
  unarchiveSession: (sessionId: SessionSummary['id']) => Promise<void>
  pinSession: (sessionId: SessionSummary['id']) => Promise<void>
  unpinSession: (sessionId: SessionSummary['id']) => Promise<void>
}

type HeaderThreadActionsProps = PropsRuntime<'conversation.session.header.utilities'> &
  PropsLocale<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE> &
  HeaderThreadActionsInjected

// Room the native title cluster keeps for the breadcrumb before Pin folds into the menu.
const TITLE_MIN_WIDTH = 160
// Pin's icon button plus the utilities gap; the hysteresis keeps Pin from flickering at the edge.
const PIN_SLOT_WIDTH = 40

// The native header row is the ancestor that holds the corner seat; its first child is the title cluster.
const findTitleCluster = (bar: HTMLElement): HTMLElement | null => {
  for (let row = bar.parentElement; row !== null; row = row.parentElement) {
    if (!Array.from(row.children).some(child => child.hasAttribute('data-conversation-header-corner'))) continue
    const cluster = row.firstElementChild
    return cluster instanceof HTMLElement && !cluster.contains(bar) ? cluster : null
  }
  return null
}

const useCrowdedHeader = (bar: HTMLElement | null): boolean => {
  const [crowded, setCrowded] = useState(false)
  useLayoutEffect(() => {
    if (bar === null) return
    const cluster = findTitleCluster(bar)
    if (cluster === null) return
    const observer = new ResizeObserver(entries => {
      const clusterWidth = entries.at(-1)?.contentRect.width ?? cluster.clientWidth
      const titleSiblingsWidth = Array.from(cluster.children)
        .slice(1)
        .reduce((total, child) => total + child.getBoundingClientRect().width, 0)
      const availableTitleWidth = clusterWidth - titleSiblingsWidth
      setCrowded(current => (current ? availableTitleWidth < TITLE_MIN_WIDTH + PIN_SLOT_WIDTH : availableTitleWidth < TITLE_MIN_WIDTH))
    })
    observer.observe(cluster)
    return () => observer.disconnect()
  }, [bar])
  return crowded
}

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
  const [bar, setBar] = useState<HTMLElement | null>(null)
  const crowded = useCrowdedHeader(bar)
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
  const togglePinned = (): void => void updateThreadOperation(pinned ? 'unpin' : 'pin')
  const pinLabel = t(pinned ? 'threadSidebarUnpin' : 'threadSidebarPin')
  const pinIcon = pinned ? <PinOffIcon aria-hidden="true" /> : <PinIcon aria-hidden="true" />
  const moreLabel = t('threadSidebarMoreThreadActions')
  const archiveDisabled = !archived && targetIds.some(targetId => sessionState.byId[targetId]?.running === true)
  const showPinButton = !archived && !crowded

  return (
    <TooltipProvider delayDuration={300}>
      <div ref={setBar} className="dshx-root dshx:flex dshx:items-center dshx:gap-1" role="group" aria-label={t('threadSidebarThreadActions')}>
        {showPinButton ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={pinLabel} onClick={togglePinned}>
                {pinIcon}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{pinLabel}</TooltipContent>
          </Tooltip>
        ) : null}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" aria-label={moreLabel}>
                  <EllipsisIcon aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">{moreLabel}</TooltipContent>
          </Tooltip>
          <DropdownMenuContent align="end" className="dshx-root dshx:min-w-48" aria-label={moreLabel}>
            {archived ? null : (
              <>
                {showPinButton ? null : (
                  <DropdownMenuItem onSelect={togglePinned}>
                    {pinIcon}
                    {pinLabel}
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem disabled={session.running} onSelect={updateParked}>
                  <PauseIcon aria-hidden="true" />
                  {t(parked ? 'threadSidebarUnpark' : 'threadSidebarPark')}
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    {muted ? <BellOffIcon aria-hidden="true" /> : <BellIcon aria-hidden="true" />}
                    {t(muted ? 'threadSidebarNotificationsMuted' : 'threadSidebarNotifications')}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="dshx-root dshx:min-w-44" aria-label={t('threadSidebarNotifications')}>
                    {snoozeDurations.map(duration => (
                      <DropdownMenuItem key={duration.milliseconds} onSelect={() => updateMute(Date.now() + duration.milliseconds)}>
                        {t('threadSidebarSnoozeFor')} {t(duration.label)}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuItem onSelect={() => updateMute(null)}>{t('threadSidebarMuteUntilEnabled')}</DropdownMenuItem>
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
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem disabled={archiveDisabled} onSelect={() => void updateThreadOperation(archived ? 'unarchive' : 'archive')}>
              {archived ? <ArchiveRestoreIcon aria-hidden="true" /> : <ArchiveIcon aria-hidden="true" />}
              {t(archived ? 'threadSidebarRestore' : 'threadSidebarArchive')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {actionFailed ? (
          <span className="dshx:px-2 dshx:py-1.5 dshx:text-xs dshx:text-destructive" role="alert">
            {t('threadSidebarActionFailure')}
          </span>
        ) : null}
      </div>
    </TooltipProvider>
  )
}
