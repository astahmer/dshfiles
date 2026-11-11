import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
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
import { HostSnapshotsModel } from './snapshots.js'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ArchiveIcon, ArchiveRestoreIcon, BellIcon, BellOffIcon, CopyIcon, EllipsisIcon, PauseIcon, PinIcon, PinOffIcon } from '@dshfiles/plugin-ui/icons'
import { useLayoutEffect, useMemo, useState } from 'react'
import type { ThreadDirectories } from './workspace-paths.js'
import { ThreadMuteModel, THREAD_MUTE_OPTIONS, type ThreadMuteOption } from './thread-mute.js'
import { ThreadChildrenModel } from './thread-children.js'
import { usePreferences } from './sidebar-state.js'
import { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'
import { SidebarOrganization } from './organization.js'
import { ThreadUrlModel } from './thread-url.js'
import { ThreadReferencesItems } from './thread-references-menu.js'
import { ContinueInProjectItems } from './continue-in-menu.js'
import { SettledThreadsModel } from './settled-threads.js'
import { useStableValue } from './stable-value.js'

interface HeaderThreadActionsInjected {
  archiveSession: (sessionId: SessionSummary['id']) => Promise<void>
  unarchiveSession: (sessionId: SessionSummary['id']) => Promise<void>
  pinSession: (sessionId: SessionSummary['id']) => Promise<void>
  unpinSession: (sessionId: SessionSummary['id']) => Promise<void>
  openThread: (sessionId: SessionSummary['id']) => void
  /** Fork the thread into another project and settle it; resolves to the continuing thread. */
  continueInProject: (sessionId: SessionSummary['id'], projectId: string) => Promise<SessionSummary['id']>
  /** Where the VCS providers keep each project's thread workspaces, so a custom threads directory groups correctly. */
  useThreadDirectories: (workspaces: readonly { readonly path: string }[]) => ThreadDirectories
}

// Only the slot props this component reads, so a test can supply them without the whole runtime surface.
type HeaderThreadActionsProps = Pick<PropsRuntime<'conversation.session.header.utilities'>, 'sessionId' | 'useSessions' | 'useWorkspaces'> &
  Pick<PropsLocale<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>, 't'> &
  HeaderThreadActionsInjected

// Read at the click, outside render.
const sameActionRow = (left: SessionSummary, right: SessionSummary): boolean =>
  left.parentId === right.parentId && left.blank === right.blank && left.running === right.running && left.cwd === right.cwd
const sameActionRows = (left: Readonly<Record<SessionId, SessionSummary>>, right: Readonly<Record<SessionId, SessionSummary>>): boolean =>
  HostSnapshotsModel.sameRowsBy(left, right, sameActionRow)

const muteUntilNow = (option: ThreadMuteOption): number | null => ThreadMuteModel.muteUntil(option, Date.now())
const settleAtNow = (): number => Date.now()

// Room the native title cluster keeps for the breadcrumb before Pin folds into the menu.
const TITLE_MIN_WIDTH = 160
// Copy-link and pin buttons plus the utilities gap; the hysteresis keeps them from flickering at the edge.
const PIN_SLOT_WIDTH = 76

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
  openThread,
  continueInProject,
  useThreadDirectories,
  t,
}: HeaderThreadActionsProps) => {
  const sessionState = useSessions(HostSnapshotsModel.selectStableSessionListState)
  const session = sessionState.byId[sessionId]
  const workspaceItems = useWorkspaces(state => HostSnapshotsModel.selectStableWorkspaceItems(state.items))
  const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
  const pinnedSessionIds = useWorkspaces(state => state.pinnedSessionIds)
  const { preferences, updatePreferences } = usePreferences()
  const [actionFailed, setActionFailed] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const [bar, setBar] = useState<HTMLElement | null>(null)
  // Expired mutes are pruned by the sidebar's own clock; this header only needs the moment it opened.
  const [openedAt] = useState(() => Date.now())
  const crowded = useCrowdedHeader(bar)
  // Only lineage, blankness, running and folder feed the derivations below; a streaming turn republishes the list
  // several times a second with none of them changed, and three mounted conversations each render this header.
  const actionRowsById = useStableValue(sessionState.byId, sameActionRows)
  const threadDirectories = useThreadDirectories(workspaceItems)
  const workspaceBySession = useMemo(
    () => SidebarOrganization.workspaceForSessions({ workspaces: workspaceItems, sessions: Object.values(actionRowsById), threadDirectories }),
    [actionRowsById, threadDirectories, workspaceItems],
  )
  const { targetIds, descendantRunning } = useMemo(() => {
    const sessions = Object.values(actionRowsById)
    const ids = ThreadChildrenModel.threadActionTargetIds({
      threadId: sessionId,
      threads: sessions.filter(candidate => !candidate.blank),
      cascadeToChildren: preferences.applyActionsToChildThreads,
    })
    return { targetIds: ids, descendantRunning: SidebarOrganization.hasRunningDescendantOfAny({ sessionIds: new Set(ids), sessions }) }
  }, [preferences.applyActionsToChildThreads, sessionId, actionRowsById])
  if (session === undefined || session.blank) return null

  const archived = archivedSessionIds.includes(sessionId)
  const pinned = pinnedSessionIds.includes(sessionId)
  const parked = preferences.parkedSessionIds.includes(sessionId)
  const muted = ThreadMuteModel.isSessionMuted(preferences.mutedThreads, sessionId, openedAt)
  const workspaceId = SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession)
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
  const settled = preferences.settledSessionIds.includes(sessionId)
  const settleDisabled = session.running || descendantRunning
  const updateSettled = (): void => {
    setActionFailed(false)
    const status = { settledSessionIds: preferences.settledSessionIds, settledAt: preferences.settledAt }
    if (settled) {
      updatePreferences(SettledThreadsModel.unsettle(status, targetIds))
      return
    }
    if (settleDisabled) return
    updatePreferences(
      SettledThreadsModel.settleAndUnpark({
        status,
        parkedSessionIds: preferences.parkedSessionIds,
        sessionIds: targetIds,
        now: settleAtNow(),
      }),
    )
    void Promise.all(targetIds.filter(targetId => pinnedSessionIds.includes(targetId)).map(targetId => unpinSession(targetId))).catch(() =>
      setActionFailed(true),
    )
  }
  const updateThreadOperation = async (operation: 'pin' | 'unpin' | 'archive' | 'unarchive'): Promise<void> => {
    setActionFailed(false)
    const needsChange = targetIds.filter(targetId => {
      if (operation === 'pin') return !pinnedSessionIds.includes(targetId)
      if (operation === 'unpin') return pinnedSessionIds.includes(targetId)
      if (operation === 'archive') return !archivedSessionIds.includes(targetId)
      return archivedSessionIds.includes(targetId)
    })
    if (operation === 'archive' && needsChange.some(targetId => sessionState.byId[targetId]?.running === true)) return
    const actionHandler = { pin: pinSession, unpin: unpinSession, archive: archiveSession, unarchive: unarchiveSession }[operation]
    try {
      for (const targetId of needsChange) await actionHandler(targetId)
    } catch {
      setActionFailed(true)
    }
  }
  const mute = (option: ThreadMuteOption): void => {
    updatePreferences({
      mutedThreads: ThreadMuteModel.muteSessions({
        mutes: preferences.mutedThreads,
        sessions: targetIds.flatMap(targetId => {
          const target = sessionState.byId[targetId]
          return target === undefined || target.blank ? [] : [target]
        }),
        until: muteUntilNow(option),
      }),
    })
  }
  const copy = async (value: string, successKey: 'threadSidebarIdCopied' | 'threadSidebarLinkCopied'): Promise<void> => {
    setCopyStatus(t((await writeClipboard(value)) ? successKey : 'threadSidebarClipboardFailure'))
  }
  const continueIn = async (projectId: string): Promise<void> => {
    setActionFailed(false)
    try {
      openThread(await continueInProject(sessionId, projectId))
    } catch {
      setActionFailed(true)
    }
  }
  const togglePinned = (): void => void updateThreadOperation(pinned ? 'unpin' : 'pin')
  const copyLinkLabel = t('threadSidebarCopyLink')
  const copyLink = (): void => void copy(ThreadUrlModel.buildThreadUrl(window.location.href, sessionId, workspaceId), 'threadSidebarLinkCopied')
  const pinLabel = t(pinned ? 'threadSidebarUnpin' : 'threadSidebarPin')
  const pinIcon = pinned ? <PinOffIcon aria-hidden="true" /> : <PinIcon aria-hidden="true" />
  const moreLabel = t('threadSidebarMoreThreadActions')
  const archiveDisabled = !archived && targetIds.some(targetId => sessionState.byId[targetId]?.running === true)
  const showPinButton = !archived && !crowded

  return (
    <TooltipProvider delayDuration={300}>
      <div ref={setBar} className="dshx-root dshx:flex dshx:items-center dshx:gap-1" role="group" aria-label={t('threadSidebarThreadActions')}>
        {!crowded ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={copyLinkLabel} onClick={copyLink}>
                <CopyIcon aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">{copyLinkLabel}</TooltipContent>
          </Tooltip>
        ) : null}
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
                <DropdownMenuItem disabled={!settled && settleDisabled} onSelect={updateSettled}>
                  {t(settled ? 'threadSidebarUnsettle' : 'threadSidebarSettle')}
                </DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    {muted ? <BellOffIcon aria-hidden="true" /> : <BellIcon aria-hidden="true" />}
                    {t(muted ? 'threadSidebarMuted' : 'threadSidebarMute')}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="dshx-root dshx:min-w-44" aria-label={t('threadSidebarMute')}>
                    {THREAD_MUTE_OPTIONS.map(option => (
                      <DropdownMenuItem key={option} onSelect={() => mute(option)}>
                        {t(ThreadMuteModel.muteOptionLabelKeys[option])}
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={!muted}
                      onSelect={() => updatePreferences({ mutedThreads: ThreadMuteModel.unmuteSessions(preferences.mutedThreads, targetIds) })}
                    >
                      {t('threadSidebarUnmute')}
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger disabled={session.running}>{t('threadSidebarContinueIn')}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="dshx-root dshx:min-w-48 dshx:max-w-72" aria-label={t('threadSidebarContinueIn')}>
                    <ContinueInProjectItems t={t} continueIn={projectId => void continueIn(projectId)} Item={DropdownMenuItem} />
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
                <DropdownMenuSeparator />
              </>
            )}
            <DropdownMenuItem disabled={archiveDisabled} onSelect={() => void updateThreadOperation(archived ? 'unarchive' : 'archive')}>
              {archived ? <ArchiveRestoreIcon aria-hidden="true" /> : <ArchiveIcon aria-hidden="true" />}
              {t(archived ? 'threadSidebarRestore' : 'threadSidebarArchive')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => void copy(sessionId, 'threadSidebarIdCopied')}>
              <CopyIcon aria-hidden="true" />
              {t('threadSidebarCopyId')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => void copy(ThreadUrlModel.buildThreadUrl(window.location.href, sessionId, workspaceId), 'threadSidebarLinkCopied')}
            >
              <CopyIcon aria-hidden="true" />
              {t('threadSidebarCopyLink')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t('threadSidebarReferencedBy')}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="dshx-root dshx:min-w-56 dshx:max-w-72" aria-label={t('threadSidebarReferencedBy')}>
                <ThreadReferencesItems sessionId={sessionId} t={t} openThread={openThread} Item={DropdownMenuItem} />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </DropdownMenuContent>
        </DropdownMenu>
        {actionFailed ? (
          <span className="dshx:px-2 dshx:py-1.5 dshx:text-xs dshx:text-destructive" role="alert">
            {t('threadSidebarActionFailure')}
          </span>
        ) : null}
        {copyStatus ? (
          <span className="dshx:sr-only" role="status">
            {copyStatus}
          </span>
        ) : null}
      </div>
    </TooltipProvider>
  )
}
