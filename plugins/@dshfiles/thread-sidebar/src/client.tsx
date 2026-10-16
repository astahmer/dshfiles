import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceBrowserProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { jjIntegrationApi } from '@dshfiles/jj-integration/api'
import { RemoteThreadsSection } from './remote-threads-section.js'
import type { ActorRefFrom } from '@dshfiles/plugin-ui/machine'
import type { archivedViewMachine } from './archived-view-machine.js'
import { useApi, useApiQuery } from '@dshfiles/dshx/client'
import { PluginQueryProvider, useQuery } from '@dshfiles/plugin-ui/query'
import { threadSidebarPendingQuestionsApi } from './pending-questions-api.js'
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
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/context-menu'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
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
import {
  ActivityIcon,
  BellIcon,
  BellOffIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CirclePauseIcon,
  LinkIcon,
  MonitorIcon,
  Settings2Icon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { z } from 'zod'
import {
  autoArchiveOverrideForSession,
  isAutoArchiveCandidate,
  isAttentionSessionIncluded,
  REBASED_THREAD_ARCHIVE_DELAYS,
  type RebasedThreadArchiveDelay,
  nextIdleTransitionAt,
  parseSessionIds,
  sessionLineage,
  sectionForSession,
  setAutoArchiveOverride as updateAutoArchiveOverride,
  shouldScanForAutoArchive,
  type AutoArchiveOverride,
  type AttentionColor,
  type AttentionColorKey,
  type AttentionColors,
  type SidebarPreferences,
  type SidebarSection,
  type ThreadRowDensity,
  projectWorkspaces,
  workspaceForLineage,
  workspaceForSessions,
} from './organization.js'
import { attentionColorDotClass, attentionDotClass, attentionLabelClass, type ThreadAttentionLabel } from './attention-presentation.js'
import { attentionColorSchema, toggleCollapsedSection } from './preferences.js'
import { selectInputNeededRows, selectTurnFinishedRows } from './attention-rows.js'
import { registerPaletteAction, setPaletteRecentLimit, type PaletteAction } from '@dshfiles/command-palette/api'
import { useSidebarState } from './sidebar-state.js'
import { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'
import { projectTextTone } from './project-tone.js'
import { archivedOpenFailureNotice, scheduleSuccessNoticeDismissal, SidebarNoticeMessage, type SidebarNotice } from './sidebar-notice.js'
import { threadSidebarMachineApi } from './machine-api.js'
import { groupThreadChildren, partitionFinishedChildren, shouldOpenChildThreadList, threadActionTargetIds, visibleChildren } from './thread-children.js'
import { buildThreadUrl, clearThreadUrl, readThreadUrl } from './thread-url.js'
import { workingThreadIds } from './working-threads.js'
import { indexRebasedThreadSessions, rebasedThreadArchiveDelayMs } from './rebased-threads.js'
import {
  groupThreadEntries,
  isSideChat,
  matchesThreadSourceFilter,
  matchesThreadStatusFilter,
  THREAD_GROUP_BY_OPTIONS,
  THREAD_SOURCE_FILTER_OPTIONS,
  THREAD_STATUS_FILTER_OPTIONS,
  type ThreadGroupBy,
  type ThreadSourceFilter,
  type ThreadViewPreferences,
} from './thread-view.js'
import {
  activeThreadView,
  DEFAULT_THREAD_VIEW_SETTINGS,
  decodeThreadViewPreferences,
  selectThreadView,
  threadViewPreferences,
  updateThreadViewPreferences,
  updateThreadViewSettings,
  type ThreadViewSettings,
} from './thread-view-preferences.js'
import { ThreadViewManager, threadViewPresetLabel } from './thread-view-manager.js'
import { captureThreadMentionInsertion, requestThreadMentionInsertion } from './thread-mention.js'
import {
  DEFAULT_THREAD_NOTIFICATION_PREFERENCES,
  isThreadUnread,
  markThreadSeen,
  markThreadUnread,
  reconcileFinishedThreadNotifications,
  threadAttentionTransitions,
  threadNotificationPreferences,
  type ThreadAttentionStatus,
} from './thread-notifications.js'
import {
  effectiveActivityAt,
  isMuteActive,
  legacyMutesToMigrate,
  muteRemaining,
  muteOptionLabelKeys,
  muteSessions,
  muteUntil,
  nextMuteExpiry,
  THREAD_MUTE_OPTIONS,
  unmuteSessions,
  withoutExpiredMutes,
  type ThreadMute,
  type ThreadMuteOption,
} from './thread-mute.js'

type InjectedActions = {
  archiveSession: (sessionId: SessionSummary['id']) => Promise<void>
  unarchiveSession: (sessionId: SessionSummary['id']) => Promise<void>
  pinSession: (sessionId: SessionSummary['id']) => Promise<void>
  unpinSession: (sessionId: SessionSummary['id']) => Promise<void>
  /** Show the remote thread view; set when the layout service is available. */
  openRemoteThreads?: () => void
  /** Reports archived threads that failed to open or keep being closed by DSH. */
  archivedView?: ActorRefFrom<typeof archivedViewMachine>
}

type ThreadSidebarProps = Pick<WorkspaceBrowserProps, 'open' | 'useSessions' | 'useSessionStatus' | 'useWorkspaces'> &
  InjectedActions & {
    tSidebar: TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>
  }

type ThreadSidebarTranslate = ThreadSidebarProps['tSidebar']
const emptyThreadsMessage = {
  all: 'threadSidebarEmpty',
  working: 'threadSidebarNoWorkingThreads',
  'not-working': 'threadSidebarNoNotWorkingThreads',
  attention: 'threadSidebarNoAttentionThreads',
  muted: 'threadSidebarNoMutedThreads',
  archived: 'threadSidebarNoArchivedThreads',
} as const satisfies Record<(typeof THREAD_STATUS_FILTER_OPTIONS)[number], string>
type AttentionDisplayPreferenceKey = 'approvalNeededDisplay' | 'inputNeededDisplay' | 'turnFinishedDisplay'

const attentionPreferenceRows: readonly {
  key: AttentionDisplayPreferenceKey
  label: ThreadAttentionLabel
  colorKey: AttentionColorKey
}[] = [
  { key: 'approvalNeededDisplay', label: 'threadSidebarApprovalNeeded', colorKey: 'approvalNeeded' },
  { key: 'inputNeededDisplay', label: 'threadSidebarInputNeeded', colorKey: 'inputNeeded' },
  { key: 'turnFinishedDisplay', label: 'threadSidebarTurnFinished', colorKey: 'turnFinished' },
]

const attentionColorOptions: readonly AttentionColor[] = ['muted', 'primary', 'info', 'success', 'warning', 'danger']

const rebasedArchiveDelayLabelKeys = {
  disabled: 'threadSidebarRebasedArchiveDisabled',
  immediately: 'threadSidebarRebasedArchiveImmediate',
  'after-1-hour': 'threadSidebarRebasedArchiveHour',
  'after-1-day': 'threadSidebarRebasedArchiveDay',
  'after-1-week': 'threadSidebarRebasedArchiveWeek',
} satisfies Record<RebasedThreadArchiveDelay, Parameters<ThreadSidebarTranslate>[0]>

const rebasedArchiveDelayFromValue = (value: string): RebasedThreadArchiveDelay | undefined => REBASED_THREAD_ARCHIVE_DELAYS.find(option => option === value)

const attentionColorLabelKeys = {
  muted: 'threadSidebarColorMuted',
  primary: 'threadSidebarColorPrimary',
  info: 'threadSidebarColorInfo',
  success: 'threadSidebarColorSuccess',
  warning: 'threadSidebarColorWarning',
  danger: 'threadSidebarColorDanger',
} satisfies Record<AttentionColor, Parameters<ThreadSidebarTranslate>[0]>

const threadGroupLabelKeys = {
  status: 'threadSidebarGroupStatus',
  project: 'threadSidebarGroupProject',
  date: 'threadSidebarGroupDate',
  none: 'threadSidebarGroupNone',
} satisfies Record<ThreadGroupBy, Parameters<ThreadSidebarTranslate>[0]>

const threadStatusFilterLabelKeys = {
  all: 'threadSidebarAllThreads',
  working: 'threadSidebarWorking',
  'not-working': 'threadSidebarFilterNotWorking',
  attention: 'threadSidebarFilterAttention',
  muted: 'threadSidebarFilterMuted',
  archived: 'threadSidebarArchived',
} satisfies Record<(typeof THREAD_STATUS_FILTER_OPTIONS)[number], Parameters<ThreadSidebarTranslate>[0]>

const threadSourceFilterLabelKeys = {
  all: 'threadSidebarFilterAllSources',
  main: 'threadSidebarFilterMainThreads',
  subagents: 'threadSidebarFilterSubagents',
} satisfies Record<ThreadSourceFilter, Parameters<ThreadSidebarTranslate>[0]>

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

const THREAD_TAB_FOCUS_EVENT = 'dshfiles:main-tabs:focus-thread'
const threadTabFocusEventSchema = z.object({ sessionId: z.string().min(1) }).strict()

const noticeClass = 'dshx:w-auto dshx:px-3 dshx:py-2 dshx:text-xs'
const stickyHeaderClass = 'dshx:sticky dshx:top-0 dshx:z-10 dshx:bg-background'

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

const RELATIVE_TIME_SUFFIX = { now: '', minutes: 'm', hours: 'h', days: 'd', months: 'mo', years: 'y' } as const

const keepThreadTab = (sessionId: string): void => {
  window.dispatchEvent(new CustomEvent('dshfiles:main-tabs:keep-thread', { detail: { sessionId } }))
}

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
  readonly toggleChildren: (sessionId: SessionSummary['id'], currentlyOpen: boolean) => void
  readonly toggleAllChildren: (sessionId: SessionSummary['id']) => void
  readonly mute: (sessionId: SessionSummary['id'], option: ThreadMuteOption) => void
  readonly unmute: (sessionId: SessionSummary['id']) => void
  readonly markUnread: (sessionId: SessionSummary['id']) => void
  readonly setAutoArchiveOverride: (sessionId: SessionSummary['id'], override: AutoArchiveOverride) => void
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
  readonly attentionColors: AttentionColors
  readonly maxChildren: number
}

interface ThreadRowProps {
  readonly session: SessionSummary
  readonly unread: boolean
  readonly autoArchiveOverride: AutoArchiveOverride
  readonly unreadSessionIds: ReadonlySet<SessionSummary['id']>
  readonly archived: boolean
  readonly pinned: boolean
  readonly parked: boolean
  readonly selected: boolean
  readonly parentTitle: string | undefined
  readonly workspaceId: string | undefined
  readonly workspaceTitle: string | undefined
  readonly machine: string | undefined
  readonly age: string
  /** Set only while the thread is muted or snoozed. */
  readonly mute: ThreadMute | undefined
  readonly attentionLabel: ThreadAttentionLabel | undefined
  readonly rebasedAt: number | undefined
  readonly childAttentionLabels: ReadonlyMap<SessionSummary['id'], ThreadAttentionLabel>
  readonly rowStyle: RowStyle
  readonly childThreads: readonly SessionSummary[]
  /** Finished subagents folded behind the "N finished" line; empty unless the setting collapses them. */
  readonly finishedChildThreads: readonly SessionSummary[]
  readonly childrenOpen: boolean
  readonly allChildrenShown: boolean
  /** Set only when the open thread is one of this row's children, so other rows skip re-rendering. */
  readonly selectedChildId: SessionSummary['id'] | undefined
  readonly actions: RowActions
}

const NO_CHILDREN: readonly SessionSummary[] = []

const finishedSubagentsLabels = {
  show: 'threadSidebarFinishedSubagentsShow',
  collapse: 'threadSidebarFinishedSubagentsCollapse',
  hide: 'threadSidebarFinishedSubagentsHide',
} as const

const withTooltip = (label: string, anchor: ReactElement): JSX.Element => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="dshx:inline-flex">{anchor}</span>
    </TooltipTrigger>
    <TooltipContent side="top">{label}</TooltipContent>
  </Tooltip>
)

const muteStatusLabel = (t: ThreadSidebarTranslate, mute: ThreadMute): string => {
  const remaining = muteRemaining(mute, Date.now())
  if (remaining.kind === 'forever') return t('threadSidebarMutedForever')
  if (remaining.kind === 'minutes') return t('threadSidebarMutedMinutes', { minutes: remaining.minutes })
  if (remaining.kind === 'hours') return t('threadSidebarMutedHours', { hours: remaining.hours, minutes: remaining.minutes })
  return t('threadSidebarMutedDays', { days: remaining.days, hours: remaining.hours })
}

/** Read when the tooltip opens, so the remaining time is current without re-rendering the row every minute. */
const MutedMarker = (props: { readonly mute: ThreadMute; readonly t: ThreadSidebarTranslate }): JSX.Element => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className="dshx:inline-flex dshx:shrink-0" role="img" aria-label={props.t('threadSidebarMuted')} data-testid="thread-sidebar-muted-marker">
        <BellOffIcon className="dshx:size-3 dshx:text-muted-foreground" aria-hidden="true" />
      </span>
    </TooltipTrigger>
    <TooltipContent side="right">{muteStatusLabel(props.t, props.mute)}</TooltipContent>
  </Tooltip>
)

const StatusDot = (props: {
  readonly session: SessionSummary
  readonly unread: boolean
  readonly unreadLabel: string
  readonly attentionLabel: ThreadAttentionLabel | undefined
  readonly attentionColors: AttentionColors
}): JSX.Element => {
  const unread = props.unread
  const dotClass = attentionDotClass({
    attentionLabel: props.attentionLabel,
    attentionColors: props.attentionColors,
    unread,
    running: props.session.running,
  })
  return (
    <span
      className={cn('dshx:size-2 dshx:shrink-0 dshx:rounded-full', dotClass)}
      role={unread ? 'img' : undefined}
      aria-label={unread ? props.unreadLabel : undefined}
      aria-hidden={unread ? undefined : true}
    />
  )
}

const ChildThreadList = (props: {
  readonly parentId: SessionSummary['id']
  readonly childThreads: readonly SessionSummary[]
  readonly finishedChildThreads: readonly SessionSummary[]
  readonly unreadSessionIds: ReadonlySet<SessionSummary['id']>
  readonly allShown: boolean
  readonly selectedChildId: SessionSummary['id'] | undefined
  readonly attentionLabels: ReadonlyMap<SessionSummary['id'], ThreadAttentionLabel>
  readonly rowStyle: RowStyle
  readonly actions: RowActions
}): JSX.Element => {
  const t = props.actions.translate
  const [finishedShown, setFinishedShown] = useState(false)
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
  const renderChild = (child: SessionSummary): JSX.Element => {
    const attentionLabel = props.attentionLabels.get(child.id)
    return (
      <li key={child.id}>
        <button
          type="button"
          className={cn(lineClass, 'dshx:data-[selected=true]:bg-accent')}
          data-selected={child.id === props.selectedChildId}
          title={new Date(child.updatedAt).toLocaleString()}
          onClick={() => props.actions.open(child.id)}
          onDoubleClick={() => keepThreadTab(child.id)}
        >
          <StatusDot
            session={child}
            unread={props.unreadSessionIds.has(child.id)}
            unreadLabel={t('threadSidebarUnread')}
            attentionLabel={attentionLabel}
            attentionColors={props.rowStyle.attentionColors}
          />
          <span className={cn('dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-foreground', props.unreadSessionIds.has(child.id) && 'dshx:font-semibold')}>
            {child.displayTitle}
          </span>
          {attentionLabel === undefined ? null : (
            <span className={cn('dshx:shrink-0 dshx:text-[10px] dshx:font-medium', attentionLabelClass(attentionLabel, props.rowStyle.attentionColors))}>
              {t(attentionLabel)}
            </span>
          )}
          {props.rowStyle.time ? (
            <span className="dshx:shrink-0 dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground">{formatAge(child.updatedAt)}</span>
          ) : null}
        </button>
      </li>
    )
  }
  return (
    <ul className="dshx:mb-1 dshx:ml-3.5 dshx:flex dshx:flex-col dshx:border-l dshx:pl-1.5" aria-label={t('threadSidebarChildThreads')}>
      {shown.map(renderChild)}
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
      {props.finishedChildThreads.length > 0 ? (
        <li>
          <button
            type="button"
            className={cn(lineClass, 'dshx:text-muted-foreground dshx:hover:text-foreground')}
            aria-expanded={finishedShown}
            onClick={() => setFinishedShown(current => !current)}
          >
            {finishedShown ? t('threadSidebarHideFinishedChildren') : `${props.finishedChildThreads.length} ${t('threadSidebarFinishedChildren')}`}
          </button>
        </li>
      ) : null}
      {finishedShown ? props.finishedChildThreads.map(renderChild) : null}
    </ul>
  )
}

/** Memoized so a session update re-renders only its own row, not the whole list. */
const ThreadRow = memo((props: ThreadRowProps): JSX.Element => {
  const { session, archived, pinned, parked, rowStyle } = props
  const t = props.actions.translate
  const unread = props.unread
  const compact = rowStyle.density === 'compact'
  const childCount = props.childThreads.length + props.finishedChildThreads.length
  const showProject = rowStyle.project || props.parentTitle !== undefined
  const showMachine = rowStyle.machine && props.machine !== undefined
  const showPath = rowStyle.path && session.cwd !== undefined && session.cwd.length > 0
  const metaLine = showProject || showMachine || showPath || childCount > 0
  const headLine = rowStyle.title || rowStyle.time || rowStyle.statusDot || props.rebasedAt !== undefined
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <article
          className="dshx:group/row dshx:relative dshx:min-w-0"
          data-thread-id={session.id}
          data-selected={props.selected}
          onContextMenu={captureThreadMentionInsertion}
        >
          <div className="dshx:relative dshx:rounded-md dshx:hover:bg-accent/60 dshx:focus-within:bg-accent/60 dshx:group-data-[selected=true]/row:bg-accent">
            <button
              type="button"
              className={cn(
                'dshx:flex dshx:w-full dshx:min-w-0 dshx:flex-col dshx:rounded-md dshx:text-left dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:disabled:cursor-default',
                compact ? 'dshx:gap-0.5 dshx:px-2 dshx:py-1.5' : 'dshx:gap-1 dshx:px-2.5 dshx:py-2.5',
              )}
              title={new Date(session.updatedAt).toLocaleString()}
              onClick={() => props.actions.open(session.id)}
              onDoubleClick={() => keepThreadTab(session.id)}
            >
              {headLine ? (
                <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
                  {rowStyle.statusDot ? (
                    <StatusDot
                      session={session}
                      unread={unread}
                      unreadLabel={t('threadSidebarUnread')}
                      attentionLabel={props.attentionLabel}
                      attentionColors={rowStyle.attentionColors}
                    />
                  ) : null}
                  {props.mute === undefined ? null : <MutedMarker mute={props.mute} t={t} />}
                  <span
                    className={cn(
                      'dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-foreground',
                      compact ? 'dshx:text-sm' : 'dshx:text-base',
                      unread && 'dshx:font-semibold',
                    )}
                  >
                    {rowStyle.title ? session.displayTitle : null}
                  </span>
                  {props.attentionLabel === undefined ? null : (
                    <span className={cn('dshx:shrink-0 dshx:text-xs dshx:font-medium', attentionLabelClass(props.attentionLabel, rowStyle.attentionColors))}>
                      {t(props.attentionLabel)}
                    </span>
                  )}
                  {props.rebasedAt === undefined ? null : (
                    <Badge variant="success" title={new Date(props.rebasedAt).toLocaleString()} data-testid="thread-sidebar-rebased-tag">
                      {t('threadSidebarRebased')}
                    </Badge>
                  )}
                  {rowStyle.time ? (
                    <span
                      className={cn(
                        'dshx:shrink-0 dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground',
                        session.running && 'dshx:font-medium dshx:text-info',
                      )}
                    >
                      {`${session.running ? `${t('threadSidebarWorking')} · ` : ''}${props.age}`}
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
                onClick={() => props.actions.toggleChildren(session.id, props.childrenOpen)}
              >
                <span className="dshx:flex dshx:-space-x-0.5" aria-hidden="true">
                  {props.childThreads.slice(0, 3).map(child => {
                    const attentionLabel = props.childAttentionLabels.get(child.id)
                    return (
                      <span
                        key={child.id}
                        className={cn(
                          'dshx:size-2 dshx:rounded-full dshx:ring-1 dshx:ring-background',
                          attentionDotClass({
                            attentionLabel,
                            attentionColors: rowStyle.attentionColors,
                            unread: props.unreadSessionIds.has(child.id),
                            running: child.running,
                          }),
                        )}
                      />
                    )
                  })}
                </span>
                <span className="dshx:tabular-nums dshx:font-medium">{childCount}</span>
                {props.childrenOpen ? (
                  <ChevronUpIcon className="dshx:size-3" aria-hidden="true" />
                ) : (
                  <ChevronDownIcon className="dshx:size-3" aria-hidden="true" />
                )}
              </button>
            ) : null}
            <div
              data-testid="thread-row-actions"
              className="dshx:pointer-events-none dshx:absolute dshx:top-1 dshx:right-1.5 dshx:flex dshx:gap-0.5 dshx:rounded-md dshx:border dshx:bg-popover dshx:p-0.5 dshx:opacity-0 dshx:shadow-xs dshx:transition-opacity dshx:group-hover/row:pointer-events-auto dshx:group-hover/row:opacity-100 dshx:focus-within:pointer-events-auto dshx:focus-within:opacity-100"
            >
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
                    props.mute === undefined ? t('threadSidebarMute') : muteStatusLabel(t, props.mute),
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs" aria-label={t(props.mute === undefined ? 'threadSidebarMute' : 'threadSidebarMuted')}>
                          {props.mute === undefined ? <BellIcon className="dshx:size-3.5" /> : <BellOffIcon className="dshx:size-3.5" />}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="dshx-root dshx:min-w-44" aria-label={t('threadSidebarMute')}>
                        {THREAD_MUTE_OPTIONS.map(option => (
                          <DropdownMenuItem key={option} onSelect={() => props.actions.mute(session.id, option)}>
                            {t(muteOptionLabelKeys[option])}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={props.mute === undefined} onSelect={() => props.actions.unmute(session.id)}>
                          {t('threadSidebarUnmute')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>,
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
              finishedChildThreads={props.finishedChildThreads}
              unreadSessionIds={props.unreadSessionIds}
              allShown={props.allChildrenShown}
              selectedChildId={props.selectedChildId}
              attentionLabels={props.childAttentionLabels}
              rowStyle={rowStyle}
              actions={props.actions}
            />
          ) : null}
        </article>
      </ContextMenuTrigger>
      <ContextMenuContent className="dshx-root dshx:min-w-44" aria-label={t('threadSidebarContextMenu')}>
        <ContextMenuItem onSelect={() => requestThreadMentionInsertion(session.id)}>{t('threadSidebarInsertMention')}</ContextMenuItem>
        <ContextMenuItem onSelect={() => void props.actions.copy(session.id, t('threadSidebarIdCopied'))}>{t('threadSidebarCopyId')}</ContextMenuItem>
        <ContextMenuItem
          onSelect={() => void props.actions.copy(buildThreadUrl(window.location.href, session.id, props.workspaceId), t('threadSidebarLinkCopied'))}
        >
          {t('threadSidebarCopyLink')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={unread} onSelect={() => props.actions.markUnread(session.id)}>
          {t('threadSidebarMarkUnread')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>{t('threadSidebarAutoSettleBehavior')}</ContextMenuSubTrigger>
          <ContextMenuSubContent className="dshx-root dshx:min-w-44">
            <ContextMenuRadioGroup value={props.autoArchiveOverride}>
              <ContextMenuRadioItem
                value="inherit"
                onSelect={event => {
                  event.preventDefault()
                  props.actions.setAutoArchiveOverride(session.id, 'inherit')
                }}
              >
                {t('threadSidebarAutoSettleInherit')}
              </ContextMenuRadioItem>
              <ContextMenuRadioItem
                value="enabled"
                onSelect={event => {
                  event.preventDefault()
                  props.actions.setAutoArchiveOverride(session.id, 'enabled')
                }}
              >
                {t('threadSidebarAutoSettleEnabled')}
              </ContextMenuRadioItem>
              <ContextMenuRadioItem
                value="disabled"
                onSelect={event => {
                  event.preventDefault()
                  props.actions.setAutoArchiveOverride(session.id, 'disabled')
                }}
              >
                {t('threadSidebarAutoSettleDisabled')}
              </ContextMenuRadioItem>
            </ContextMenuRadioGroup>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>{t(props.mute === undefined ? 'threadSidebarMute' : 'threadSidebarMuted')}</ContextMenuSubTrigger>
          <ContextMenuSubContent className="dshx-root dshx:min-w-44">
            {THREAD_MUTE_OPTIONS.map(option => (
              <ContextMenuItem key={option} onSelect={() => props.actions.mute(session.id, option)}>
                {t(muteOptionLabelKeys[option])}
              </ContextMenuItem>
            ))}
            <ContextMenuSeparator />
            <ContextMenuItem disabled={props.mute === undefined} onSelect={() => props.actions.unmute(session.id)}>
              {t('threadSidebarUnmute')}
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
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

// The sidebar reads the pending-question projection through TanStack, and the kit's provider supplies the one client
// dshx inlines per bundle. Mounting it here keeps the slot entry resolvable from any registration site.
export const ThreadSidebar = (props: ThreadSidebarProps): JSX.Element => (
  <PluginQueryProvider>
    <ThreadSidebarContent {...props} />
  </PluginQueryProvider>
)

const ThreadSidebarContent = (props: ThreadSidebarProps): JSX.Element => {
  const sessionState = props.useSessions(state => state)
  const sessionStatus = props.useSessionStatus(state => state)
  const workspaceState = props.useWorkspaces(state => state)
  const { preferences, updatePreferences, storageWarning, setSelectedThreadId, threadTitle } = useSidebarState()
  const notificationPreferences = threadNotificationPreferences.useValue() ?? DEFAULT_THREAD_NOTIFICATION_PREFERENCES
  const pendingQuestionsApi = useApi(threadSidebarPendingQuestionsApi)
  const machine = useApiQuery(threadSidebarMachineApi, 'name', { enabled: preferences.threadRowMachine }).data?.name
  const jjRepositories = useApiQuery(jjIntegrationApi, 'repositories', { input: {} })
  const refetchJjRepositories = jjRepositories.refetch
  useEffect(() => {
    const timer = window.setInterval(refetchJjRepositories, 30_000)
    return () => window.clearInterval(timer)
  }, [refetchJjRepositories])
  const [childrenOpenOverrides, setChildrenOpenOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const [expandedParents, setExpandedParents] = useState<ReadonlySet<string>>(() => new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [viewsManagerOpen, setViewsManagerOpen] = useState(false)
  const [threadToScrollTo, setThreadToScrollTo] = useState<string | null>(null)
  const threadViewSettings = threadViewPreferences.useValue() ?? DEFAULT_THREAD_VIEW_SETTINGS
  const threadView = activeThreadView(threadViewSettings)
  const [threadViewStorageWarning, setThreadViewStorageWarning] = useState(false)
  const [now, setNow] = useState(() => Date.now())
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
  const previousStatus = useRef<Readonly<Record<string, ThreadAttentionStatus>> | null>(null)
  const openedRouteId = useRef<string | null>(null)
  const suppressUrlForSession = useRef<string | null>(null)
  const latestAutoArchive = useRef<{
    sessions: SessionSummary[]
    workspaceBySession: Map<string, string>
    preferences: SidebarPreferences
    dueRebasedSessionIds: readonly string[]
    archived: ReadonlySet<string>
    pinned: ReadonlySet<string>
    archive: ThreadSidebarProps['archiveSession']
    announce: (notice: SidebarNotice) => void
    archiveFailureMessage: string
  } | null>(null)

  const workspaceBySession = useMemo(() => workspaceForSessions(workspaceState.items), [workspaceState.items])
  const archivedSessionIds = useMemo(() => setIncludes(workspaceState.archivedSessionIds), [workspaceState.archivedSessionIds])
  const pinnedSessionIds = useMemo(() => setIncludes(workspaceState.pinnedSessionIds), [workspaceState.pinnedSessionIds])
  const displayWorkspaces = useMemo(
    () =>
      projectWorkspaces(workspaceState.items).map(workspace => ({
        id: workspace.workspaceId,
        title: workspace.title.length > 0 ? workspace.title : props.tSidebar('threadSidebarDefaultProject'),
      })),
    [props.tSidebar, workspaceState.items],
  )
  const sessions = useMemo(() => sessionsForAutoArchive(sessionState.ids, sessionState.byId), [sessionState.byId, sessionState.ids])
  const rebasedIndex = useMemo(
    () =>
      indexRebasedThreadSessions({
        threads: (jjRepositories.data?.repositories ?? []).flatMap(repository => repository.threads),
        sessions: new Map(
          sessions.map(session => [
            session.id,
            {
              id: session.id,
              running: session.running,
              pendingInteraction: sessionStatus.get(session.id) === undefined ? undefined : sessionStatus.get(session.id)?.pendingInteraction !== undefined,
              updatedAt: session.updatedAt,
            },
          ]),
        ),
        archivedSessionIds,
        pinnedSessionIds,
        now,
        delayMs: rebasedThreadArchiveDelayMs(preferences.rebasedThreadArchiveDelay),
      }),
    [archivedSessionIds, jjRepositories.data, now, pinnedSessionIds, preferences.rebasedThreadArchiveDelay, sessionStatus, sessions],
  )
  const questionCandidates = useMemo(
    () =>
      sessions
        .filter(session => {
          const status = sessionStatus.get(session.id)
          return !session.blank && !session.running && status?.completionUnread === true && status.pendingInteraction?.kind !== 'question'
        })
        .map(session => session.id)
        .sort(),
    [sessionStatus, sessions],
  )
  const activeQuestionsQuery = useQuery({
    queryKey: ['thread-sidebar', 'pending-questions', questionCandidates],
    queryFn: async ({ signal }) => {
      const activeSessionIds: string[] = []
      for (let offset = 0; offset < questionCandidates.length; offset += 500) {
        const result = await pendingQuestionsApi.active({ sessionIds: questionCandidates.slice(offset, offset + 500) }, { signal })
        activeSessionIds.push(...result.sessionIds)
      }
      return { sessionIds: activeSessionIds }
    },
    enabled: questionCandidates.length > 0,
    refetchInterval: questionCandidates.length > 0 ? 5_000 : false,
    retry: false,
  })
  const continuedQuestionSessionIds = useMemo(() => new Set(activeQuestionsQuery.data?.sessionIds ?? []), [activeQuestionsQuery.data])
  const parkedSessionIds = useMemo(() => setIncludes(preferences.parkedSessionIds), [preferences.parkedSessionIds])
  const mutedThreads = preferences.mutedThreads
  const mutedSessionIds = useMemo(
    () => new Set(Object.entries(mutedThreads).flatMap(([sessionId, mute]) => (isMuteActive(mute, now) ? [sessionId] : []))),
    [mutedThreads, now],
  )
  const selectedSession = useMemo(() => sessions.find(session => (session.retainedBy.mainView ?? 0) > 0), [sessions])
  const selectedSessionId = selectedSession?.id
  const selectedSessionCompletionUnread = selectedSessionId === undefined ? false : sessionStatus.get(selectedSessionId)?.completionUnread === true
  const attentionSessions = useMemo(
    () => sessions.filter(session => isAttentionSessionIncluded(session, preferences.includeSubagentAttention)),
    [preferences.includeSubagentAttention, sessions],
  )
  const unreadSessionIds = useMemo(
    () =>
      new Set(sessions.filter(session => !mutedSessionIds.has(session.id) && isThreadUnread(notificationPreferences, session.id)).map(session => session.id)),
    [mutedSessionIds, notificationPreferences, sessions],
  )

  useEffect(() => setSelectedThreadId(selectedSession?.id ?? null), [selectedSession?.id, setSelectedThreadId])
  useEffect(() => {
    const onFocusThread = (event: Event): void => {
      const request = event instanceof CustomEvent ? threadTabFocusEventSchema.safeParse(event.detail) : undefined
      if (request?.success === true) setThreadToScrollTo(request.data.sessionId)
    }
    window.addEventListener(THREAD_TAB_FOCUS_EVENT, onFocusThread)
    return () => window.removeEventListener(THREAD_TAB_FOCUS_EVENT, onFocusThread)
  }, [])
  useEffect(() => {
    if (selectedSessionId === undefined) return
    const current = threadNotificationPreferences.get() ?? DEFAULT_THREAD_NOTIFICATION_PREFERENCES
    threadNotificationPreferences.set(markThreadSeen(current, selectedSessionId, selectedSessionCompletionUnread))
  }, [selectedSessionId, selectedSessionCompletionUnread])
  threadTitle.current = sessionId => sessionState.byId[sessionId]?.displayTitle

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
    if (selectedSession === undefined || routeRequest !== null) return
    if (suppressUrlForSession.current === selectedSession.id) return
    suppressUrlForSession.current = null
    const workspaceId = workspaceForLineage(selectedSession, sessionState.byId, workspaceBySession)
    const next = buildThreadUrl(window.location.href, selectedSession.id, workspaceId)
    if (next !== window.location.href) window.history.replaceState(window.history.state, '', next)
  }, [routeRequest, selectedSession, sessionState.byId, workspaceBySession])

  const changePreferences = (patch: Partial<SidebarPreferences>): void => {
    updatePreferences(patch)
  }

  const attentionDisplayRow = (key: AttentionDisplayPreferenceKey, label: ThreadAttentionLabel, colorKey: AttentionColorKey): JSX.Element => {
    const mode = preferences[key]
    const modeLabel = mode === 'group' ? 'threadSidebarAttentionGroup' : 'threadSidebarAttentionLabel'
    const color = preferences.attentionColors[colorKey]
    const colorLabel = props.tSidebar(attentionColorLabelKeys[color])
    return (
      <div key={key} className="dshx:grid dshx:min-w-0 dshx:gap-1">
        <span className="dshx:min-w-0 dshx:truncate dshx:text-xs">{props.tSidebar(label)}</span>
        <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1.5">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="dshx:min-w-0 dshx:flex-1" aria-label={`${props.tSidebar(label)}: ${props.tSidebar(modeLabel)}`}>
                {props.tSidebar(modeLabel)}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuRadioGroup
                value={mode}
                onValueChange={value => {
                  if (value === 'group' || value === 'label') changePreferences({ [key]: value })
                }}
              >
                <DropdownMenuRadioItem value="group">{props.tSidebar('threadSidebarAttentionGroup')}</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="label">{props.tSidebar('threadSidebarAttentionLabel')}</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="dshx:min-w-0 dshx:flex-1 dshx:justify-start dshx:gap-1.5"
                aria-label={`${props.tSidebar(label)}: ${props.tSidebar('threadSidebarAttentionColor')} ${colorLabel}`}
              >
                <span className={cn('dshx:size-2 dshx:shrink-0 dshx:rounded-full', attentionColorDotClass(color))} aria-hidden="true" />
                <span className="dshx:truncate">{colorLabel}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={color}
                onValueChange={value => {
                  const checked = attentionColorSchema.safeParse(value)
                  if (!checked.success) return
                  changePreferences({ attentionColors: { ...preferences.attentionColors, [colorKey]: checked.data } })
                }}
              >
                {attentionColorOptions.map(option => (
                  <DropdownMenuRadioItem key={option} value={option}>
                    <span className={cn('dshx:size-2 dshx:shrink-0 dshx:rounded-full', attentionColorDotClass(option))} aria-hidden="true" />
                    {props.tSidebar(attentionColorLabelKeys[option])}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    )
  }

  const mutateSession = async (sessionId: SessionSummary['id'], operation: RowOperation): Promise<void> => {
    const actionThreads = Object.values(sessionState.byId).filter(session => !session.blank)
    const targetIds = threadActionTargetIds({
      threadId: sessionId,
      threads: actionThreads,
      cascadeToChildren: preferences.applyActionsToChildThreads,
    })
    const targetIdsToChange = targetIds.filter(targetId => {
      if (operation === 'pin') return !pinnedSessionIds.has(targetId)
      if (operation === 'unpin') return pinnedSessionIds.has(targetId)
      if (operation === 'archive') return !archivedSessionIds.has(targetId)
      return archivedSessionIds.has(targetId)
    })
    if (operation === 'archive' && targetIdsToChange.some(targetId => sessionState.byId[targetId]?.running)) {
      setNotice({ tone: 'warning', message: props.tSidebar('threadSidebarRunningNotice') })
      return
    }
    const actions = {
      pin: props.pinSession,
      unpin: props.unpinSession,
      archive: props.archiveSession,
      unarchive: props.unarchiveSession,
    } satisfies Record<RowOperation, (sessionId: SessionSummary['id']) => Promise<void>>
    let failed = false
    const archivedIds: SessionSummary['id'][] = []
    for (const targetId of targetIdsToChange) {
      try {
        await actions[operation](targetId)
        if (operation === 'archive') archivedIds.push(targetId)
      } catch {
        failed = true
      }
    }
    if (operation === 'archive' && archivedIds.length > 0) {
      if (!preferences.archiveUndoEnabled) {
        setNotice(failed ? { tone: 'danger', message: props.tSidebar('threadSidebarActionFailure') } : null)
        return
      }
      setNotice({
        tone: failed ? 'danger' : 'success',
        message: props.tSidebar(failed ? 'threadSidebarActionFailure' : 'threadSidebarArchivedNotice'),
        actionLabel: props.tSidebar('threadSidebarUndo'),
        durationMs: preferences.archiveUndoDurationSeconds * 1_000,
        onAction: (() => {
          let undoInFlight = false
          return () => {
            if (undoInFlight) return
            undoInFlight = true
            void (async () => {
              let undoFailed = false
              for (const archivedId of archivedIds) {
                try {
                  await props.unarchiveSession(archivedId)
                } catch {
                  undoFailed = true
                }
              }
              setNotice({
                tone: undoFailed ? 'danger' : 'success',
                message: props.tSidebar(undoFailed ? 'threadSidebarActionFailure' : 'threadSidebarRestoredNotice'),
              })
            })()
          }
        })(),
      })
      return
    }
    setNotice(failed ? { tone: 'danger', message: props.tSidebar('threadSidebarActionFailure') } : null)
  }

  const archivedView = props.archivedView
  const unarchiveSession = props.unarchiveSession
  const reopenThread = props.open
  const tSidebar = props.tSidebar
  useEffect(() => {
    if (archivedView === undefined) return
    const subscription = archivedView.on('failed', event => {
      const sessionId = event.sessionId
      if (sessionId === null) return
      setNotice(
        archivedOpenFailureNotice({
          message: tSidebar(event.failure === 'keeps-closing' ? 'threadSidebarArchivedKeepsClosing' : 'threadSidebarArchivedLoadFailed'),
          actionLabel: tSidebar('threadSidebarRestoreAndOpen'),
          onAction: () => {
            setNotice(null)
            void unarchiveSession(sessionId).then(
              () => reopenThread(sessionId),
              () => setNotice({ tone: 'danger', message: tSidebar('threadSidebarActionFailure') }),
            )
          },
        }),
      )
    })
    return () => subscription.unsubscribe()
  }, [archivedView, reopenThread, tSidebar, unarchiveSession])

  const openThread = (sessionId: SessionSummary['id']): void => {
    const current = threadNotificationPreferences.get() ?? DEFAULT_THREAD_NOTIFICATION_PREFERENCES
    threadNotificationPreferences.set(markThreadSeen(current, sessionId, sessionStatus.get(sessionId)?.completionUnread === true))
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
    const shouldPark = !parkedSessionIds.has(sessionId)
    const next = new Set(preferences.parkedSessionIds)
    for (const targetId of threadActionTargetIds({
      threadId: sessionId,
      threads: Object.values(sessionState.byId).filter(session => !session.blank),
      cascadeToChildren: preferences.applyActionsToChildThreads,
    })) {
      if (shouldPark) next.add(targetId)
      else next.delete(targetId)
    }
    changePreferences({ parkedSessionIds: [...next] })
    setNotice(null)
  }

  const changeDesktopNotifications = async (enabled: boolean): Promise<void> => {
    if (!enabled) {
      const current = threadNotificationPreferences.get() ?? DEFAULT_THREAD_NOTIFICATION_PREFERENCES
      threadNotificationPreferences.set({ ...current, enabled: false })
      return
    }
    if (!('Notification' in window)) {
      setNotice({ tone: 'warning', message: props.tSidebar('threadSidebarNotificationsUnavailable') })
      return
    }
    try {
      const permission = window.Notification.permission === 'granted' ? 'granted' : await window.Notification.requestPermission()
      if (permission !== 'granted') {
        setNotice({ tone: 'warning', message: props.tSidebar('threadSidebarNotificationsPermission') })
        return
      }
      const current = threadNotificationPreferences.get() ?? DEFAULT_THREAD_NOTIFICATION_PREFERENCES
      threadNotificationPreferences.set({ ...current, enabled: true })
      setNotice(null)
    } catch {
      setNotice({ tone: 'warning', message: props.tSidebar('threadSidebarNotificationsPermission') })
    }
  }

  const toggleSection = (section: SidebarSection): void => {
    changePreferences({
      collapsedSections: toggleCollapsedSection(preferences.collapsedSections, section),
    })
  }

  const runAutoArchive = async (): Promise<void> => {
    const latest = latestAutoArchive.current
    if (archiveInFlight.current || latest === null || !shouldScanForAutoArchive(latest.preferences)) return
    archiveInFlight.current = true
    let failed = false
    try {
      const now = Date.now()
      for (const session of latest.sessions) {
        if (
          !isAutoArchiveCandidate({
            session,
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

  const runRebasedAutoArchive = useCallback(async (): Promise<void> => {
    const latest = latestAutoArchive.current
    if (archiveInFlight.current || latest === null || latest.dueRebasedSessionIds.length === 0) return
    archiveInFlight.current = true
    let failed = false
    try {
      for (const sessionId of latest.dueRebasedSessionIds) {
        if (latest.archived.has(sessionId) || latest.pinned.has(sessionId)) continue
        try {
          await latest.archive(SessionId(sessionId))
        } catch {
          failed = true
        }
      }
    } finally {
      archiveInFlight.current = false
    }
    if (failed) latest.announce({ tone: 'danger', message: latest.archiveFailureMessage })
  }, [])

  latestAutoArchive.current = {
    sessions,
    workspaceBySession,
    preferences,
    dueRebasedSessionIds: rebasedIndex.dueSessionIds,
    archived: archivedSessionIds,
    pinned: pinnedSessionIds,
    archive: props.archiveSession,
    announce: setNotice,
    archiveFailureMessage: props.tSidebar('threadSidebarArchiveFailure'),
  }

  useEffect(() => {
    if (!shouldScanForAutoArchive(preferences)) return
    if (sessionState.phase !== 'ready' || workspaceState.phase !== 'ready') return
    void runAutoArchive()
    const timer = window.setInterval(() => void runAutoArchive(), preferences.scanIntervalMinutes * 60_000)
    return () => window.clearInterval(timer)
  }, [
    preferences.autoArchiveEnabled,
    preferences.autoArchiveDisabledSessionIds,
    preferences.autoArchiveSessionIds,
    preferences.scanIntervalMinutes,
    sessionState.phase,
    workspaceState.phase,
  ])

  useEffect(() => {
    if (preferences.rebasedThreadArchiveDelay === 'disabled' || jjRepositories.data === undefined) return
    if (sessionState.phase !== 'ready' || workspaceState.phase !== 'ready') return
    void runRebasedAutoArchive()
    const timer = window.setInterval(() => void runRebasedAutoArchive(), preferences.scanIntervalMinutes * 60_000)
    return () => window.clearInterval(timer)
  }, [
    jjRepositories.data,
    preferences.rebasedThreadArchiveDelay,
    preferences.scanIntervalMinutes,
    runRebasedAutoArchive,
    sessionState.phase,
    workspaceState.phase,
  ])

  const threadTree = useMemo(() => {
    const listed: SessionSummary[] = []
    for (const sessionId of sessionState.ids) {
      const session = sessionState.byId[sessionId]
      if (session === undefined || session.blank || isSideChat(session)) continue
      const workspaceId = workspaceForLineage(session, sessionState.byId, workspaceBySession)
      if (preferences.workspaceFilter !== null && (workspaceId ?? '') !== preferences.workspaceFilter) continue
      listed.push(session)
    }
    return groupThreadChildren({ threads: listed })
  }, [preferences.workspaceFilter, sessionState.byId, sessionState.ids, workspaceBySession])

  useEffect(() => {
    if (threadToScrollTo === null) return
    const scrollArea = document.querySelector<HTMLElement>('[data-testid="thread-sidebar-scroll"]')
    const row = Array.from(scrollArea?.querySelectorAll<HTMLElement>('[data-thread-id]') ?? []).find(element => element.dataset.threadId === threadToScrollTo)
    if (row !== undefined) {
      row.scrollIntoView({ block: 'nearest' })
      setThreadToScrollTo(null)
      return
    }
    const parent = Array.from(threadTree.childrenByRoot).find(([, children]) => children.some(child => child.id === threadToScrollTo))?.[0]
    if (parent !== undefined && childrenOpenOverrides.get(parent) !== true) {
      setChildrenOpenOverrides(current => new Map(current).set(parent, true))
      return
    }
    setThreadToScrollTo(null)
  }, [childrenOpenOverrides, threadToScrollTo, threadTree])

  const sectionEntries = useMemo(
    () =>
      threadTree.roots.map(session => ({
        session,
        workspaceId: workspaceForLineage(session, sessionState.byId, workspaceBySession),
        activity: {
          id: session.id,
          updatedAt: effectiveActivityAt(mutedThreads, session, now),
          // A parent waiting on a running subagent is still active work.
          running: session.running || (threadTree.childrenByRoot.get(session.id) ?? NO_CHILDREN).some(child => child.running),
        },
      })),
    [mutedThreads, now, sessionState.byId, threadTree, workspaceBySession],
  )
  const childThreadEntries = useMemo(
    () =>
      Array.from(threadTree.childrenByRoot.values()).flatMap(children =>
        children.map(session => ({
          session,
          workspaceId: workspaceForLineage(session, sessionState.byId, workspaceBySession),
          activity: { id: session.id, updatedAt: effectiveActivityAt(mutedThreads, session, now), running: session.running },
        })),
      ),
    [mutedThreads, now, sessionState.byId, threadTree, workspaceBySession],
  )
  const sourceFilteredThreadEntries = useMemo(() => {
    if (threadView.sourceFilter === 'subagents') {
      return [...childThreadEntries, ...sectionEntries.filter(entry => matchesThreadSourceFilter(entry.session, 'subagents'))]
    }
    if (threadView.sourceFilter === 'main') return sectionEntries.filter(entry => matchesThreadSourceFilter(entry.session, 'main'))
    return sectionEntries
  }, [childThreadEntries, sectionEntries, threadView.sourceFilter])
  const sourceFilteredThreadIds = useMemo(() => new Set(sourceFilteredThreadEntries.map(entry => entry.session.id)), [sourceFilteredThreadEntries])
  const currentWorkingThreadIds = useMemo(() => workingThreadIds(sectionEntries.map(entry => entry.activity)), [sectionEntries])
  const workingThreadCountsBySource = useMemo(
    () => ({
      all: sectionEntries.filter(entry => entry.activity.running).length,
      main: sectionEntries.filter(entry => entry.activity.running && matchesThreadSourceFilter(entry.session, 'main')).length,
      subagents: [...childThreadEntries, ...sectionEntries.filter(entry => matchesThreadSourceFilter(entry.session, 'subagents'))].filter(
        entry => entry.activity.running,
      ).length,
    }),
    [childThreadEntries, sectionEntries],
  )
  const nextMuteWake = useMemo(() => nextMuteExpiry(mutedThreads, now), [mutedThreads, now])
  const nextIdleAt = useMemo(
    () =>
      nextIdleTransitionAt(
        sectionEntries.map(entry => entry.activity),
        now,
        preferences.idleMinutes,
      ),
    [now, preferences.idleMinutes, sectionEntries],
  )

  useEffect(() => {
    const nextBoundary = [nextIdleAt, nextMuteWake].filter((value): value is number => value !== null).sort((left, right) => left - right)[0]
    if (nextBoundary === undefined) return
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, nextBoundary - Date.now() + 1))
    return () => window.clearTimeout(timer)
  }, [nextIdleAt, nextMuteWake])

  // A snooze that ran out wakes the thread at once (through `now`); dropping its entry keeps the settings small.
  const mutesAwake = useMemo(() => withoutExpiredMutes(mutedThreads, now), [mutedThreads, now])
  useEffect(() => {
    if (Object.keys(mutesAwake).length !== Object.keys(mutedThreads).length) updatePreferences({ mutedThreads: mutesAwake })
  }, [mutedThreads, mutesAwake, updatePreferences])

  useEffect(() => {
    const legacy = notificationPreferences.mutedUntil
    if (Object.keys(legacy).length === 0 || sessionState.phase !== 'ready') return
    const migrated = legacyMutesToMigrate({
      legacy,
      hostMutes: mutedThreads,
      updatedAt: sessionId => sessions.find(session => session.id === sessionId)?.updatedAt,
      now: Date.now(),
    })
    if (Object.keys(migrated).length > 0) updatePreferences({ mutedThreads: { ...mutedThreads, ...migrated } })
    threadNotificationPreferences.set({ ...notificationPreferences, mutedUntil: {} })
  }, [mutedThreads, notificationPreferences, sessionState.phase, sessions, updatePreferences])

  const needsInputRows = useMemo(
    () =>
      selectInputNeededRows({
        sessions: attentionSessions,
        pendingInteractionKindFor: sessionId =>
          sessionStatus.get(sessionId)?.pendingInteraction?.kind ?? (continuedQuestionSessionIds.has(sessionId) ? 'question' : undefined),
        mutedSessionIds,
        archivedSessionIds,
        matchesWorkspace: session =>
          preferences.workspaceFilter === null || (workspaceForLineage(session, sessionState.byId, workspaceBySession) ?? '') === preferences.workspaceFilter,
      }),
    [
      archivedSessionIds,
      attentionSessions,
      continuedQuestionSessionIds,
      mutedSessionIds,
      preferences.workspaceFilter,
      sessionState.byId,
      sessionStatus,
      workspaceBySession,
    ],
  )
  const needsInputIds = useMemo(() => new Set(needsInputRows.map(session => session.id)), [needsInputRows])
  const approvalNeededRows = useMemo(
    () =>
      attentionSessions
        .filter(session => {
          const kind = sessionStatus.get(session.id)?.pendingInteraction?.kind
          return (
            !session.blank &&
            session.id !== selectedSession?.id &&
            (kind === 'approval' || kind === 'plan-review') &&
            !mutedSessionIds.has(session.id) &&
            !archivedSessionIds.has(session.id) &&
            (preferences.workspaceFilter === null ||
              (workspaceForLineage(session, sessionState.byId, workspaceBySession) ?? '') === preferences.workspaceFilter)
          )
        })
        .sort((left, right) => right.updatedAt - left.updatedAt),
    [
      archivedSessionIds,
      attentionSessions,
      mutedSessionIds,
      preferences.workspaceFilter,
      selectedSession?.id,
      sessionState.byId,
      sessionStatus,
      workspaceBySession,
    ],
  )
  const approvalNeededIds = useMemo(() => new Set(approvalNeededRows.map(session => session.id)), [approvalNeededRows])
  const turnFinishedRows = useMemo(
    () =>
      selectTurnFinishedRows({
        sessions: attentionSessions,
        selectedSessionId: selectedSession?.id,
        inputNeededSessionIds: needsInputIds,
        approvalNeededSessionIds: approvalNeededIds,
        completionAt: notificationPreferences.needsYouAt,
        mutedSessionIds,
        archivedSessionIds,
        matchesWorkspace: session =>
          preferences.workspaceFilter === null || (workspaceForLineage(session, sessionState.byId, workspaceBySession) ?? '') === preferences.workspaceFilter,
      }),
    [
      approvalNeededIds,
      archivedSessionIds,
      attentionSessions,
      mutedSessionIds,
      needsInputIds,
      notificationPreferences.needsYouAt,
      preferences.workspaceFilter,
      selectedSession?.id,
      sessionState.byId,
      workspaceBySession,
    ],
  )
  const waitingSessionIds = useMemo(() => new Set([...approvalNeededRows, ...needsInputRows].map(session => session.id)), [approvalNeededRows, needsInputRows])
  const attentionSessionIds = useMemo(
    () => new Set([...approvalNeededRows, ...needsInputRows, ...turnFinishedRows].map(session => session.id)),
    [approvalNeededRows, needsInputRows, turnFinishedRows],
  )
  const attentionRootIds = useMemo(() => {
    const ids = new Set(attentionSessionIds)
    for (const { session } of sectionEntries) {
      if ((threadTree.childrenByRoot.get(session.id) ?? NO_CHILDREN).some(child => attentionSessionIds.has(child.id))) ids.add(session.id)
    }
    return ids
  }, [attentionSessionIds, sectionEntries, threadTree])
  const visibleThreadEntries = useMemo(
    () =>
      sourceFilteredThreadEntries.filter(entry =>
        matchesThreadStatusFilter({
          filters: threadView.statusFilters,
          running: threadView.sourceFilter === 'subagents' ? entry.activity.running : currentWorkingThreadIds.has(entry.session.id),
          needsAttention: threadView.sourceFilter === 'subagents' ? attentionSessionIds.has(entry.session.id) : attentionRootIds.has(entry.session.id),
          archived: archivedSessionIds.has(entry.session.id),
          muted: mutedSessionIds.has(entry.session.id),
        }),
      ),
    [
      archivedSessionIds,
      attentionRootIds,
      attentionSessionIds,
      currentWorkingThreadIds,
      mutedSessionIds,
      sourceFilteredThreadEntries,
      threadView.sourceFilter,
      threadView.statusFilters,
    ],
  )
  const groupedAttentionRows = useMemo(() => {
    const filterRows = (rows: readonly SessionSummary[]): SessionSummary[] => {
      if (threadView.groupBy !== 'status') return []
      return rows.filter(
        session =>
          sourceFilteredThreadIds.has(session.id) &&
          matchesThreadStatusFilter({
            filters: threadView.statusFilters,
            running: threadView.sourceFilter === 'subagents' ? session.running : currentWorkingThreadIds.has(session.id),
            needsAttention: true,
            archived: archivedSessionIds.has(session.id),
            // Attention rows already leave muted threads out.
            muted: false,
          }),
      )
    }
    return {
      approvalNeeded: preferences.approvalNeededDisplay === 'group' ? filterRows(approvalNeededRows) : [],
      inputNeeded: preferences.inputNeededDisplay === 'group' ? filterRows(needsInputRows) : [],
      turnFinished: preferences.turnFinishedDisplay === 'group' ? filterRows(turnFinishedRows) : [],
    }
  }, [
    archivedSessionIds,
    approvalNeededRows,
    currentWorkingThreadIds,
    needsInputRows,
    preferences.approvalNeededDisplay,
    preferences.inputNeededDisplay,
    preferences.turnFinishedDisplay,
    sourceFilteredThreadIds,
    threadView.groupBy,
    threadView.sourceFilter,
    threadView.statusFilters,
    turnFinishedRows,
  ])
  const attentionIds = useMemo(
    () =>
      new Set([...groupedAttentionRows.approvalNeeded, ...groupedAttentionRows.inputNeeded, ...groupedAttentionRows.turnFinished].map(session => session.id)),
    [groupedAttentionRows],
  )
  const inlineAttentionLabels = useMemo(() => {
    const labels = new Map<SessionSummary['id'], ThreadAttentionLabel>()
    if (threadView.groupBy !== 'status' || preferences.approvalNeededDisplay === 'label') {
      for (const session of approvalNeededRows) labels.set(session.id, 'threadSidebarApprovalNeeded')
    }
    if (threadView.groupBy !== 'status' || preferences.inputNeededDisplay === 'label') {
      for (const session of needsInputRows) labels.set(session.id, 'threadSidebarInputNeeded')
    }
    if (threadView.groupBy !== 'status' || preferences.turnFinishedDisplay === 'label') {
      for (const session of turnFinishedRows) labels.set(session.id, 'threadSidebarTurnFinished')
    }
    return labels
  }, [
    approvalNeededRows,
    needsInputRows,
    preferences.approvalNeededDisplay,
    preferences.inputNeededDisplay,
    preferences.turnFinishedDisplay,
    threadView.groupBy,
    turnFinishedRows,
  ])

  const rowsBySection = useMemo(() => {
    const rows = new Map<SidebarSection, SessionSummary[]>(sections.map(section => [section, []]))
    const activityAt = new Map(visibleThreadEntries.map(entry => [entry.session.id, entry.activity.updatedAt]))
    for (const { session, activity } of visibleThreadEntries) {
      if (threadView.groupBy === 'status' && attentionIds.has(session.id)) continue
      const section = sectionForSession({
        session: activity,
        archivedSessionIds,
        pinnedSessionIds,
        parkedSessionIds,
        now,
        idleMinutes: preferences.idleMinutes,
      })
      rows.get(section)?.push(session)
    }
    for (const entries of rows.values())
      entries.sort((left, right) => (activityAt.get(right.id) ?? right.updatedAt) - (activityAt.get(left.id) ?? left.updatedAt))
    rows.set(
      'pinned',
      rows.get('pinned')?.sort((left, right) => workspaceState.pinnedSessionIds.indexOf(left.id) - workspaceState.pinnedSessionIds.indexOf(right.id)) ?? [],
    )
    return rows
  }, [
    archivedSessionIds,
    attentionIds,
    now,
    parkedSessionIds,
    pinnedSessionIds,
    preferences.idleMinutes,
    threadView.groupBy,
    visibleThreadEntries,
    workspaceState.pinnedSessionIds,
  ])
  const groupedThreadEntries = useMemo(() => {
    if (threadView.groupBy === 'status') return []
    return groupThreadEntries({
      groupBy: threadView.groupBy,
      entries: visibleThreadEntries.map(entry => ({ thread: entry.session, workspaceId: entry.workspaceId, activityAt: entry.activity.updatedAt })),
      workspaceTitles: new Map(displayWorkspaces.map(workspace => [workspace.id, workspace.title])),
      unassignedTitle: props.tSidebar('threadSidebarUnassigned'),
      dateTitles: {
        today: props.tSidebar('threadSidebarToday'),
        yesterday: props.tSidebar('threadSidebarYesterday'),
        lastSevenDays: props.tSidebar('threadSidebarLast7Days'),
        older: props.tSidebar('threadSidebarOlder'),
      },
      now,
    })
  }, [displayWorkspaces, now, props.tSidebar, threadView.groupBy, visibleThreadEntries])

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
      attentionColors: preferences.attentionColors,
      maxChildren: preferences.maxChildren,
    }),
    [
      preferences.attentionColors,
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

  const updateThreadView = (patch: Partial<ThreadViewPreferences>): void => {
    setThreadViewStorageWarning(!updateThreadViewPreferences(patch))
  }
  const saveThreadViewSettings = (settings: ThreadViewSettings): boolean => {
    const saved = updateThreadViewSettings(settings)
    setThreadViewStorageWarning(!saved)
    return saved
  }
  const updateThreadViewControls = (patch: Partial<Pick<ThreadViewSettings, 'showGroupControl' | 'showFilterControl'>>): void => {
    saveThreadViewSettings({ ...threadViewSettings, ...patch })
  }
  const selectThreadViewPreset = (viewId: string): void => {
    if (viewId === threadViewSettings.activeViewId) return
    saveThreadViewSettings(selectThreadView(threadViewSettings, viewId))
  }
  const selectThreadGroupBy = (value: string): void => {
    const decoded = decodeThreadViewPreferences({
      groupBy: value,
      statusFilters: threadView.statusFilters,
      sourceFilter: threadView.sourceFilter,
    })
    if (decoded === null) return
    updateThreadView({ groupBy: decoded.groupBy })
  }
  const selectThreadStatusFilter = (value: string, checked: boolean): void => {
    if (value === 'all') {
      if (checked) updateThreadView({ statusFilters: [] })
      return
    }
    const filter = THREAD_STATUS_FILTER_OPTIONS.find(candidate => candidate === value)
    if (filter === undefined || filter === 'all') return
    const selectedFilters = checked ? [...new Set([...threadView.statusFilters, filter])] : threadView.statusFilters.filter(selected => selected !== filter)
    const statusFilters = selectedFilters.sort((left, right) => THREAD_STATUS_FILTER_OPTIONS.indexOf(left) - THREAD_STATUS_FILTER_OPTIONS.indexOf(right))
    updateThreadView({ statusFilters })
  }
  const selectThreadSourceFilter = (value: string): void => {
    const decoded = decodeThreadViewPreferences({
      groupBy: threadView.groupBy,
      statusFilters: threadView.statusFilters,
      sourceFilter: value,
    })
    if (decoded === null) return
    updateThreadView({ sourceFilter: decoded.sourceFilter })
  }
  const activeFilterLabels = [
    ...threadView.statusFilters.map(filter => props.tSidebar(threadStatusFilterLabelKeys[filter])),
    ...(threadView.sourceFilter === 'all' ? [] : [props.tSidebar(threadSourceFilterLabelKeys[threadView.sourceFilter])]),
  ]
  const activeFilterSummary = activeFilterLabels.length === 0 ? props.tSidebar('threadSidebarFilterNone') : activeFilterLabels.join(' · ')

  const latestRowActions = useRef({
    openThread,
    mutateSession,
    toggleParked,
    copyContextValue,
    props,
    sessionsById: sessionState.byId,
    preferences,
    changePreferences,
  })
  latestRowActions.current = {
    openThread,
    mutateSession,
    toggleParked,
    copyContextValue,
    props,
    sessionsById: sessionState.byId,
    preferences,
    changePreferences,
  }
  useEffect(() => {
    setPaletteRecentLimit(preferences.paletteRecentLimit)
  }, [preferences.paletteRecentLimit])
  useEffect(() => () => setPaletteRecentLimit(10), [])
  useEffect(() => {
    const actions: readonly PaletteAction[] = [
      {
        id: '@dshfiles/thread-sidebar/thread/copy-link',
        label: () => latestRowActions.current.props.tSidebar('threadSidebarCopyLink'),
        aliases: ['copy link', 'thread url'],
        icon: <LinkIcon className="dshx:size-4" />,
        group: 'action',
        isAvailable: context => context.thread !== null,
        run: async context => {
          const thread = context.thread
          if (thread === null) return
          const current = latestRowActions.current
          const session = Object.values(current.sessionsById).find(candidate => candidate.id === thread.id)
          if (session === undefined) return
          await current.copyContextValue(
            buildThreadUrl(window.location.href, session.id, thread.workspaceId),
            current.props.tSidebar('threadSidebarLinkCopied'),
          )
        },
      },
      {
        id: '@dshfiles/thread-sidebar/thread/pin',
        label: () => latestRowActions.current.props.tSidebar('threadSidebarPin'),
        aliases: ['pin thread'],
        icon: <IconPinOutlineRegular size={16} />,
        group: 'action',
        isAvailable: context => context.thread !== null && !context.thread.pinned,
        run: async context => {
          const thread = context.thread
          if (thread === null) return
          const session = Object.values(latestRowActions.current.sessionsById).find(candidate => candidate.id === thread.id)
          if (session !== undefined) await latestRowActions.current.mutateSession(session.id, 'pin')
        },
      },
      {
        id: '@dshfiles/thread-sidebar/thread/unpin',
        label: () => latestRowActions.current.props.tSidebar('threadSidebarUnpin'),
        aliases: ['unpin thread'],
        icon: <IconPinFillRegular size={16} />,
        group: 'action',
        isAvailable: context => context.thread !== null && context.thread.pinned,
        run: async context => {
          const thread = context.thread
          if (thread === null) return
          const session = Object.values(latestRowActions.current.sessionsById).find(candidate => candidate.id === thread.id)
          if (session !== undefined) await latestRowActions.current.mutateSession(session.id, 'unpin')
        },
      },
    ]
    const disposers = actions.map(action => registerPaletteAction(action))
    return () => disposers.forEach(dispose => dispose())
  }, [])
  // One stable object for every row; it reads the latest closures so memoized rows never go stale.
  const rowActions = useMemo<RowActions>(() => {
    return {
      open: sessionId => latestRowActions.current.openThread(sessionId),
      mutate: (sessionId, operation) => latestRowActions.current.mutateSession(sessionId, operation),
      toggleParked: sessionId => latestRowActions.current.toggleParked(sessionId),
      copy: (value, successMessage) => latestRowActions.current.copyContextValue(value, successMessage),
      toggleChildren: (sessionId, currentlyOpen) => setChildrenOpenOverrides(current => new Map(current).set(sessionId, !currentlyOpen)),
      toggleAllChildren: sessionId => setExpandedParents(current => toggleSetMember(current, sessionId)),
      mute: (sessionId, option) => {
        const current = latestRowActions.current
        const threads = Object.values(current.sessionsById).filter(session => !session.blank)
        const targetIds = threadActionTargetIds({ threadId: sessionId, threads, cascadeToChildren: current.preferences.applyActionsToChildThreads })
        current.changePreferences({
          mutedThreads: muteSessions({
            mutes: current.preferences.mutedThreads,
            sessions: threads.filter(session => targetIds.includes(session.id)),
            until: muteUntil(option, Date.now()),
          }),
        })
      },
      unmute: sessionId => {
        const current = latestRowActions.current
        const targetIds = threadActionTargetIds({
          threadId: sessionId,
          threads: Object.values(current.sessionsById).filter(session => !session.blank),
          cascadeToChildren: current.preferences.applyActionsToChildThreads,
        })
        current.changePreferences({ mutedThreads: unmuteSessions(current.preferences.mutedThreads, targetIds) })
      },
      markUnread: sessionId => {
        const current = threadNotificationPreferences.get() ?? DEFAULT_THREAD_NOTIFICATION_PREFERENCES
        threadNotificationPreferences.set(markThreadUnread(current, sessionId))
      },
      setAutoArchiveOverride: (sessionId, override) => {
        const current = latestRowActions.current
        const next = updateAutoArchiveOverride(current.preferences, sessionId, override)
        current.changePreferences({
          autoArchiveSessionIds: next.autoArchiveSessionIds,
          autoArchiveDisabledSessionIds: next.autoArchiveDisabledSessionIds,
        })
      },
      translate: (...args) => latestRowActions.current.props.tSidebar(...args),
    }
  }, [])

  const renderThreadRow = (session: SessionSummary, attentionLabel: ThreadRowProps['attentionLabel']): JSX.Element => {
    const lineage = sessionLineage(session, sessionState.byId)
    const workspaceId = workspaceForLineage(session, sessionState.byId, workspaceBySession)
    const listedChildThreads =
      threadView.sourceFilter === 'main'
        ? NO_CHILDREN
        : (threadTree.childrenByRoot.get(session.id) ?? NO_CHILDREN).filter(
            child =>
              !(threadView.groupBy === 'status' && attentionIds.has(child.id)) &&
              matchesThreadStatusFilter({
                filters: threadView.statusFilters,
                running: child.running,
                needsAttention: attentionSessionIds.has(child.id),
                archived: archivedSessionIds.has(child.id),
                muted: mutedSessionIds.has(child.id),
              }),
          )
    const selectedChildId = listedChildThreads.some(child => child.id === selectedSession?.id) ? selectedSession?.id : undefined
    const { live: childThreads, finished: finishedChildThreads } = partitionFinishedChildren({
      children: listedChildThreads,
      mode: preferences.finishedSubagents,
      isFinished: child => child.origin === 'subagent' && !child.running && !waitingSessionIds.has(child.id),
      selectedId: selectedChildId,
    })
    const rowAttentionLabel = attentionLabel ?? inlineAttentionLabels.get(session.id)
    return (
      <ThreadRow
        key={session.id}
        session={session}
        unread={unreadSessionIds.has(session.id)}
        autoArchiveOverride={autoArchiveOverrideForSession(preferences, session.id)}
        unreadSessionIds={unreadSessionIds}
        archived={archivedSessionIds.has(session.id)}
        pinned={pinnedSessionIds.has(session.id)}
        parked={parkedSessionIds.has(session.id)}
        selected={selectedSession?.id === session.id}
        parentTitle={lineage.parentTitle}
        workspaceId={workspaceId}
        workspaceTitle={displayWorkspaces.find(workspace => workspace.id === workspaceId)?.title}
        machine={machine}
        age={formatAge(session.updatedAt)}
        mute={mutedSessionIds.has(session.id) ? mutedThreads[session.id] : undefined}
        attentionLabel={rowAttentionLabel}
        rebasedAt={rebasedIndex.rebasedAtBySessionId.get(session.id)}
        childAttentionLabels={inlineAttentionLabels}
        rowStyle={rowStyle}
        childThreads={childThreads}
        finishedChildThreads={finishedChildThreads}
        childrenOpen={shouldOpenChildThreadList({ children: listedChildThreads, override: childrenOpenOverrides.get(session.id) })}
        allChildrenShown={expandedParents.has(session.id)}
        selectedChildId={selectedChildId}
        actions={rowActions}
      />
    )
  }

  useEffect(() => {
    if (sessionState.phase !== 'ready') return
    const currentStatusEntries = sessions.map(session => {
      const status = sessionStatus.get(session.id)
      return {
        sessionId: session.id,
        status: {
          pendingInteractionKey: status?.pendingInteraction?.key,
          pendingInteractionKind: status?.pendingInteraction?.kind,
          completionUnread: status?.completionUnread ?? false,
        },
      }
    })
    const currentStatus: Readonly<Record<string, ThreadAttentionStatus>> = Object.fromEntries(
      currentStatusEntries.map((entry): [string, ThreadAttentionStatus] => [entry.sessionId, entry.status]),
    )
    const transitions = threadAttentionTransitions(previousStatus.current, currentStatusEntries)
    previousStatus.current = currentStatus
    const now = Date.now()
    const current = threadNotificationPreferences.get() ?? DEFAULT_THREAD_NOTIFICATION_PREFERENCES
    const mutes = latestRowActions.current.preferences.mutedThreads
    const eligibleSessionIds = new Set(
      currentStatusEntries.flatMap(({ sessionId, status }) => {
        const session = sessionState.byId[sessionId]
        return status.completionUnread &&
          !isMuteActive(mutes[sessionId], now) &&
          session !== undefined &&
          isAttentionSessionIncluded(session, preferences.includeSubagentAttention)
          ? [sessionId]
          : []
      }),
    )
    const completionReconciliation = reconcileFinishedThreadNotifications({
      preferences: current,
      statuses: currentStatusEntries.map(({ sessionId }) => ({ sessionId, completionUnread: sessionStatus.get(sessionId)?.completionUnread })),
      eligibleSessionIds,
      newlyFinishedSessionIds: transitions.turnFinished,
      now,
    })
    const notifyThread = (sessionId: SessionSummary['id'], title: string, fallbackBody: string): void => {
      if (!current.enabled || isMuteActive(mutes[sessionId], now) || !('Notification' in window) || window.Notification.permission !== 'granted') return
      const session = sessionState.byId[sessionId]
      if (session === undefined || !isAttentionSessionIncluded(session, preferences.includeSubagentAttention)) return
      try {
        const notification = new window.Notification(title, { body: session?.displayTitle ?? fallbackBody })
        notification.onclick = () => {
          window.focus()
          if (session !== undefined) openThread(sessionId)
          notification.close()
        }
      } catch {
        setNotice({ tone: 'warning', message: props.tSidebar('threadSidebarNotificationsUnavailable') })
      }
    }
    for (const sessionId of transitions.approvalNeeded) {
      if (selectedSession?.id === sessionId) continue
      notifyThread(sessionId, props.tSidebar('threadSidebarApprovalNotificationTitle'), props.tSidebar('threadSidebarApprovalNotificationBody'))
    }
    for (const sessionId of transitions.inputNeeded) {
      if (selectedSession?.id === sessionId) continue
      notifyThread(sessionId, props.tSidebar('threadSidebarInputNotificationTitle'), props.tSidebar('threadSidebarInputNotificationBody'))
    }
    for (const sessionId of transitions.turnFinished) {
      if (selectedSession?.id === sessionId) continue
      notifyThread(sessionId, props.tSidebar('threadSidebarNotificationTitle'), props.tSidebar('threadSidebarNotificationDone'))
    }
    if (completionReconciliation.changed) threadNotificationPreferences.set(completionReconciliation.preferences)
  }, [
    notificationPreferences.enabled,
    openThread,
    preferences.includeSubagentAttention,
    props.tSidebar,
    selectedSession?.id,
    sessionStatus,
    sessionState.byId,
    sessionState.phase,
    sessions,
  ])

  const isTransientNotice =
    notice !== null && (notice.tone === 'success' || notice.durationMs !== undefined || (notice.actionLabel !== undefined && notice.onAction !== undefined))
  const noticeAlert =
    notice === null ? null : (
      <Alert
        variant={notice.tone === 'danger' ? 'destructive' : notice.tone}
        className={cn(
          noticeClass,
          isTransientNotice &&
            'dshx:flex dshx:w-fit dshx:max-w-full dshx:pointer-events-auto dshx:items-center dshx:gap-2 dshx:border-border dshx:bg-card dshx:text-card-foreground dshx:shadow-lg',
        )}
      >
        <div className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
          {isTransientNotice ? (
            <span className="dshx:min-w-0 dshx:truncate dshx:text-card-foreground" title={notice.message}>
              {notice.message}
            </span>
          ) : (
            <SidebarNoticeMessage message={notice.message} />
          )}
          {notice.actionLabel !== undefined && notice.onAction !== undefined ? (
            <Button size="xs" variant="outline" onClick={notice.onAction}>
              {notice.actionLabel}
            </Button>
          ) : null}
        </div>
      </Alert>
    )

  return (
    <TooltipProvider delayDuration={500}>
      <section
        className="dshx-root dshx:relative dshx:flex dshx:h-full dshx:w-full dshx:min-h-0 dshx:min-w-0 dshx:flex-col"
        aria-label={props.tSidebar('threadSidebarTitle')}
      >
        <header className="dshx:px-2 dshx:py-1">
          <div className="dshx:flex dshx:items-center dshx:gap-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="dshx:h-8 dshx:min-w-0 dshx:flex-1 dshx:justify-between dshx:px-2.5 dshx:text-base dshx:font-medium">
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
            <Button
              type="button"
              size="icon"
              variant={settingsOpen ? 'secondary' : 'ghost'}
              aria-label={props.tSidebar('threadSidebarSettings')}
              aria-expanded={settingsOpen}
              onClick={() => setSettingsOpen(current => !current)}
            >
              <Settings2Icon />
            </Button>
          </div>
          <div role="group" className="dshx:flex dshx:gap-1 dshx:overflow-x-auto dshx:pt-1" aria-label={props.tSidebar('threadSidebarListView')}>
            {threadViewSettings.views
              .filter(view => view.enabled)
              .map(view => (
                <Button
                  key={view.id}
                  type="button"
                  variant={view.id === threadView.id ? 'secondary' : 'ghost'}
                  size="sm"
                  className="dshx:min-w-20 dshx:flex-1 dshx:shrink-0"
                  aria-pressed={view.id === threadView.id}
                  onClick={() => selectThreadViewPreset(view.id)}
                >
                  <span className="dshx:truncate">{threadViewPresetLabel(view, props.tSidebar)}</span>
                  {view.statusFilters.length === 1 && view.statusFilters[0] === 'working' ? (
                    <span className="dshx:shrink-0">({workingThreadCountsBySource[view.sourceFilter]})</span>
                  ) : null}
                </Button>
              ))}
          </div>
          {threadViewSettings.showGroupControl || threadViewSettings.showFilterControl ? (
            <div
              className={cn(
                'dshx:grid dshx:gap-1 dshx:pt-1',
                threadViewSettings.showGroupControl && threadViewSettings.showFilterControl ? 'dshx:grid-cols-2' : 'dshx:grid-cols-1',
              )}
            >
              {threadViewSettings.showGroupControl ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="dshx:min-w-0 dshx:justify-start dshx:text-xs"
                      aria-label={`${props.tSidebar('threadSidebarGroup')}: ${props.tSidebar(threadGroupLabelKeys[threadView.groupBy])}`}
                    >
                      <span className="dshx:truncate">
                        {props.tSidebar('threadSidebarGroup')}: {props.tSidebar(threadGroupLabelKeys[threadView.groupBy])}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="dshx-root dshx:min-w-48">
                    <DropdownMenuLabel>{props.tSidebar('threadSidebarGroupBy')}</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={threadView.groupBy} onValueChange={selectThreadGroupBy}>
                      {THREAD_GROUP_BY_OPTIONS.map(groupBy => (
                        <DropdownMenuRadioItem key={groupBy} value={groupBy}>
                          {props.tSidebar(threadGroupLabelKeys[groupBy])}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
              {threadViewSettings.showFilterControl ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="dshx:min-w-0 dshx:justify-start dshx:text-xs"
                      aria-label={`${props.tSidebar('threadSidebarFilter')}: ${activeFilterSummary}`}
                    >
                      <span className="dshx:truncate">
                        {props.tSidebar('threadSidebarFilter')}: {activeFilterSummary}
                      </span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="dshx-root dshx:min-w-52">
                    <DropdownMenuLabel>{props.tSidebar('threadSidebarFilterStatus')}</DropdownMenuLabel>
                    {THREAD_STATUS_FILTER_OPTIONS.map(filter => (
                      <DropdownMenuCheckboxItem
                        checked={filter === 'all' ? threadView.statusFilters.length === 0 : threadView.statusFilters.includes(filter)}
                        key={filter}
                        onCheckedChange={checked => selectThreadStatusFilter(filter, checked)}
                        onSelect={event => event.preventDefault()}
                      >
                        {props.tSidebar(threadStatusFilterLabelKeys[filter])}
                      </DropdownMenuCheckboxItem>
                    ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>{props.tSidebar('threadSidebarFilterSource')}</DropdownMenuLabel>
                    <DropdownMenuRadioGroup value={threadView.sourceFilter} onValueChange={selectThreadSourceFilter}>
                      {THREAD_SOURCE_FILTER_OPTIONS.map(filter => (
                        <DropdownMenuRadioItem key={filter} value={filter}>
                          {props.tSidebar(threadSourceFilterLabelKeys[filter])}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </div>
          ) : null}
        </header>

        {settingsOpen ? (
          <section
            className="dshx:mx-2 dshx:mb-2 dshx:grid dshx:gap-3 dshx:rounded-lg dshx:border dshx:bg-card dshx:p-3"
            aria-label={props.tSidebar('threadSidebarSettings')}
          >
            <fieldset className="dshx:grid dshx:gap-2 dshx:rounded-md dshx:border dshx:px-2.5 dshx:pt-1 dshx:pb-2.5">
              <legend className="dshx:px-1 dshx:text-xs dshx:text-muted-foreground">{props.tSidebar('threadSidebarViewControls')}</legend>
              <Label className="dshx:font-normal dshx:leading-snug">
                <Checkbox
                  aria-label={props.tSidebar('threadSidebarShowGroupControl')}
                  checked={threadViewSettings.showGroupControl}
                  onCheckedChange={checked => updateThreadViewControls({ showGroupControl: checked === true })}
                />
                {props.tSidebar('threadSidebarShowGroupControl')}
              </Label>
              <Label className="dshx:font-normal dshx:leading-snug">
                <Checkbox
                  aria-label={props.tSidebar('threadSidebarShowFilterControl')}
                  checked={threadViewSettings.showFilterControl}
                  onCheckedChange={checked => updateThreadViewControls({ showFilterControl: checked === true })}
                />
                {props.tSidebar('threadSidebarShowFilterControl')}
              </Label>
              <Button className="dshx:justify-start" onClick={() => setViewsManagerOpen(true)} size="sm" type="button" variant="outline">
                {props.tSidebar('threadSidebarManageViews')}
              </Button>
            </fieldset>
            <Label className="dshx:font-normal dshx:leading-snug">
              <Checkbox checked={preferences.autoArchiveEnabled} onCheckedChange={checked => changePreferences({ autoArchiveEnabled: checked === true })} />
              {props.tSidebar('threadSidebarAutoArchive')}
            </Label>
            <div className="dshx:grid dshx:min-w-0 dshx:gap-1" role="group" aria-label={props.tSidebar('threadSidebarArchiveRebased')}>
              <span className="dshx:text-xs">{props.tSidebar('threadSidebarArchiveRebased')}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="dshx:min-w-0 dshx:justify-start">
                    {props.tSidebar(rebasedArchiveDelayLabelKeys[preferences.rebasedThreadArchiveDelay])}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuRadioGroup
                    value={preferences.rebasedThreadArchiveDelay}
                    onValueChange={value => {
                      const delay = rebasedArchiveDelayFromValue(value)
                      if (delay !== undefined) changePreferences({ rebasedThreadArchiveDelay: delay })
                    }}
                  >
                    {REBASED_THREAD_ARCHIVE_DELAYS.map(delay => (
                      <DropdownMenuRadioItem key={delay} value={delay}>
                        {props.tSidebar(rebasedArchiveDelayLabelKeys[delay])}
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <p className="dshx:text-xs dshx:text-muted-foreground">{props.tSidebar('threadSidebarArchiveRebasedHint')}</p>
            </div>
            <Label className="dshx:font-normal dshx:leading-snug">
              <Checkbox
                checked={preferences.applyActionsToChildThreads}
                onCheckedChange={checked => changePreferences({ applyActionsToChildThreads: checked === true })}
              />
              {props.tSidebar('threadSidebarApplyActionsToChildren')}
            </Label>
            <p className="dshx:text-xs dshx:text-muted-foreground">{props.tSidebar('threadSidebarApplyActionsToChildrenHint')}</p>
            <div className="dshx:grid dshx:min-w-0 dshx:gap-1">
              <span className="dshx:text-xs">{props.tSidebar('threadSidebarFinishedSubagents')}</span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    className="dshx:min-w-0 dshx:justify-start"
                    aria-label={`${props.tSidebar('threadSidebarFinishedSubagents')}: ${props.tSidebar(finishedSubagentsLabels[preferences.finishedSubagents])}`}
                  >
                    {props.tSidebar(finishedSubagentsLabels[preferences.finishedSubagents])}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuRadioGroup
                    value={preferences.finishedSubagents}
                    onValueChange={value => {
                      if (value === 'show' || value === 'collapse' || value === 'hide') changePreferences({ finishedSubagents: value })
                    }}
                  >
                    <DropdownMenuRadioItem value="collapse">{props.tSidebar('threadSidebarFinishedSubagentsCollapse')}</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="hide">{props.tSidebar('threadSidebarFinishedSubagentsHide')}</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="show">{props.tSidebar('threadSidebarFinishedSubagentsShow')}</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <Label className="dshx:font-normal dshx:leading-snug">
              <Checkbox checked={preferences.archiveUndoEnabled} onCheckedChange={checked => changePreferences({ archiveUndoEnabled: checked === true })} />
              {props.tSidebar('threadSidebarArchiveUndoEnabled')}
            </Label>
            <p className="dshx:text-xs dshx:text-muted-foreground">{props.tSidebar('threadSidebarArchiveUndoHint')}</p>
            <div className="dshx:grid dshx:grid-cols-2 dshx:gap-2">
              <div className="dshx:grid dshx:content-start dshx:gap-1.5">
                <Label htmlFor={`${settingsId}-archive-undo-duration`} className="dshx:text-xs dshx:font-normal dshx:leading-snug dshx:text-muted-foreground">
                  {props.tSidebar('threadSidebarArchiveUndoDuration')}
                </Label>
                <Input
                  id={`${settingsId}-archive-undo-duration`}
                  className="dshx:h-7"
                  type="number"
                  min={1}
                  max={30}
                  value={preferences.archiveUndoDurationSeconds}
                  onChange={event => {
                    const value = Number(event.currentTarget.value)
                    if (Number.isInteger(value) && value >= 1 && value <= 30) changePreferences({ archiveUndoDurationSeconds: value })
                  }}
                />
              </div>
            </div>
            <Label className="dshx:font-normal dshx:leading-snug">
              <Checkbox checked={notificationPreferences.enabled} onCheckedChange={checked => void changeDesktopNotifications(checked === true)} />
              {props.tSidebar('threadSidebarDesktopNotifications')}
            </Label>
            <p className="dshx:text-xs dshx:text-muted-foreground">{props.tSidebar('threadSidebarNotificationPrivacy')}</p>
            <fieldset className="dshx:grid dshx:min-w-0 dshx:gap-2 dshx:rounded-md dshx:border dshx:px-2.5 dshx:pt-1 dshx:pb-2.5">
              <legend className="dshx:px-1 dshx:text-xs dshx:text-muted-foreground">{props.tSidebar('threadSidebarAttentionPresentation')}</legend>
              <p className="dshx:text-xs dshx:text-muted-foreground">{props.tSidebar('threadSidebarAttentionPresentationHint')}</p>
              <div className="dshx:grid dshx:gap-2.5">
                {attentionPreferenceRows.map(({ key, label, colorKey }) => attentionDisplayRow(key, label, colorKey))}
              </div>
              <Label className="dshx:font-normal dshx:leading-snug">
                <Checkbox
                  checked={preferences.includeSubagentAttention}
                  onCheckedChange={checked => changePreferences({ includeSubagentAttention: checked === true })}
                />
                {props.tSidebar('threadSidebarIncludeSubagentAttention')}
              </Label>
              <p className="dshx:text-xs dshx:text-muted-foreground">{props.tSidebar('threadSidebarSubagentAttentionHint')}</p>
            </fieldset>
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

        {isTransientNotice && noticeAlert !== null ? (
          <div
            data-testid="thread-sidebar-transient-notice"
            className="dshx:pointer-events-none dshx:absolute dshx:inset-x-2 dshx:bottom-3 dshx:z-20 dshx:flex dshx:justify-center"
          >
            {noticeAlert}
          </div>
        ) : null}
        {(notice !== null && !isTransientNotice) || storageWarning || threadViewStorageWarning ? (
          <div className="dshx:grid dshx:gap-2 dshx:px-2 dshx:pb-2">
            {notice !== null && !isTransientNotice ? noticeAlert : null}
            {storageWarning || threadViewStorageWarning ? (
              <Alert variant="warning" className={noticeClass}>
                <SidebarNoticeMessage message={props.tSidebar('threadSidebarStorageFailure')} />
              </Alert>
            ) : null}
          </div>
        ) : null}

        <div data-testid="thread-sidebar-scroll" className="dshx:min-h-0 dshx:flex-1 dshx:overflow-auto dshx:overscroll-y-contain dshx:px-2 dshx:pb-3">
          {sessionState.phase !== 'ready' || workspaceState.phase !== 'ready' ? (
            <div className="dshx:flex dshx:items-center dshx:justify-center dshx:gap-2 dshx:py-6 dshx:text-sm dshx:text-muted-foreground">
              <Spinner />
              {props.tSidebar('threadSidebarLoading')}
            </div>
          ) : null}
          {groupedAttentionRows.approvalNeeded.length > 0 ? (
            <section className="dshx:mt-1" aria-label={props.tSidebar('threadSidebarApprovalNeeded')}>
              <div className={cn(stickyHeaderClass, 'dshx:flex dshx:h-8 dshx:items-center dshx:gap-2 dshx:px-2.5 dshx:text-sm')}>
                <span
                  className={cn('dshx:whitespace-nowrap dshx:font-medium', attentionLabelClass('threadSidebarApprovalNeeded', preferences.attentionColors))}
                >
                  {props.tSidebar('threadSidebarApprovalNeeded')}
                </span>
                <span className="dshx:text-xs dshx:tabular-nums">({groupedAttentionRows.approvalNeeded.length})</span>
                <span className="dshx:h-px dshx:flex-1 dshx:bg-border" aria-hidden="true" />
              </div>
              {groupedAttentionRows.approvalNeeded.map(session => renderThreadRow(session, 'threadSidebarApprovalNeeded'))}
            </section>
          ) : null}
          {groupedAttentionRows.inputNeeded.length > 0 ? (
            <section className="dshx:mt-1" aria-label={props.tSidebar('threadSidebarInputNeeded')}>
              <div className={cn(stickyHeaderClass, 'dshx:flex dshx:h-8 dshx:items-center dshx:gap-2 dshx:px-2.5 dshx:text-sm')}>
                <span className={cn('dshx:whitespace-nowrap dshx:font-medium', attentionLabelClass('threadSidebarInputNeeded', preferences.attentionColors))}>
                  {props.tSidebar('threadSidebarInputNeeded')}
                </span>
                <span className="dshx:text-xs dshx:tabular-nums">({groupedAttentionRows.inputNeeded.length})</span>
                <span className="dshx:h-px dshx:flex-1 dshx:bg-border" aria-hidden="true" />
              </div>
              {groupedAttentionRows.inputNeeded.map(session => renderThreadRow(session, 'threadSidebarInputNeeded'))}
            </section>
          ) : null}
          {groupedAttentionRows.turnFinished.length > 0 ? (
            <section className="dshx:mt-1" aria-label={props.tSidebar('threadSidebarTurnFinished')}>
              <div className={cn(stickyHeaderClass, 'dshx:flex dshx:h-8 dshx:items-center dshx:gap-2 dshx:px-2.5 dshx:text-sm')}>
                <span className={cn('dshx:whitespace-nowrap dshx:font-medium', attentionLabelClass('threadSidebarTurnFinished', preferences.attentionColors))}>
                  {props.tSidebar('threadSidebarTurnFinished')}
                </span>
                <span className="dshx:text-xs dshx:tabular-nums">({groupedAttentionRows.turnFinished.length})</span>
                <span className="dshx:h-px dshx:flex-1 dshx:bg-border" aria-hidden="true" />
              </div>
              {groupedAttentionRows.turnFinished.map(session => renderThreadRow(session, 'threadSidebarTurnFinished'))}
            </section>
          ) : null}
          {threadView.groupBy === 'status'
            ? sections.map(section => {
                const rows = rowsBySection.get(section) ?? []
                if (rows.length === 0 && section !== 'active') return null
                const collapsed = preferences.collapsedSections.includes(section)
                return (
                  <section className="dshx:mt-1" key={section}>
                    <button
                      type="button"
                      className={cn(
                        stickyHeaderClass,
                        'dshx:flex dshx:h-8 dshx:w-full dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2.5 dshx:text-sm dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50',
                      )}
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
                    {!collapsed ? rows.map(session => renderThreadRow(session, undefined)) : null}
                  </section>
                )
              })
            : groupedThreadEntries.map(group => (
                <section className="dshx:mt-1" key={group.key} aria-label={group.showHeader ? group.label : undefined}>
                  {group.showHeader ? (
                    <div
                      className={cn(stickyHeaderClass, 'dshx:flex dshx:h-8 dshx:items-center dshx:gap-2 dshx:px-2.5 dshx:text-sm dshx:text-muted-foreground')}
                    >
                      <span className="dshx:whitespace-nowrap">{group.label}</span>
                      <span className="dshx:text-xs dshx:tabular-nums">({group.threads.length})</span>
                      <span className="dshx:h-px dshx:flex-1 dshx:bg-border" aria-hidden="true" />
                    </div>
                  ) : null}
                  {group.threads.map(session => renderThreadRow(session, undefined))}
                </section>
              ))}
          {props.openRemoteThreads === undefined ? null : <RemoteThreadsSection headerClassName={stickyHeaderClass} onOpen={props.openRemoteThreads} />}
          {sessionState.phase === 'ready' &&
          groupedAttentionRows.approvalNeeded.length === 0 &&
          groupedAttentionRows.inputNeeded.length === 0 &&
          groupedAttentionRows.turnFinished.length === 0 &&
          (threadView.groupBy === 'status'
            ? [...rowsBySection.values()].every(rows => rows.length === 0)
            : groupedThreadEntries.every(group => group.threads.length === 0)) ? (
            <Empty className="dshx:gap-2 dshx:p-6 dshx:md:p-6">
              <EmptyTitle className="dshx:text-sm dshx:font-normal dshx:text-muted-foreground">
                {props.tSidebar(emptyThreadsMessage[threadView.statusFilters.length === 1 ? (threadView.statusFilters[0] ?? 'all') : 'all'])}
              </EmptyTitle>
            </Empty>
          ) : null}
        </div>
      </section>
      <ThreadViewManager
        onOpenChange={setViewsManagerOpen}
        onSettingsChange={saveThreadViewSettings}
        open={viewsManagerOpen}
        settings={threadViewSettings}
        t={props.tSidebar}
      />
    </TooltipProvider>
  )
}
