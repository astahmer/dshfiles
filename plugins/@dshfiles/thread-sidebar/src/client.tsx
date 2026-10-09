import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { WorkspaceBrowserProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { useApiQuery } from '@dshfiles/dshx/client'
import {
  IconArchiveOutlineRegular,
  IconChevronDownOutlineRegular,
  IconChevronUpOutlineRegular,
  IconPauseOutlineRegular,
  IconPinFillRegular,
  IconPinOutlineRegular,
  IconPlayOutlineRegular,
  IconUnarchiveOutlineRegular,
  relativeTime,
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { Alert } from '@dshfiles/plugin-ui/components/ui/alert'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger } from '@dshfiles/plugin-ui/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { Empty, EmptyTitle } from '@dshfiles/plugin-ui/components/ui/empty'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { ActivityIcon, ChevronDownIcon, ChevronUpIcon, CirclePauseIcon, MonitorIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { memo, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import {
  isAutoArchiveCandidate,
  parseSessionIds,
  sessionLineage,
  sectionForSession,
  type SessionActivity,
  type SidebarPreferences,
  type SidebarSection,
  type ThreadRowDensity,
  workspaceForLineage,
} from './organization.js'
import { toggleCollapsedSection } from './preferences.js'
import { isMacPlatform, type ContentHit, type ThreadCandidate } from './palette.js'
import { usePaletteState, useSidebarState } from './sidebar-state.js'
import { ThreadPalette } from './thread-palette.js'
import { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'
import { projectTextTone } from './project-tone.js'
import { scheduleSuccessNoticeDismissal, SidebarNoticeMessage, type SidebarNotice } from './sidebar-notice.js'
import { threadSidebarMachineApi } from './machine-api.js'
import { groupThreadChildren, visibleChildren } from './thread-children.js'
import { buildThreadUrl, clearThreadUrl, readThreadUrl } from './thread-url.js'

type InjectedActions = {
  archiveSession: (sessionId: SessionSummary['id']) => Promise<void>
  unarchiveSession: (sessionId: SessionSummary['id']) => Promise<void>
  pinSession: (sessionId: SessionSummary['id']) => Promise<void>
  unpinSession: (sessionId: SessionSummary['id']) => Promise<void>
  markRead: (sessionId: SessionSummary['id']) => Promise<boolean>
  setSnoozed: (sessionId: SessionSummary['id'], snoozed: boolean) => Promise<boolean>
  /** Host message-content search; null when this Host has none. */
  searchContent: ((query: string, signal: AbortSignal) => Promise<readonly ContentHit[]>) | null
}

type ThreadSidebarProps = Pick<WorkspaceBrowserProps, 'open' | 'useSessions' | 'useWorkspaces'> &
  InjectedActions & {
    tSidebar: TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>
  }

type ThreadSidebarTranslate = ThreadSidebarProps['tSidebar']

const ALL_PROJECTS = '__all__'
const UNASSIGNED_PROJECT = '__unassigned__'

const sections: readonly SidebarSection[] = ['pinned', 'active', 'parked', 'inactive', 'archived']

const sectionLabels: Record<SidebarSection, Parameters<ThreadSidebarTranslate>[0]> = {
  pinned: 'threadSidebarPinned',
  active: 'threadSidebarActive',
  parked: 'threadSidebarParked',
  inactive: 'threadSidebarInactive',
  archived: 'threadSidebarArchived',
}

const noticeClass = 'dshx:w-auto dshx:px-3 dshx:py-2 dshx:text-xs'

const sectionIcons: Record<SidebarSection, ReactNode> = {
  pinned: <IconPinOutlineRegular size={14} />,
  active: <ActivityIcon className="dshx:size-3.5" />,
  parked: <IconPauseOutlineRegular size={14} />,
  inactive: <CirclePauseIcon className="dshx:size-3.5" />,
  archived: <IconArchiveOutlineRegular size={14} />,
}

const setIncludes = (values: readonly string[]): ReadonlySet<string> => new Set(values)

const toggleSetMember = (values: ReadonlySet<string>, value: string): ReadonlySet<string> => {
  const next = new Set(values)
  if (!next.delete(value)) next.add(value)
  return next
}

const sessionsForAutoArchive = (ids: readonly SessionSummary['id'][], byId: Readonly<Record<string, SessionSummary>>): SessionSummary[] =>
  ids.flatMap(sessionId => {
    const session = byId[sessionId]
    return session === undefined ? [] : [session]
  })

const workspaceForSessions = (workspaces: readonly WorkspaceView[]): Map<string, string> => {
  const map = new Map<string, string>()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds) map.set(sessionId, workspace.workspaceId)
  }
  return map
}

const RELATIVE_TIME_SUFFIX = { now: '', minutes: 'm', hours: 'h', days: 'd', months: 'mo', years: 'y' } as const

/** Row age ("22h") read off updatedAt; Host buckets keep it in step with other session surfaces. */
const formatAge = (updatedAt: number): string => {
  const age = relativeTime(updatedAt, Date.now())
  return age.unit === 'now' ? 'now' : `${age.n}${RELATIVE_TIME_SUFFIX[age.unit]}`
}

type RowOperation = 'pin' | 'unpin' | 'archive' | 'unarchive'

interface RowActions {
  readonly open: (sessionId: SessionSummary['id']) => void
  readonly mutate: (sessionId: SessionSummary['id'], operation: RowOperation) => Promise<void>
  readonly toggleParked: (sessionId: SessionSummary['id']) => void
  readonly copy: (value: string, successMessage: string) => Promise<void>
  readonly toggleChildren: (sessionId: SessionSummary['id']) => void
  readonly toggleAllChildren: (sessionId: SessionSummary['id']) => void
  readonly translate: ThreadSidebarTranslate
}

interface RowStyle {
  readonly density: ThreadRowDensity
  readonly project: boolean
  readonly projectColor: boolean
  readonly title: boolean
  readonly machine: boolean
  readonly path: boolean
  readonly time: boolean
  readonly statusDot: boolean
  readonly maxChildren: number
}

interface ThreadRowProps {
  readonly session: SessionSummary
  readonly archived: boolean
  readonly pinned: boolean
  readonly parked: boolean
  readonly selected: boolean
  readonly parentTitle: string | undefined
  readonly workspaceId: string | undefined
  readonly workspaceTitle: string | undefined
  readonly machine: string | undefined
  readonly age: string
  readonly rowStyle: RowStyle
  readonly childThreads: readonly SessionSummary[]
  readonly childrenOpen: boolean
  readonly allChildrenShown: boolean
  /** Set only when the open thread is one of this row's children, so other rows skip re-rendering. */
  readonly selectedChildId: SessionSummary['id'] | undefined
  readonly actions: RowActions
}

const NO_CHILDREN: readonly SessionSummary[] = []

const withTooltip = (label: string, anchor: ReactElement): JSX.Element => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="dshx:inline-flex">{anchor}</span>
    </TooltipTrigger>
    <TooltipContent side="top">{label}</TooltipContent>
  </Tooltip>
)

const statusDotClass = (session: SessionSummary): string => {
  if (session.attention?.unread) return 'dshx:bg-primary'
  if (session.running) return 'dshx:animate-pulse dshx:bg-info'
  return 'dshx:bg-muted-foreground/45'
}

const StatusDot = (props: { readonly session: SessionSummary; readonly unreadLabel: string }): JSX.Element => {
  const unread = Boolean(props.session.attention?.unread)
  return (
    <span
      className={cn('dshx:size-2 dshx:shrink-0 dshx:rounded-full', statusDotClass(props.session))}
      role={unread ? 'img' : undefined}
      aria-label={unread ? props.unreadLabel : undefined}
      aria-hidden={unread ? undefined : true}
    />
  )
}

const ChildThreadList = (props: {
  readonly parentId: SessionSummary['id']
  readonly childThreads: readonly SessionSummary[]
  readonly allShown: boolean
  readonly selectedChildId: SessionSummary['id'] | undefined
  readonly rowStyle: RowStyle
  readonly actions: RowActions
}): JSX.Element => {
  const t = props.actions.translate
  const { shown, hiddenCount } = visibleChildren({
    children: props.childThreads,
    limit: props.rowStyle.maxChildren,
    showAll: props.allShown,
    selectedId: props.selectedChildId,
  })
  const compact = props.rowStyle.density === 'compact'
  const lineClass = cn(
    'dshx:flex dshx:w-full dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2 dshx:text-left dshx:outline-none dshx:hover:bg-accent/60 dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50',
    compact ? 'dshx:h-6 dshx:text-xs' : 'dshx:h-7 dshx:text-sm',
  )
  return (
    <ul className="dshx:mb-1 dshx:ml-3.5 dshx:flex dshx:flex-col dshx:border-l dshx:pl-1.5" aria-label={t('threadSidebarChildThreads')}>
      {shown.map(child => (
        <li key={child.id}>
          <button
            type="button"
            className={cn(lineClass, 'dshx:data-[selected=true]:bg-accent')}
            data-selected={child.id === props.selectedChildId}
            title={new Date(child.updatedAt).toLocaleString()}
            onClick={() => props.actions.open(child.id)}
          >
            <StatusDot session={child} unreadLabel={t('threadSidebarUnread')} />
            <span className={cn('dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-foreground', child.attention?.unread && 'dshx:font-semibold')}>
              {child.displayTitle}
            </span>
            {props.rowStyle.time ? (
              <span className="dshx:shrink-0 dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground">{formatAge(child.updatedAt)}</span>
            ) : null}
          </button>
        </li>
      ))}
      {hiddenCount > 0 || props.allShown ? (
        <li>
          <button
            type="button"
            className={cn(lineClass, 'dshx:text-muted-foreground dshx:hover:text-foreground')}
            aria-expanded={props.allShown}
            onClick={() => props.actions.toggleAllChildren(props.parentId)}
          >
            {props.allShown ? t('threadSidebarFewerChildren') : `${hiddenCount} ${t('threadSidebarMoreChildren')}`}
          </button>
        </li>
      ) : null}
    </ul>
  )
}

/** Memoized so a session update re-renders only its own row, not the whole list. */
const ThreadRow = memo((props: ThreadRowProps): JSX.Element => {
  const { session, archived, pinned, parked, rowStyle } = props
  const t = props.actions.translate
  const unread = Boolean(session.attention?.unread)
  const compact = rowStyle.density === 'compact'
  const childCount = props.childThreads.length
  const showProject = rowStyle.project || props.parentTitle !== undefined
  const showMachine = rowStyle.machine && props.machine !== undefined
  const showPath = rowStyle.path && session.cwd !== undefined && session.cwd.length > 0
  const metaLine = showProject || showMachine || showPath || childCount > 0
  const headLine = rowStyle.title || rowStyle.time || rowStyle.statusDot
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <article className="dshx:group/row dshx:relative dshx:min-w-0" data-selected={props.selected}>
          <div className="dshx:relative dshx:rounded-md dshx:hover:bg-accent/60 dshx:focus-within:bg-accent/60 dshx:group-data-[selected=true]/row:bg-accent">
            <button
              type="button"
              className={cn(
                'dshx:flex dshx:w-full dshx:min-w-0 dshx:flex-col dshx:rounded-md dshx:text-left dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:disabled:cursor-default',
                compact ? 'dshx:gap-0.5 dshx:px-2 dshx:py-1.5' : 'dshx:gap-1 dshx:px-2.5 dshx:py-2.5',
              )}
              disabled={archived}
              title={new Date(session.updatedAt).toLocaleString()}
              onClick={() => props.actions.open(session.id)}
            >
              {headLine ? (
                <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
                  {rowStyle.statusDot ? <StatusDot session={session} unreadLabel={t('threadSidebarUnread')} /> : null}
                  <span
                    className={cn(
                      'dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-foreground',
                      compact ? 'dshx:text-sm' : 'dshx:text-base',
                      unread && 'dshx:font-semibold',
                    )}
                  >
                    {rowStyle.title ? session.displayTitle : null}
                  </span>
                  {rowStyle.time ? (
                    <span
                      className={cn(
                        'dshx:shrink-0 dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground',
                        session.running && 'dshx:font-medium dshx:text-info',
                      )}
                    >
                      {session.running ? `${t('threadSidebarWorking')} · ` : ''}
                      {props.age}
                    </span>
                  ) : null}
                </span>
              ) : null}
              {metaLine ? (
                <span
                  className={cn(
                    'dshx:flex dshx:min-h-4 dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:text-muted-foreground',
                    rowStyle.statusDot && 'dshx:pl-4',
                    childCount > 0 && 'dshx:pr-16',
                  )}
                >
                  {showProject ? (
                    <span
                      className={cn(
                        'dshx:truncate dshx:font-medium',
                        rowStyle.projectColor && props.workspaceTitle !== undefined && projectTextTone(props.workspaceTitle),
                        (showMachine || showPath || props.parentTitle !== undefined) && 'dshx:max-w-[55%] dshx:shrink-0',
                      )}
                    >
                      {props.workspaceTitle ?? t('threadSidebarUnassigned')}
                    </span>
                  ) : null}
                  {props.parentTitle === undefined ? null : (
                    <span className="dshx:min-w-0 dshx:truncate">
                      {t('threadSidebarChildOf')} {props.parentTitle}
                    </span>
                  )}
                  {showMachine ? (
                    <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1">
                      <MonitorIcon className="dshx:size-3 dshx:shrink-0" aria-hidden="true" />
                      <span className="dshx:truncate">{props.machine}</span>
                    </span>
                  ) : null}
                  {showPath ? (
                    <span className="dshx:min-w-0 dshx:truncate" title={session.cwd}>
                      {session.cwd}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </button>
            {childCount > 0 ? (
              <button
                type="button"
                className="dshx:absolute dshx:right-1.5 dshx:bottom-1 dshx:flex dshx:h-5 dshx:items-center dshx:gap-1 dshx:rounded-full dshx:px-1.5 dshx:text-xs dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
                aria-expanded={props.childrenOpen}
                aria-label={`${t(props.childrenOpen ? 'threadSidebarHideChildren' : 'threadSidebarShowChildren')} (${childCount})`}
                onClick={() => props.actions.toggleChildren(session.id)}
              >
                <span className="dshx:flex dshx:-space-x-0.5" aria-hidden="true">
                  {props.childThreads.slice(0, 3).map(child => (
                    <span key={child.id} className={cn('dshx:size-2 dshx:rounded-full dshx:ring-1 dshx:ring-background', statusDotClass(child))} />
                  ))}
                </span>
                <span className="dshx:tabular-nums dshx:font-medium">{childCount}</span>
                {props.childrenOpen ? (
                  <ChevronUpIcon className="dshx:size-3" aria-hidden="true" />
                ) : (
                  <ChevronDownIcon className="dshx:size-3" aria-hidden="true" />
                )}
              </button>
            ) : null}
            <div className="dshx:absolute dshx:top-1 dshx:right-1.5 dshx:flex dshx:gap-0.5 dshx:rounded-md dshx:border dshx:bg-popover dshx:p-0.5 dshx:opacity-0 dshx:shadow-xs dshx:transition-opacity dshx:group-hover/row:opacity-100 dshx:focus-within:opacity-100">
              {!archived ? (
                <>
                  {withTooltip(
                    t(pinned ? 'threadSidebarUnpin' : 'threadSidebarPin'),
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t(pinned ? 'threadSidebarUnpin' : 'threadSidebarPin')}
                      onClick={() => void props.actions.mutate(session.id, pinned ? 'unpin' : 'pin')}
                    >
                      {pinned ? <IconPinFillRegular size={14} /> : <IconPinOutlineRegular size={14} />}
                    </Button>,
                  )}
                  {withTooltip(
                    t(parked ? 'threadSidebarUnpark' : 'threadSidebarPark'),
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t(parked ? 'threadSidebarUnpark' : 'threadSidebarPark')}
                      disabled={session.running}
                      onClick={() => props.actions.toggleParked(session.id)}
                    >
                      {parked ? <IconPlayOutlineRegular size={14} /> : <IconPauseOutlineRegular size={14} />}
                    </Button>,
                  )}
                  {withTooltip(
                    t(session.running ? 'threadSidebarRunningNotice' : 'threadSidebarArchive'),
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t('threadSidebarArchive')}
                      disabled={session.running}
                      onClick={() => void props.actions.mutate(session.id, 'archive')}
                    >
                      <IconArchiveOutlineRegular size={14} />
                    </Button>,
                  )}
                </>
              ) : (
                withTooltip(
                  t('threadSidebarRestore'),
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t('threadSidebarRestore')}
                    onClick={() => void props.actions.mutate(session.id, 'unarchive')}
                  >
                    <IconUnarchiveOutlineRegular size={14} />
                  </Button>,
                )
              )}
            </div>
          </div>
          {childCount > 0 && props.childrenOpen ? (
            <ChildThreadList
              parentId={session.id}
              childThreads={props.childThreads}
              allShown={props.allChildrenShown}
              selectedChildId={props.selectedChildId}
              rowStyle={rowStyle}
              actions={props.actions}
            />
          ) : null}
        </article>
      </ContextMenuTrigger>
      <ContextMenuContent className="dshx-root dshx:min-w-44" aria-label={t('threadSidebarContextMenu')}>
        <ContextMenuItem onSelect={() => void props.actions.copy(session.id, t('threadSidebarIdCopied'))}>{t('threadSidebarCopyId')}</ContextMenuItem>
        <ContextMenuItem
          onSelect={() => void props.actions.copy(buildThreadUrl(window.location.href, session.id, props.workspaceId), t('threadSidebarLinkCopied'))}
        >
          {t('threadSidebarCopyLink')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        {archived ? (
          <ContextMenuItem onSelect={() => void props.actions.mutate(session.id, 'unarchive')}>{t('threadSidebarRestore')}</ContextMenuItem>
        ) : (
          <>
            <ContextMenuItem onSelect={() => void props.actions.mutate(session.id, pinned ? 'unpin' : 'pin')}>
              {t(pinned ? 'threadSidebarUnpin' : 'threadSidebarPin')}
            </ContextMenuItem>
            <ContextMenuItem disabled={session.running} onSelect={() => props.actions.toggleParked(session.id)}>
              {t(parked ? 'threadSidebarUnpark' : 'threadSidebarPark')}
            </ContextMenuItem>
            <ContextMenuItem disabled={session.running} onSelect={() => void props.actions.mutate(session.id, 'archive')}>
              {t('threadSidebarArchive')}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
})

export const ThreadSidebar = (props: ThreadSidebarProps): JSX.Element => {
  const sessionState = props.useSessions(state => state)
  const workspaceState = props.useWorkspaces(state => state)
  const { preferences, updatePreferences, storageWarning, closePalette, setSelectedThreadId, threadTitle } = useSidebarState()
  const machine = useApiQuery(threadSidebarMachineApi, 'name', { enabled: preferences.threadRowMachine }).data?.name
  const [closedParents, setClosedParents] = useState<ReadonlySet<string>>(() => new Set())
  const [expandedParents, setExpandedParents] = useState<ReadonlySet<string>>(() => new Set())
  const { paletteMode, destinations } = usePaletteState()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsId = useId()
  const [notice, setNotice] = useState<SidebarNotice | null>(null)
  useEffect(() => {
    if (notice === null) return
    return scheduleSuccessNoticeDismissal(notice, setNotice)
  }, [notice])
  const [routeRequest, setRouteRequest] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : (readThreadUrl(window.location.href)?.sessionId ?? null),
  )
  const archiveInFlight = useRef(false)
  const legacyParkMigrationAttempts = useRef(new Set<SessionSummary['id']>())
  const readMarkAttempts = useRef(new Map<SessionSummary['id'], number>())
  const openedRouteId = useRef<string | null>(null)
  const suppressUrlForSession = useRef<string | null>(null)
  const latestAutoArchive = useRef<{
    sessions: SessionSummary[]
    workspaceBySession: Map<string, string>
    preferences: SidebarPreferences
    archived: ReadonlySet<string>
    pinned: ReadonlySet<string>
    archive: ThreadSidebarProps['archiveSession']
    announce: (notice: SidebarNotice) => void
  } | null>(null)

  const workspaceBySession = useMemo(() => workspaceForSessions(workspaceState.items), [workspaceState.items])
  const archivedSessionIds = useMemo(() => setIncludes(workspaceState.archivedSessionIds), [workspaceState.archivedSessionIds])
  const pinnedSessionIds = useMemo(() => setIncludes(workspaceState.pinnedSessionIds), [workspaceState.pinnedSessionIds])
  const displayWorkspaces = useMemo(
    () =>
      workspaceState.items.map(workspace => ({
        id: workspace.workspaceId,
        title: workspace.title.length > 0 ? workspace.title : props.tSidebar('threadSidebarDefaultProject'),
      })),
    [props.tSidebar, workspaceState.items],
  )
  const sessions = useMemo(() => sessionsForAutoArchive(sessionState.ids, sessionState.byId), [sessionState.byId, sessionState.ids])
  const parkedSessionIds = useMemo(() => {
    const localFallback = setIncludes(preferences.parkedSessionIds)
    return new Set(
      sessions.flatMap(session => {
        const parked = session.attention === null || session.attention === undefined ? localFallback.has(session.id) : session.attention.snoozed
        return parked ? [session.id] : []
      }),
    )
  }, [preferences.parkedSessionIds, sessions])
  const selectedSession = useMemo(() => sessions.find(session => (session.retainedBy.mainView ?? 0) > 0), [sessions])

  useEffect(() => setSelectedThreadId(selectedSession?.id ?? null), [selectedSession?.id, setSelectedThreadId])
  threadTitle.current = sessionId => sessionState.byId[sessionId]?.displayTitle

  useEffect(() => {
    if (sessionState.phase !== 'ready') return
    const legacyParked = setIncludes(preferences.parkedSessionIds)
    for (const session of sessions) {
      if (
        !legacyParked.has(session.id) ||
        (session.attention !== null && session.attention !== undefined) ||
        legacyParkMigrationAttempts.current.has(session.id)
      )
        continue
      legacyParkMigrationAttempts.current.add(session.id)
      void props
        .setSnoozed(session.id, true)
        .then(success => {
          if (!success) {
            legacyParkMigrationAttempts.current.delete(session.id)
            setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarAttentionFailure') })
          }
        })
        .catch(() => {
          legacyParkMigrationAttempts.current.delete(session.id)
          setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarAttentionFailure') })
        })
    }
  }, [preferences.parkedSessionIds, props.setSnoozed, props.tSidebar, sessionState.phase, sessions])

  useEffect(() => {
    const attention = selectedSession?.attention
    if (selectedSession === undefined || attention === null || attention === undefined || !attention.unread) return
    if (readMarkAttempts.current.get(selectedSession.id) === attention.lastPromptSeq) return
    readMarkAttempts.current.set(selectedSession.id, attention.lastPromptSeq ?? -1)
    void props
      .markRead(selectedSession.id)
      .then(success => {
        if (!success) {
          readMarkAttempts.current.delete(selectedSession.id)
          setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarAttentionFailure') })
        }
      })
      .catch(() => {
        readMarkAttempts.current.delete(selectedSession.id)
        setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarAttentionFailure') })
      })
  }, [props.markRead, props.tSidebar, selectedSession])

  useEffect(() => {
    const onPopState = (): void => {
      const requested = readThreadUrl(window.location.href)?.sessionId ?? null
      suppressUrlForSession.current = requested === null ? (selectedSession?.id ?? null) : null
      openedRouteId.current = null
      setRouteRequest(requested)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [selectedSession?.id])

  useEffect(() => {
    if (routeRequest === null || sessionState.phase !== 'ready') return
    const target = sessions.find(session => session.id === routeRequest)
    if (target === undefined) {
      setNotice({ tone: 'warning', message: props.tSidebar('threadSidebarLinkNotFound') })
      window.history.replaceState(window.history.state, '', clearThreadUrl(window.location.href))
      setRouteRequest(null)
      return
    }
    if ((target.retainedBy.mainView ?? 0) > 0) {
      openedRouteId.current = routeRequest
      setRouteRequest(null)
      return
    }
    if (openedRouteId.current === routeRequest) return
    openedRouteId.current = routeRequest
    props.open(target.id)
  }, [props.open, props.tSidebar, routeRequest, sessions, sessionState.phase])

  useEffect(() => {
    const selected = selectedSession
    if (selected === undefined || routeRequest !== null) return
    if (suppressUrlForSession.current === selected.id) return
    suppressUrlForSession.current = null
    const workspaceId = workspaceForLineage(selected, sessionState.byId, workspaceBySession)
    const next = buildThreadUrl(window.location.href, selected.id, workspaceId)
    if (next !== window.location.href) window.history.replaceState(window.history.state, '', next)
  }, [routeRequest, selectedSession, sessionState.byId, workspaceBySession])

  const changePreferences = (patch: Partial<SidebarPreferences>): void => {
    updatePreferences(patch)
  }

  const mutateSession = async (sessionId: SessionSummary['id'], operation: (sessionId: SessionSummary['id']) => Promise<void>): Promise<void> => {
    try {
      await operation(sessionId)
      setNotice(null)
    } catch {
      setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarArchiveFailure') })
    }
  }

  const openThread = (sessionId: SessionSummary['id']): void => {
    setRouteRequest(null)
    openedRouteId.current = sessionId
    suppressUrlForSession.current = null
    const session = sessionState.byId[sessionId]
    const workspaceId = session === undefined ? undefined : workspaceForLineage(session, sessionState.byId, workspaceBySession)
    window.history.replaceState(window.history.state, '', buildThreadUrl(window.location.href, sessionId, workspaceId))
    props.open(sessionId)
  }

  const copyContextValue = async (value: string, successMessage: string): Promise<void> => {
    setNotice(
      (await writeClipboard(value))
        ? { tone: 'success', message: successMessage }
        : { tone: 'danger', message: props.tSidebar('threadSidebarClipboardFailure') },
    )
  }

  const toggleParked = (sessionId: SessionSummary['id']): void => {
    void props
      .setSnoozed(sessionId, !parkedSessionIds.has(sessionId))
      .then(success => {
        if (!success) setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarAttentionFailure') })
        else setNotice(null)
      })
      .catch(() => {
        setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarAttentionFailure') })
      })
  }

  const toggleSection = (section: SidebarSection): void => {
    changePreferences({
      collapsedSections: toggleCollapsedSection(preferences.collapsedSections, section),
    })
  }

  const runAutoArchive = async (): Promise<void> => {
    const latest = latestAutoArchive.current
    if (archiveInFlight.current || latest === null || !latest.preferences.autoArchiveEnabled) return
    archiveInFlight.current = true
    let failed = false
    try {
      const now = Date.now()
      for (const session of latest.sessions) {
        const activity: SessionActivity = session
        if (
          !isAutoArchiveCandidate({
            session: activity,
            workspaceId: latest.workspaceBySession.get(session.id),
            now,
            preferences: latest.preferences,
            archivedSessionIds: latest.archived,
            pinnedSessionIds: latest.pinned,
          })
        )
          continue
        try {
          await latest.archive(session.id)
        } catch {
          failed = true
        }
      }
    } finally {
      archiveInFlight.current = false
    }
    if (failed) latest.announce({ tone: 'danger', message: props.tSidebar('threadSidebarArchiveFailure') })
  }

  latestAutoArchive.current = {
    sessions,
    workspaceBySession,
    preferences,
    archived: archivedSessionIds,
    pinned: pinnedSessionIds,
    archive: props.archiveSession,
    announce: setNotice,
  }

  useEffect(() => {
    if (!preferences.autoArchiveEnabled) return
    if (sessionState.phase !== 'ready' || workspaceState.phase !== 'ready') return
    void runAutoArchive()
    const timer = window.setInterval(() => void runAutoArchive(), preferences.scanIntervalMinutes * 60_000)
    return () => window.clearInterval(timer)
  }, [preferences.autoArchiveEnabled, preferences.scanIntervalMinutes, sessionState.phase, workspaceState.phase])

  const threadTree = useMemo(() => {
    const listed: SessionSummary[] = []
    for (const sessionId of sessionState.ids) {
      const session = sessionState.byId[sessionId]
      if (session === undefined || session.blank) continue
      const workspaceId = workspaceForLineage(session, sessionState.byId, workspaceBySession)
      if (preferences.workspaceFilter !== null && (workspaceId ?? '') !== preferences.workspaceFilter) continue
      listed.push(session)
    }
    return groupThreadChildren({
      threads: listed,
      canNest: (child, ancestor) => archivedSessionIds.has(child.id) === archivedSessionIds.has(ancestor.id),
    })
  }, [archivedSessionIds, preferences.workspaceFilter, sessionState.byId, sessionState.ids, workspaceBySession])

  const rowsBySection = useMemo(() => {
    const rows = new Map<SidebarSection, SessionSummary[]>(sections.map(section => [section, []]))
    for (const session of threadTree.roots) {
      // A parent waiting on a running subagent is still active work.
      const running = session.running || (threadTree.childrenByRoot.get(session.id) ?? NO_CHILDREN).some(child => child.running)
      const section = sectionForSession({ id: session.id, running }, archivedSessionIds, pinnedSessionIds, parkedSessionIds)
      rows.get(section)?.push(session)
    }
    for (const entries of rows.values()) entries.sort((left, right) => right.updatedAt - left.updatedAt)
    rows.set(
      'pinned',
      rows.get('pinned')?.sort((left, right) => workspaceState.pinnedSessionIds.indexOf(left.id) - workspaceState.pinnedSessionIds.indexOf(right.id)) ?? [],
    )
    return rows
  }, [archivedSessionIds, parkedSessionIds, pinnedSessionIds, threadTree, workspaceState.pinnedSessionIds])

  const rowStyle = useMemo<RowStyle>(
    () => ({
      density: preferences.threadRowDensity,
      project: preferences.threadRowProject,
      projectColor: preferences.threadRowProjectColor,
      title: preferences.threadRowTitle,
      machine: preferences.threadRowMachine,
      path: preferences.threadRowPath,
      time: preferences.threadRowTime,
      statusDot: preferences.threadRowStatusDot,
      maxChildren: preferences.maxChildren,
    }),
    [
      preferences.maxChildren,
      preferences.threadRowDensity,
      preferences.threadRowMachine,
      preferences.threadRowPath,
      preferences.threadRowProject,
      preferences.threadRowProjectColor,
      preferences.threadRowStatusDot,
      preferences.threadRowTime,
      preferences.threadRowTitle,
    ],
  )

  const paletteThreads = useMemo(() => {
    if (paletteMode === null) return { candidates: [], byCandidateId: new Map<string, SessionSummary>() }
    const titles = new Map<string, string>(displayWorkspaces.map(workspace => [workspace.id, workspace.title]))
    const byCandidateId = new Map<string, SessionSummary>()
    const candidates: ThreadCandidate[] = []
    for (const session of sessions) {
      if (session.blank || archivedSessionIds.has(session.id)) continue
      const workspaceId = workspaceForLineage(session, sessionState.byId, workspaceBySession)
      byCandidateId.set(session.id, session)
      candidates.push({
        id: session.id,
        title: session.displayTitle,
        project: workspaceId === undefined ? '' : (titles.get(workspaceId) ?? ''),
        cwd: session.cwd ?? '',
        updatedAt: session.updatedAt,
      })
    }
    return { candidates, byCandidateId }
  }, [archivedSessionIds, displayWorkspaces, paletteMode, sessionState.byId, sessions, workspaceBySession])

  const projectFilterValue =
    preferences.workspaceFilter === null ? ALL_PROJECTS : preferences.workspaceFilter.length === 0 ? UNASSIGNED_PROJECT : preferences.workspaceFilter

  const selectProject = (value: string): void => {
    setSettingsOpen(false)
    if (value === ALL_PROJECTS) changePreferences({ workspaceFilter: null })
    else if (value === UNASSIGNED_PROJECT) changePreferences({ workspaceFilter: '' })
    else changePreferences({ workspaceFilter: value })
  }

  const projectOptions = [
    { id: ALL_PROJECTS, label: props.tSidebar('threadSidebarAllProjects') },
    { id: UNASSIGNED_PROJECT, label: props.tSidebar('threadSidebarUnassigned') },
    ...displayWorkspaces.map(workspace => ({ id: workspace.id, label: workspace.title })),
  ]

  const projectFilterLabel = projectOptions.find(option => option.id === projectFilterValue)?.label ?? props.tSidebar('threadSidebarAllProjects')

  const latestRowActions = useRef({ openThread, mutateSession, toggleParked, copyContextValue, props })
  latestRowActions.current = { openThread, mutateSession, toggleParked, copyContextValue, props }
  // One stable object for every row; it reads the latest closures so memoized rows never go stale.
  const rowActions = useMemo<RowActions>(() => {
    const operations = {
      pin: () => latestRowActions.current.props.pinSession,
      unpin: () => latestRowActions.current.props.unpinSession,
      archive: () => latestRowActions.current.props.archiveSession,
      unarchive: () => latestRowActions.current.props.unarchiveSession,
    } satisfies Record<RowOperation, () => (sessionId: SessionSummary['id']) => Promise<void>>
    return {
      open: sessionId => latestRowActions.current.openThread(sessionId),
      mutate: (sessionId, operation) => latestRowActions.current.mutateSession(sessionId, operations[operation]()),
      toggleParked: sessionId => latestRowActions.current.toggleParked(sessionId),
      copy: (value, successMessage) => latestRowActions.current.copyContextValue(value, successMessage),
      toggleChildren: sessionId => setClosedParents(current => toggleSetMember(current, sessionId)),
      toggleAllChildren: sessionId => setExpandedParents(current => toggleSetMember(current, sessionId)),
      translate: (...args) => latestRowActions.current.props.tSidebar(...args),
    }
  }, [])

  return (
    <TooltipProvider delayDuration={500}>
      <section
        className="dshx-root dshx:flex dshx:h-full dshx:w-full dshx:min-h-0 dshx:min-w-0 dshx:flex-col"
        aria-label={props.tSidebar('threadSidebarTitle')}
      >
        {paletteMode === null ? null : (
          <ThreadPalette
            mode={paletteMode}
            threads={paletteThreads.candidates}
            destinations={destinations}
            recentLimit={preferences.paletteRecentLimit}
            mac={isMacPlatform(navigator.platform)}
            onClose={closePalette}
            searchContent={props.searchContent}
            onOpenThread={candidateId => {
              const session = paletteThreads.byCandidateId.get(candidateId)
              if (session !== undefined) openThread(session.id)
            }}
            copy={{
              title: props.tSidebar('threadSidebarPaletteTitle'),
              threadsPlaceholder: props.tSidebar('threadSidebarPaletteThreadsPlaceholder'),
              allPlaceholder: props.tSidebar('threadSidebarPaletteAllPlaceholder'),
              filesPlaceholder: props.tSidebar('threadSidebarPaletteFilesPlaceholder'),
              commands: props.tSidebar('threadSidebarPaletteCommands'),
              files: props.tSidebar('threadSidebarPaletteFiles'),
              goToFile: props.tSidebar('threadSidebarPaletteGoToFile'),
              filesIndexing: props.tSidebar('threadSidebarPaletteFilesIndexing'),
              filesTruncated: props.tSidebar('threadSidebarPaletteFilesTruncated'),
              filesNoSession: props.tSidebar('threadSidebarPaletteFilesNoSession'),
              filesUnavailable: props.tSidebar('threadSidebarPaletteFilesUnavailable'),
              prefixHint: props.tSidebar('threadSidebarPalettePrefixHint'),
              viewAll: props.tSidebar('threadSidebarPaletteViewAll'),
              viewCommands: props.tSidebar('threadSidebarPaletteCommands'),
              viewContent: props.tSidebar('threadSidebarPaletteViewContent'),
              viewLine: props.tSidebar('threadSidebarPaletteViewLine'),
              viewHelp: props.tSidebar('threadSidebarPaletteViewHelp'),
              commandsPlaceholder: props.tSidebar('threadSidebarPaletteCommandsPlaceholder'),
              contentPlaceholder: props.tSidebar('threadSidebarPaletteContentPlaceholder'),
              linePlaceholder: props.tSidebar('threadSidebarPaletteLinePlaceholder'),
              helpPlaceholder: props.tSidebar('threadSidebarPaletteHelpPlaceholder'),
              helpCommands: props.tSidebar('threadSidebarPaletteHelpCommands'),
              helpContent: props.tSidebar('threadSidebarPaletteHelpContent'),
              helpLine: props.tSidebar('threadSidebarPaletteHelpLine'),
              helpNone: props.tSidebar('threadSidebarPaletteHelpNone'),
              goToLine: props.tSidebar('threadSidebarPaletteGoToLine'),
              noEditorFile: props.tSidebar('threadSidebarPaletteNoEditorFile'),
              contentSearching: props.tSidebar('threadSidebarPaletteContentSearching'),
              contentUnavailable: props.tSidebar('threadSidebarPaletteContentUnavailable'),
              recent: props.tSidebar('threadSidebarPaletteRecent'),
              threads: props.tSidebar('threadSidebarTitle'),
              destinations: props.tSidebar('threadSidebarPaletteDestinations'),
              empty: props.tSidebar('threadSidebarPaletteEmpty'),
              navigate: props.tSidebar('threadSidebarPaletteNavigate'),
              open: props.tSidebar('threadSidebarPaletteOpen'),
              close: props.tSidebar('threadSidebarPaletteClose'),
              unassigned: props.tSidebar('threadSidebarUnassigned'),
            }}
          />
        )}
        <header className="dshx:px-2 dshx:py-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="dshx:h-8 dshx:w-full dshx:justify-between dshx:px-2.5 dshx:text-base dshx:font-medium dshx:data-[settings-open=true]:text-muted-foreground"
                data-settings-open={settingsOpen}
              >
                <span className="dshx:truncate">{projectFilterLabel}</span>
                <span className="dshx:inline-flex dshx:text-muted-foreground" aria-hidden="true">
                  <IconChevronDownOutlineRegular size={14} />
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="dshx-root dshx:w-(--radix-dropdown-menu-trigger-width) dshx:min-w-56">
              <DropdownMenuRadioGroup value={projectFilterValue} onValueChange={selectProject}>
                {projectOptions.map(option => (
                  <DropdownMenuRadioItem key={option.id} value={option.id}>
                    <span className="dshx:truncate">{option.label}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem checked={settingsOpen} onCheckedChange={() => setSettingsOpen(current => !current)}>
                {props.tSidebar('threadSidebarSettings')}
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        {settingsOpen ? (
          <section
            className="dshx:mx-2 dshx:mb-2 dshx:grid dshx:gap-3 dshx:rounded-lg dshx:border dshx:bg-card dshx:p-3"
            aria-label={props.tSidebar('threadSidebarSettings')}
          >
            <Label className="dshx:font-normal dshx:leading-snug">
              <Checkbox checked={preferences.autoArchiveEnabled} onCheckedChange={checked => changePreferences({ autoArchiveEnabled: checked === true })} />
              {props.tSidebar('threadSidebarAutoArchive')}
            </Label>
            <div className="dshx:grid dshx:grid-cols-2 dshx:gap-2">
              <div className="dshx:grid dshx:content-start dshx:gap-1.5">
                <Label htmlFor={`${settingsId}-idle`} className="dshx:text-xs dshx:font-normal dshx:leading-snug dshx:text-muted-foreground">
                  {props.tSidebar('threadSidebarIdleAfter')}
                </Label>
                <Input
                  id={`${settingsId}-idle`}
                  className="dshx:h-7"
                  type="number"
                  min={15}
                  max={10080}
                  value={preferences.idleMinutes}
                  onChange={event => {
                    const value = Number(event.currentTarget.value)
                    if (Number.isInteger(value) && value >= 15 && value <= 10080) changePreferences({ idleMinutes: value })
                  }}
                />
              </div>
              <div className="dshx:grid dshx:content-start dshx:gap-1.5">
                <Label htmlFor={`${settingsId}-scan`} className="dshx:text-xs dshx:font-normal dshx:leading-snug dshx:text-muted-foreground">
                  {props.tSidebar('threadSidebarScanEvery')}
                </Label>
                <Input
                  id={`${settingsId}-scan`}
                  className="dshx:h-7"
                  type="number"
                  min={1}
                  max={120}
                  value={preferences.scanIntervalMinutes}
                  onChange={event => {
                    const value = Number(event.currentTarget.value)
                    if (Number.isInteger(value) && value >= 1 && value <= 120) changePreferences({ scanIntervalMinutes: value })
                  }}
                />
              </div>
            </div>
            <fieldset className="dshx:grid dshx:min-w-0 dshx:gap-2 dshx:rounded-md dshx:border dshx:px-2.5 dshx:pt-1 dshx:pb-2.5">
              <legend className="dshx:px-1 dshx:text-xs dshx:text-muted-foreground">{props.tSidebar('threadSidebarExcludedProjects')}</legend>
              {displayWorkspaces.map(workspace => (
                <Label key={workspace.id} className="dshx:min-w-0 dshx:font-normal">
                  <Checkbox
                    checked={preferences.excludedWorkspaceIds.includes(workspace.id)}
                    onCheckedChange={checked => {
                      const next =
                        checked === true
                          ? [...preferences.excludedWorkspaceIds, workspace.id]
                          : preferences.excludedWorkspaceIds.filter(id => id !== workspace.id)
                      changePreferences({ excludedWorkspaceIds: next })
                    }}
                  />
                  <span className="dshx:truncate">{workspace.title}</span>
                </Label>
              ))}
            </fieldset>
            <div className="dshx:grid dshx:gap-1.5">
              <Label htmlFor={`${settingsId}-sessions`} className="dshx:text-xs dshx:font-normal dshx:text-muted-foreground">
                {props.tSidebar('threadSidebarExcludedSessions')}
              </Label>
              <Textarea
                id={`${settingsId}-sessions`}
                className="dshx:min-h-14 dshx:font-mono! dshx:text-xs"
                rows={3}
                aria-describedby={`${settingsId}-sessions-hint`}
                value={preferences.excludedSessionIds.join('\n')}
                onChange={event => changePreferences({ excludedSessionIds: parseSessionIds(event.currentTarget.value) })}
              />
              <p id={`${settingsId}-sessions-hint`} className="dshx:text-xs dshx:text-muted-foreground">
                {props.tSidebar('threadSidebarExclusionHint')}
              </p>
            </div>
            <p className="dshx:text-xs dshx:text-muted-foreground">{props.tSidebar('threadSidebarTimestampNote')}</p>
          </section>
        ) : null}

        {notice !== null || storageWarning ? (
          <div className="dshx:grid dshx:gap-2 dshx:px-2 dshx:pb-2">
            {notice !== null ? (
              <Alert variant={notice.tone === 'danger' ? 'destructive' : notice.tone} className={noticeClass}>
                <SidebarNoticeMessage message={notice.message} />
              </Alert>
            ) : null}
            {storageWarning ? (
              <Alert variant="warning" className={noticeClass}>
                <SidebarNoticeMessage message={props.tSidebar('threadSidebarStorageFailure')} />
              </Alert>
            ) : null}
          </div>
        ) : null}

        <div className="dshx:min-h-0 dshx:flex-1 dshx:overflow-auto dshx:px-2 dshx:pb-3">
          {sessionState.phase !== 'ready' || workspaceState.phase !== 'ready' ? (
            <div className="dshx:flex dshx:items-center dshx:justify-center dshx:gap-2 dshx:py-6 dshx:text-sm dshx:text-muted-foreground">
              <Spinner />
              {props.tSidebar('threadSidebarLoading')}
            </div>
          ) : null}
          {sections.map(section => {
            const rows = rowsBySection.get(section) ?? []
            if (rows.length === 0 && section !== 'active') return null
            const collapsed = preferences.collapsedSections.includes(section)
            return (
              <section className="dshx:mt-1" key={section}>
                <button
                  type="button"
                  className="dshx:flex dshx:h-8 dshx:w-full dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2.5 dshx:text-sm dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
                  aria-expanded={!collapsed}
                  onClick={() => toggleSection(section)}
                >
                  <span className="dshx:inline-flex dshx:shrink-0" aria-hidden="true">
                    {sectionIcons[section]}
                  </span>
                  <span className="dshx:whitespace-nowrap">{props.tSidebar(sectionLabels[section])}</span>
                  <span className="dshx:text-xs dshx:tabular-nums">({rows.length})</span>
                  <span className="dshx:h-px dshx:flex-1 dshx:bg-border" aria-hidden="true" />
                  <span className="dshx:inline-flex dshx:shrink-0" aria-hidden="true">
                    {collapsed ? <IconChevronDownOutlineRegular size={12} /> : <IconChevronUpOutlineRegular size={12} />}
                  </span>
                </button>
                {!collapsed
                  ? rows.map(session => {
                      const lineage = sessionLineage(session, sessionState.byId)
                      const workspaceId = workspaceForLineage(session, sessionState.byId, workspaceBySession)
                      const childThreads = threadTree.childrenByRoot.get(session.id) ?? NO_CHILDREN
                      const selectedChildId = childThreads.some(child => child.id === selectedSession?.id) ? selectedSession?.id : undefined
                      return (
                        <ThreadRow
                          key={session.id}
                          session={session}
                          archived={archivedSessionIds.has(session.id)}
                          pinned={pinnedSessionIds.has(session.id)}
                          parked={parkedSessionIds.has(session.id)}
                          selected={selectedSession?.id === session.id}
                          parentTitle={lineage.parentTitle}
                          workspaceId={workspaceId}
                          workspaceTitle={displayWorkspaces.find(workspace => workspace.id === workspaceId)?.title}
                          machine={machine}
                          age={formatAge(session.updatedAt)}
                          rowStyle={rowStyle}
                          childThreads={childThreads}
                          childrenOpen={!closedParents.has(session.id)}
                          allChildrenShown={expandedParents.has(session.id)}
                          selectedChildId={selectedChildId}
                          actions={rowActions}
                        />
                      )
                    })
                  : null}
              </section>
            )
          })}
          {sessionState.phase === 'ready' && [...rowsBySection.values()].every(rows => rows.length === 0) ? (
            <Empty className="dshx:gap-2 dshx:p-6 dshx:md:p-6">
              <EmptyTitle className="dshx:text-sm dshx:font-normal dshx:text-muted-foreground">{props.tSidebar('threadSidebarEmpty')}</EmptyTitle>
            </Empty>
          ) : null}
        </div>
      </section>
    </TooltipProvider>
  )
}
