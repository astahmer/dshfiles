import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceBrowserProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { jjIntegrationApi } from '@dshfiles/jj-integration/api'
import { HostSnapshotsModel } from './snapshots.js'
import { storedCollapsedGroups, toggleCollapsedGroup } from './collapsed-groups.js'
import { useNearViewport } from './use-near-viewport.js'
import { RemoteThreadsSection } from './remote-threads-section.js'
import { StableValueModel, useStableValue } from './stable-value.js'
import { createThreadChildRowCache, type ThreadChildRowCache } from './thread-child-rows.js'
import { useApi, useApiQuery } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { createInventoryPoll } from './inventory-poll.js'
import { aiAccountsApi } from '@dshfiles/ai-accounts/api'
import { threadSidebarPendingQuestionsApi } from './pending-questions-api.js'
import {
  IconArchiveOutlineRegular,
  IconCheckCircleOutlineRegular,
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
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
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
  PanelRightOpenIcon,
  RefreshCwIcon,
  Settings2Icon,
  XIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import {
  createContext,
  Fragment,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react'
import { z } from 'zod'
import {
  SidebarOrganization,
  type AutoSettleOverride,
  type AttentionColor,
  type AttentionColorKey,
  type AttentionColors,
  type SidebarPreferences,
  type SidebarSection,
  type ThreadRowAction,
  type ThreadRowDensity,
} from './organization.js'
import { ThreadAttentionPresentationModel, type ThreadAttentionLabel } from './attention-presentation.js'
import { SidebarPreferencesModel, attentionColorSchema } from './preferences.js'
import { selectInputNeededRows, selectTurnFinishedRows } from './attention-rows.js'
import { PaletteApi, type PaletteAction } from '@dshfiles/command-palette/api'
import { useSidebarState } from './sidebar-state.js'
import { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'
import { ThreadReferencesItems } from './thread-references-menu.js'
import { projectTextTone } from './project-tone.js'
import {
  INITIAL_SIDEBAR_NOTICE_QUEUE_STATE,
  scheduleSuccessNoticeDismissal,
  SidebarNoticeMessage,
  sidebarNoticeQueueReducer,
  type SidebarNotice,
} from './sidebar-notice.js'
import { threadSidebarMachineApi } from './machine-api.js'
import { threadSidebarRecoveryApi } from './recovery-api.js'
import { selectRecoveryRows } from './restart-recovery-rows.js'
import type { RecoveryReason } from './restart-recovery.js'
import { UsageLimitRowsModel, type QuotaContinuation } from './usage-limit-rows.js'
import { UsageLimitSection, type UsageLimitSnooze } from './usage-limit-section.js'
import { groupThreadChildren, partitionFinishedChildren, shouldOpenChildThreadList, threadActionTargetIds, visibleChildren } from './thread-children.js'
import { buildThreadUrl, clearThreadUrl, readThreadUrl } from './thread-url.js'
import { ThreadListNavigationModel } from './thread-list-navigation.js'
import { workingThreadIds } from './working-threads.js'
import { indexRebasedThreadSessions } from './rebased-threads.js'
import { SettledThreadsModel, type SettledSessionState } from './settled-threads.js'
import { THREAD_DELAYS, threadDelayMs, type ThreadDelay } from './thread-delays.js'
import { useAutoArchive, type AutoArchiveClient } from './auto-archive-machine.js'
import {
  THREAD_GROUP_BY_OPTIONS,
  THREAD_SOURCE_FILTER_OPTIONS,
  THREAD_STATUS_FILTER_OPTIONS,
  ThreadViewModel,
  type ThreadGroupBy,
  type ThreadSourceFilter,
  type ThreadViewPreferences,
} from './thread-view.js'
import { DEFAULT_THREAD_VIEW_SETTINGS, ThreadViewPreferencesModel, threadViewPreferences, type ThreadViewSettings } from './thread-view-preferences.js'
import { ThreadViewManager, threadViewPresetLabel } from './thread-view-manager.js'
import { captureThreadMentionInsertion, requestThreadMentionInsertion } from './thread-mention.js'
import {
  ThreadNotificationModel,
  legacyNotificationPreferences,
  type ThreadInteractionStatus,
  type ThreadNotificationCategory,
  type ThreadFinishNotificationCategory,
} from './thread-notifications.js'
import { ThreadNotificationAudioModel } from './thread-notification-audio.js'
import { useThreadAttention } from './attention-client.js'
import type { ThreadAttentionView } from './attention-api.js'
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
}

type ThreadSidebarProps = Pick<WorkspaceBrowserProps, 'open' | 'useSessions' | 'useSessionStatus' | 'useWorkspaces'> &
  InjectedActions & {
    tSidebar: TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>
    onNavigationLookahead?: (sessionIds: readonly SessionSummary['id'][]) => void
    /** The sidebar shell hides the thread region with CSS when it is collapsed; absent means a mount with no shell. */
    wide?: boolean
  }

type ThreadSidebarTranslate = ThreadSidebarProps['tSidebar']
const emptyThreadsMessage = {
  all: 'threadSidebarEmpty',
  working: 'threadSidebarNoWorkingThreads',
  'not-working': 'threadSidebarNoNotWorkingThreads',
  attention: 'threadSidebarNoAttentionThreads',
  muted: 'threadSidebarNoMutedThreads',
  settled: 'threadSidebarNoSettledThreads',
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

/** Both delay settings offer the same five choices, so they share one label map. */
const threadDelayLabelKeys = {
  disabled: 'threadSidebarDelayNever',
  immediately: 'threadSidebarDelayImmediate',
  'after-1-hour': 'threadSidebarDelayHour',
  'after-1-day': 'threadSidebarDelayDay',
  'after-1-week': 'threadSidebarDelayWeek',
} satisfies Record<ThreadDelay, Parameters<ThreadSidebarTranslate>[0]>

type ThreadSidebarLabelKey = Parameters<ThreadSidebarTranslate>[0]

/** One notice tone per category: failures read as errors, work that needs review as warnings. */
const notificationNoticeTones = {
  'approval-needed': 'warning',
  'input-needed': 'warning',
  'turn-finished': 'success',
  stopped: 'warning',
  failed: 'danger',
} as const satisfies Record<ThreadNotificationCategory, SidebarNotice['tone']>

const finishNotificationMessageKeys = {
  'turn-finished': { title: 'threadSidebarNotificationTitle', body: 'threadSidebarNotificationDone' },
  stopped: { title: 'threadSidebarStoppedNotificationTitle', body: 'threadSidebarStoppedNotificationBody' },
  failed: { title: 'threadSidebarFailedNotificationTitle', body: 'threadSidebarFailedNotificationBody' },
} as const satisfies Record<ThreadFinishNotificationCategory, { readonly title: ThreadSidebarLabelKey; readonly body: ThreadSidebarLabelKey }>

const threadDelayFromValue = (value: string): ThreadDelay | undefined => THREAD_DELAYS.find(option => option === value)

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
  settled: 'threadSidebarSettled',
  archived: 'threadSidebarArchived',
} satisfies Record<(typeof THREAD_STATUS_FILTER_OPTIONS)[number], Parameters<ThreadSidebarTranslate>[0]>

const threadSourceFilterLabelKeys = {
  all: 'threadSidebarFilterAllSources',
  main: 'threadSidebarFilterMainThreads',
  subagents: 'threadSidebarFilterSubagents',
} satisfies Record<ThreadSourceFilter, Parameters<ThreadSidebarTranslate>[0]>

const ALL_PROJECTS = '__all__'
/**
 * How often the sidebar re-reads the JJ inventory while the page is visible. The Host keeps a repository view for sixty
 * seconds, so a shorter schedule spent a full jj scan on every other tick.
 */
const INVENTORY_REFRESH_INTERVAL_MS = 60_000
const UNASSIGNED_PROJECT = '__unassigned__'

const sections: readonly SidebarSection[] = ['pinned', 'active', 'parked', 'settled', 'inactive', 'archived']

const sectionLabels: Record<SidebarSection, Parameters<ThreadSidebarTranslate>[0]> = {
  pinned: 'threadSidebarPinned',
  active: 'threadSidebarActive',
  parked: 'threadSidebarParked',
  settled: 'threadSidebarSettled',
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
  settled: <IconCheckCircleOutlineRegular size={14} />,
  inactive: <CirclePauseIcon className="dshx:size-3.5" />,
  archived: <IconArchiveOutlineRegular size={14} />,
}

const setIncludes = (values: readonly string[]): ReadonlySet<string> => new Set(values)

const toggleSetMember = (values: ReadonlySet<string>, value: string): ReadonlySet<string> => {
  const next = new Set(values)
  if (!next.delete(value)) next.add(value)
  return next
}

const restartRecoveryQueryKey = ['thread-sidebar', 'restart-recovery', 'pending'] as const
const usageLimitQueryKey = ['thread-sidebar', 'usage-limit', 'recoveries'] as const
/** Stable empty list, so a loading query never hands the selector a fresh array. */
const EMPTY_CONTINUATIONS: readonly QuotaContinuation[] = []

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

/** Short readable form of a session id for a row that cannot show the thread's own title. */
const shortSessionId = (sessionId: string): string => sessionId.replace(/^session-/, '').slice(0, 8)

/** Show one thread in a right-sidebar tab; provided by the client entry that owns the sidebar-right controller. */
type OpenAside = (sessionId: SessionSummary['id']) => void

const AsideOpenContext = createContext<OpenAside | null>(null)

/** Provider the entry wraps the sidebar in; the row menu reads it, so this seat's injected props keep their shape. */
export const ThreadAsideOpenProvider = AsideOpenContext.Provider

const useAsideOpen = (): OpenAside | null => useContext(AsideOpenContext)

type RowOperation = 'pin' | 'unpin' | 'archive' | 'unarchive'

interface RowActions {
  readonly open: (sessionId: SessionSummary['id']) => void
  readonly mutate: (sessionId: SessionSummary['id'], operation: RowOperation) => Promise<void>
  readonly toggleParked: (sessionId: SessionSummary['id']) => void
  readonly toggleSettled: (sessionId: SessionSummary['id']) => void
  readonly copy: (value: string, successMessage: string) => Promise<void>
  readonly toggleChildren: (sessionId: SessionSummary['id'], currentlyOpen: boolean) => void
  /** Any parent id, including a missing ancestor only its detached children name. */
  readonly toggleAllChildren: (parentId: string) => void
  readonly mute: (sessionId: SessionSummary['id'], option: ThreadMuteOption) => void
  readonly unmute: (sessionId: SessionSummary['id']) => void
  readonly markUnread: (sessionId: SessionSummary['id']) => void
  readonly resume: (sessionId: SessionSummary['id']) => void
  readonly dismissRecovery: (sessionId: SessionSummary['id']) => void
  readonly setAutoSettleOverride: (sessionId: SessionSummary['id'], override: AutoSettleOverride) => void
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
  readonly autoSettleOverride: AutoSettleOverride
  readonly unreadSessionIds: ReadonlySet<SessionSummary['id']>
  readonly archived: boolean
  readonly pinned: boolean
  readonly parked: boolean
  readonly settled: boolean
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
  readonly needsResume: boolean
  readonly resumeBusy: boolean
  readonly childAttentionLabels: ReadonlyMap<SessionSummary['id'], ThreadAttentionLabel>
  readonly rowStyle: RowStyle
  /** Hover actions this row draws, already limited to the shown ones and ordered left to right. */
  readonly rowActions: readonly ThreadRowAction[]
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
  const dotClass = ThreadAttentionPresentationModel.attentionDotClass({
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
  readonly parentId: string
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
          data-thread-id={child.id}
          data-thread-main-action=""
          data-selected={child.id === props.selectedChildId}
          aria-current={child.id === props.selectedChildId ? 'page' : undefined}
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
            <span
              className={cn(
                'dshx:shrink-0 dshx:text-[10px] dshx:font-medium',
                ThreadAttentionPresentationModel.attentionLabelClass(attentionLabel, props.rowStyle.attentionColors),
              )}
            >
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

type ThreadContextMenuProps = Pick<
  ThreadRowProps,
  'session' | 'unread' | 'autoSettleOverride' | 'mute' | 'archived' | 'pinned' | 'parked' | 'settled' | 'workspaceId' | 'actions'
> & { readonly children: JSX.Element }

/** Right-click menu of one thread, shared by thread rows and the usage-limit rows. */
const ThreadContextMenu = (props: ThreadContextMenuProps): JSX.Element => {
  const { session, unread, archived, pinned, parked, settled } = props
  const t = props.actions.translate
  const openAside = useAsideOpen()
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{props.children}</ContextMenuTrigger>
      <ContextMenuContent className="dshx-root dshx:min-w-44" aria-label={t('threadSidebarContextMenu')}>
        <ContextMenuItem onSelect={() => requestThreadMentionInsertion(session.id)}>{t('threadSidebarInsertMention')}</ContextMenuItem>
        <ContextMenuItem onSelect={() => void props.actions.copy(session.id, t('threadSidebarIdCopied'))}>{t('threadSidebarCopyId')}</ContextMenuItem>
        <ContextMenuItem
          onSelect={() => void props.actions.copy(buildThreadUrl(window.location.href, session.id, props.workspaceId), t('threadSidebarLinkCopied'))}
        >
          {t('threadSidebarCopyLink')}
        </ContextMenuItem>
        {archived || openAside === null ? null : <ContextMenuItem onSelect={() => openAside(session.id)}>{t('threadSidebarOpenInSidePanel')}</ContextMenuItem>}
        <ContextMenuSub>
          <ContextMenuSubTrigger>{t('threadSidebarReferencedBy')}</ContextMenuSubTrigger>
          <ContextMenuSubContent className="dshx-root dshx:min-w-56 dshx:max-w-72" aria-label={t('threadSidebarReferencedBy')}>
            <ThreadReferencesItems sessionId={session.id} t={t} openThread={props.actions.open} Item={ContextMenuItem} />
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem disabled={unread} onSelect={() => props.actions.markUnread(session.id)}>
          {t('threadSidebarMarkUnread')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger>{t('threadSidebarAutoSettleBehavior')}</ContextMenuSubTrigger>
          <ContextMenuSubContent className="dshx-root dshx:min-w-44">
            <ContextMenuRadioGroup value={props.autoSettleOverride}>
              <ContextMenuRadioItem
                value="inherit"
                onSelect={event => {
                  event.preventDefault()
                  props.actions.setAutoSettleOverride(session.id, 'inherit')
                }}
              >
                {t('threadSidebarAutoSettleInherit')}
              </ContextMenuRadioItem>
              <ContextMenuRadioItem
                value="enabled"
                onSelect={event => {
                  event.preventDefault()
                  props.actions.setAutoSettleOverride(session.id, 'enabled')
                }}
              >
                {t('threadSidebarAutoSettleEnabled')}
              </ContextMenuRadioItem>
              <ContextMenuRadioItem
                value="disabled"
                onSelect={event => {
                  event.preventDefault()
                  props.actions.setAutoSettleOverride(session.id, 'disabled')
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
            <ContextMenuItem disabled={session.running} onSelect={() => props.actions.toggleSettled(session.id)}>
              {t(settled ? 'threadSidebarUnsettle' : 'threadSidebarSettle')}
            </ContextMenuItem>
            <ContextMenuItem disabled={session.running} onSelect={() => void props.actions.mutate(session.id, 'archive')}>
              {t('threadSidebarArchive')}
            </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  )
}

/** Memoized so a session update re-renders only its own row, not the whole list. */
const ThreadRow = memo((props: ThreadRowProps): JSX.Element => {
  const { session, archived, pinned, parked, settled, rowStyle } = props
  const rowRef = useRef<HTMLElement | null>(null)
  // Offscreen rows keep their content and layout box; only their menus and hover actions wait for the viewport.
  const nearViewport = useNearViewport(rowRef)
  const t = props.actions.translate
  const unread = props.unread
  const compact = rowStyle.density === 'compact'
  const childCount = props.childThreads.length + props.finishedChildThreads.length
  const showProject = rowStyle.project || props.parentTitle !== undefined
  const showMachine = rowStyle.machine && props.machine !== undefined
  const showPath = rowStyle.path && session.cwd !== undefined && session.cwd.length > 0
  const metaLine = showProject || showMachine || showPath || childCount > 0
  const headLine = rowStyle.title || rowStyle.time || rowStyle.statusDot || props.rebasedAt !== undefined
  const openAside = useAsideOpen()
  /**
   * One hover action's button, or null when the row's own state rules it out: the recovery pair only on a thread that
   * needs a resume, an archived row's Restore instead of the live actions, and the aside only when an entry provided
   * its opener. The row's preference picks which of them render, and in which order.
   */
  const renderRowAction = (action: ThreadRowAction): JSX.Element | null => {
    if (action === 'resume' || action === 'resumeDismiss') {
      if (!props.needsResume) return null
      const resume = action === 'resume'
      return withTooltip(
        t(resume ? 'threadSidebarResume' : 'threadSidebarResumeDismiss'),
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t(resume ? 'threadSidebarResume' : 'threadSidebarResumeDismiss')}
          disabled={props.resumeBusy}
          onClick={() => (resume ? props.actions.resume(session.id) : props.actions.dismissRecovery(session.id))}
        >
          {resume && props.resumeBusy ? <Spinner className="dshx:size-3.5" /> : null}
          {resume && !props.resumeBusy ? <RefreshCwIcon className="dshx:size-3.5" /> : null}
          {resume ? null : <XIcon className="dshx:size-3.5" />}
        </Button>,
      )
    }
    if (archived) {
      if (action !== 'restore') return null
      return withTooltip(
        t('threadSidebarRestore'),
        <Button variant="ghost" size="icon-xs" aria-label={t('threadSidebarRestore')} onClick={() => void props.actions.mutate(session.id, 'unarchive')}>
          <IconUnarchiveOutlineRegular size={14} />
        </Button>,
      )
    }
    if (action === 'restore') return null
    if (action === 'aside') {
      if (openAside === null) return null
      return withTooltip(
        t('threadSidebarOpenInSidePanel'),
        <Button variant="ghost" size="icon-xs" aria-label={t('threadSidebarOpenInSidePanel')} onClick={() => openAside(session.id)}>
          <PanelRightOpenIcon size={14} />
        </Button>,
      )
    }
    if (action === 'pin') {
      return withTooltip(
        t(pinned ? 'threadSidebarUnpin' : 'threadSidebarPin'),
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t(pinned ? 'threadSidebarUnpin' : 'threadSidebarPin')}
          onClick={() => void props.actions.mutate(session.id, pinned ? 'unpin' : 'pin')}
        >
          {pinned ? <IconPinFillRegular size={14} /> : <IconPinOutlineRegular size={14} />}
        </Button>,
      )
    }
    if (action === 'park') {
      return withTooltip(
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
      )
    }
    if (action === 'settle') {
      return withTooltip(
        t(settled ? 'threadSidebarUnsettle' : 'threadSidebarSettle'),
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t(settled ? 'threadSidebarUnsettle' : 'threadSidebarSettle')}
          disabled={session.running || props.childThreads.some(child => child.running)}
          onClick={() => props.actions.toggleSettled(session.id)}
        >
          {settled ? <IconPlayOutlineRegular size={14} /> : <IconCheckCircleOutlineRegular size={14} />}
        </Button>,
      )
    }
    if (action === 'mute') {
      return withTooltip(
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
      )
    }
    return withTooltip(
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
    )
  }

  return (
    <ThreadContextMenu
      session={session}
      unread={unread}
      autoSettleOverride={props.autoSettleOverride}
      mute={props.mute}
      archived={archived}
      pinned={pinned}
      parked={parked}
      settled={settled}
      workspaceId={props.workspaceId}
      actions={props.actions}
    >
      <article
        ref={rowRef}
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
            data-thread-id={session.id}
            data-thread-main-action=""
            aria-current={props.selected ? 'page' : undefined}
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
                  <span
                    className={cn(
                      'dshx:shrink-0 dshx:text-xs dshx:font-medium',
                      ThreadAttentionPresentationModel.attentionLabelClass(props.attentionLabel, rowStyle.attentionColors),
                    )}
                  >
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
                        ThreadAttentionPresentationModel.attentionDotClass({
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
          {nearViewport ? (
            <div
              data-testid="thread-row-actions"
              className="dshx:pointer-events-none dshx:absolute dshx:top-1 dshx:right-1.5 dshx:flex dshx:gap-0.5 dshx:rounded-md dshx:border dshx:bg-popover dshx:p-0.5 dshx:opacity-0 dshx:shadow-xs dshx:transition-opacity dshx:group-hover/row:pointer-events-auto dshx:group-hover/row:opacity-100 dshx:focus-within:pointer-events-auto dshx:focus-within:opacity-100"
            >
              {props.rowActions.map(action => (
                <Fragment key={action}>{renderRowAction(action)}</Fragment>
              ))}
            </div>
          ) : null}
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
    </ThreadContextMenu>
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
  const sessionState = props.useSessions(HostSnapshotsModel.selectStableSessionListState)
  const sessionStatus = props.useSessionStatus(state => state)
  const workspaceState = props.useWorkspaces(state => state)
  const { preferences, updatePreferences, storageWarning, hostBacked, setSelectedThreadId, threadTitle } = useSidebarState()
  const attention = useThreadAttention({ enabled: sessionState.phase === 'ready' })
  const pendingQuestionsApi = useApi(threadSidebarPendingQuestionsApi)
  const recoveryApi = useApi(threadSidebarRecoveryApi)
  const queryClient = useQueryClient()
  const recoveryQuery = useQuery({
    queryKey: restartRecoveryQueryKey,
    queryFn: ({ signal }) => recoveryApi.pending(undefined, { signal }),
    refetchInterval: query => (isApiOwnerMissing(query.state.error) ? false : 5000),
    retry: false,
  })
  const resumeMutation = useMutation({ mutationFn: (input: { readonly sessionId: SessionSummary['id'] }) => recoveryApi.resume(input) })
  const dismissMutation = useMutation({ mutationFn: (input: { readonly sessionId: SessionSummary['id'] }) => recoveryApi.dismiss(input) })
  // A Host that predates the reason field answers with ids only; those entries are managed restarts.
  const recoveryReasonBySessionId = useMemo(() => {
    const reasons = new Map<string, RecoveryReason>()
    const entries = recoveryQuery.data?.entries
    if (entries === undefined) for (const sessionId of recoveryQuery.data?.sessionIds ?? []) reasons.set(sessionId, 'restart')
    else for (const entry of entries) reasons.set(entry.sessionId, entry.reason)
    return reasons
  }, [recoveryQuery.data])
  const recoverySessionIds = useMemo(() => new Set(recoveryReasonBySessionId.keys()), [recoveryReasonBySessionId])
  const recoveryReasonFor = useCallback(
    (sessionId: string): RecoveryReason | undefined => recoveryReasonBySessionId.get(sessionId),
    [recoveryReasonBySessionId],
  )
  const [resumeBusySessionIds, setResumeBusySessionIds] = useState<ReadonlySet<string>>(() => new Set())
  const [resumeAllBusy, setResumeAllBusy] = useState(false)
  const accountsApi = useApi(aiAccountsApi)
  const usageLimitQuery = useQuery({
    queryKey: usageLimitQueryKey,
    queryFn: ({ signal }) => accountsApi.quotaContinuations(undefined, { signal }),
    refetchInterval: query => (isApiOwnerMissing(query.state.error) ? false : 15_000),
    retry: false,
  })
  const [usageLimitBusyIds, setUsageLimitBusyIds] = useState<ReadonlySet<string>>(() => new Set())
  const [usageLimitResumeAllBusy, setUsageLimitResumeAllBusy] = useState(false)
  const machine = useApiQuery(threadSidebarMachineApi, 'name', { enabled: preferences.threadRowMachine }).data?.name
  // Collapsing the sidebar hides the thread region with CSS, so a jj scan bought while collapsed has no reader: the
  // query waits, the schedule stops, and expanding the sidebar fetches once and arms it again.
  const jjInventoryVisible = props.wide !== false
  const jjRepositories = useApiQuery(jjIntegrationApi, 'repositories', { input: {}, enabled: jjInventoryVisible })
  const refetchJjRepositories = jjRepositories.refetch
  const jjOwnerMissing = isApiOwnerMissing(jjRepositories.error)
  useEffect(() => {
    // The inventory schedule pauses with the page, waits while the sidebar is collapsed, and stops for good once the
    // API owner is missing, instead of polling a Host that no longer answers the integration API.
    const poll = createInventoryPoll({
      refresh: refetchJjRepositories,
      intervalMs: INVENTORY_REFRESH_INTERVAL_MS,
      isHidden: () => document.hidden,
      schedule: (callback: () => void, delayMs: number) => window.setTimeout(callback, delayMs),
      cancel: (handle: number) => window.clearTimeout(handle),
    })
    const onVisibilityChange = (): void => poll.visibilityChanged()
    document.addEventListener('visibilitychange', onVisibilityChange)
    poll.start()
    poll.setAvailable(!jjOwnerMissing && jjInventoryVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      poll.stop()
    }
  }, [jjInventoryVisible, jjOwnerMissing, refetchJjRepositories])
  const [childrenOpenOverrides, setChildrenOpenOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const [expandedParents, setExpandedParents] = useState<ReadonlySet<string>>(() => new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [viewsManagerOpen, setViewsManagerOpen] = useState(false)
  const [threadToScrollTo, setThreadToScrollTo] = useState<string | null>(null)
  const threadViewSettings = preferences.threadViews
  const threadView = ThreadViewPreferencesModel.activeThreadView(threadViewSettings)
  const [now, setNow] = useState(() => Date.now())
  const settingsId = useId()
  const [noticeQueueState, dispatchNoticeQueue] = useReducer(sidebarNoticeQueueReducer, INITIAL_SIDEBAR_NOTICE_QUEUE_STATE)
  const notice = noticeQueueState.current
  const setNotice = useCallback((notice: SidebarNotice | null): void => dispatchNoticeQueue({ type: 'set', notice }), [dispatchNoticeQueue])
  const updateNotice = useCallback(
    (update: (current: SidebarNotice | null) => SidebarNotice | null): void => dispatchNoticeQueue({ type: 'update', update }),
    [dispatchNoticeQueue],
  )
  const resumeRecoverySession = async (sessionId: SessionSummary['id']): Promise<boolean> => {
    if (resumeBusySessionIds.has(sessionId)) return false
    setResumeBusySessionIds(current => new Set(current).add(sessionId))
    try {
      const result = await resumeMutation.mutateAsync({ sessionId })
      if (!result.accepted) throw new Error('The recovery request is no longer pending.')
      await queryClient.invalidateQueries({ queryKey: restartRecoveryQueryKey })
      setNotice({ tone: 'success', message: props.tSidebar('threadSidebarResumeSent', { count: 1 }) })
      return true
    } catch {
      setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarActionFailure') })
      return false
    } finally {
      setResumeBusySessionIds(current => {
        const next = new Set(current)
        next.delete(sessionId)
        return next
      })
    }
  }
  const dismissRecoverySession = async (sessionId: SessionSummary['id']): Promise<void> => {
    try {
      await dismissMutation.mutateAsync({ sessionId })
      await queryClient.invalidateQueries({ queryKey: restartRecoveryQueryKey })
    } catch {
      setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarActionFailure') })
    }
  }
  useEffect(() => {
    if (notice === null) return
    return scheduleSuccessNoticeDismissal(notice, updateNotice)
  }, [notice, updateNotice])
  const [routeRequest, setRouteRequest] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : (readThreadUrl(window.location.href)?.sessionId ?? null),
  )
  const settleInFlight = useRef(false)
  const previousStatus = useRef<Readonly<Record<string, ThreadInteractionStatus>> | null>(null)
  const openedRouteId = useRef<string | null>(null)
  const suppressUrlForSession = useRef<string | null>(null)
  const migrationStarted = useRef(false)
  const attentionRefreshed = useRef(false)
  const previousAttention = useRef<ReadonlyMap<string, ThreadAttentionView> | null>(null)
  const previousSelectedId = useRef<string | null>(null)
  const latestAutoSettle = useRef<{
    sessions: SessionSummary[]
    workspaceBySession: Map<string, string>
    preferences: SidebarPreferences
    dueRebasedSessionIds: readonly string[]
    archived: ReadonlySet<string>
    pinned: ReadonlySet<string>
    settled: ReadonlySet<string>
    settle: (sessionIds: readonly string[]) => void
  } | null>(null)

  const sessions = useMemo(() => sessionsForAutoArchive(sessionState.ids, sessionState.byId), [sessionState.byId, sessionState.ids])
  const workspaceBySession = useMemo(
    () => SidebarOrganization.workspaceForSessions({ workspaces: workspaceState.items, sessions }),
    [sessions, workspaceState.items],
  )
  const archivedSessionIds = useMemo(() => setIncludes(workspaceState.archivedSessionIds), [workspaceState.archivedSessionIds])
  const pinnedSessionIds = useMemo(() => setIncludes(workspaceState.pinnedSessionIds), [workspaceState.pinnedSessionIds])
  const settledSessionIds = useMemo(() => setIncludes(preferences.settledSessionIds), [preferences.settledSessionIds])
  const displayWorkspaces = useMemo(
    () =>
      SidebarOrganization.projectWorkspaces(workspaceState.items).map(workspace => ({
        id: workspace.workspaceId,
        title: workspace.title.length > 0 ? workspace.title : props.tSidebar('threadSidebarDefaultProject'),
      })),
    [props.tSidebar, workspaceState.items],
  )
  /** Titles by workspace id, so a row does not rescan every workspace on each render. */
  const workspaceTitleById = useMemo(() => new Map<string, string>(displayWorkspaces.map(workspace => [workspace.id, workspace.title])), [displayWorkspaces])
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
        settledSessionIds,
        now,
        delayMs: threadDelayMs(preferences.rebasedThreadSettleDelay),
      }),
    [archivedSessionIds, jjRepositories.data, now, pinnedSessionIds, preferences.rebasedThreadSettleDelay, sessionStatus, sessions, settledSessionIds],
  )
  const settledSessionStates = useMemo(
    () =>
      new Map<string, SettledSessionState>(
        sessions.map(session => {
          const status = sessionStatus.get(session.id)
          return [
            session.id,
            {
              running: session.running,
              pendingInteraction: status === undefined ? undefined : status.pendingInteraction !== undefined,
              updatedAt: session.updatedAt,
            },
          ]
        }),
      ),
    [sessionStatus, sessions],
  )
  const settledStatus = useMemo(
    () => ({ settledSessionIds: preferences.settledSessionIds, settledAt: preferences.settledAt }),
    [preferences.settledAt, preferences.settledSessionIds],
  )
  const dueSettledArchiveSessionIds = useMemo(
    () =>
      SettledThreadsModel.dueArchiveSessionIds({
        status: settledStatus,
        sessions: settledSessionStates,
        archivedSessionIds,
        pinnedSessionIds,
        now,
        delayMs: threadDelayMs(preferences.settledArchiveDelay),
      }),
    [archivedSessionIds, now, pinnedSessionIds, preferences.settledArchiveDelay, settledSessionStates, settledStatus],
  )
  const settledArchiveEnabled = preferences.settledArchiveDelay !== 'disabled'
  /** The first instant a settled thread becomes due, so the shared `now` clock wakes for it. */
  const nextSettledArchiveAt = useMemo(() => {
    if (!settledArchiveEnabled) return null
    const delayMs = threadDelayMs(preferences.settledArchiveDelay)
    let next: number | null = null
    for (const sessionId of preferences.settledSessionIds) {
      const settledAt = preferences.settledAt[sessionId]
      if (settledAt === undefined) continue
      const archiveAt = settledAt + delayMs
      if (archiveAt <= now || (next !== null && next <= archiveAt)) continue
      next = archiveAt
    }
    return next
  }, [now, preferences.settledArchiveDelay, preferences.settledAt, preferences.settledSessionIds, settledArchiveEnabled])
  const archiveScan = useRef<readonly SessionSummary['id'][]>([])
  archiveScan.current = dueSettledArchiveSessionIds.map(SessionId)
  const archiveClient = useMemo<AutoArchiveClient>(
    () => ({
      archiveSession: sessionId => props.archiveSession(sessionId),
      getCandidateSessionIds: () => archiveScan.current,
    }),
    [props.archiveSession],
  )
  const { requestScan, refreshCandidates } = useAutoArchive({
    client: archiveClient,
    enabled: settledArchiveEnabled,
    intervalMs: preferences.scanIntervalMinutes * 60_000,
    onSettled: () => refreshCandidates('all'),
  })
  const dueArchiveSessionIdsKey = dueSettledArchiveSessionIds.join(',')
  useEffect(() => {
    if (!settledArchiveEnabled || dueArchiveSessionIdsKey === '') return
    requestScan('all')
  }, [dueArchiveSessionIdsKey, requestScan, settledArchiveEnabled])
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
    refetchInterval: questionCandidates.length > 0 ? 10_000 : false,
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
  const attentionSessions = useMemo(
    () => sessions.filter(session => SidebarOrganization.isAttentionSessionIncluded(session, preferences.includeSubagentAttention)),
    [preferences.includeSubagentAttention, sessions],
  )
  const recoveryRowOptions = useMemo(
    () => ({
      sessions,
      sessionIds: recoverySessionIds,
      reasonFor: recoveryReasonFor,
      mutedSessionIds,
      archivedSessionIds,
      settledSessionIds,
      matchesWorkspace: (session: SessionSummary) =>
        preferences.workspaceFilter === null ||
        (SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession) ?? '') === preferences.workspaceFilter,
      matchesSource: (session: SessionSummary) => ThreadViewModel.matchesSourceFilter(session, threadView.sourceFilter),
    }),
    [
      archivedSessionIds,
      settledSessionIds,
      mutedSessionIds,
      preferences.workspaceFilter,
      recoveryReasonFor,
      recoverySessionIds,
      sessionState.byId,
      sessions,
      threadView.sourceFilter,
      workspaceBySession,
    ],
  )
  const needsResumeRows = useMemo(() => selectRecoveryRows({ ...recoveryRowOptions, reason: 'restart' }), [recoveryRowOptions])
  const interruptedRows = useMemo(() => selectRecoveryRows({ ...recoveryRowOptions, reason: 'interrupted' }), [recoveryRowOptions])
  const usageLimitRows = useMemo(
    () =>
      UsageLimitRowsModel.select({
        sessions,
        continuations: usageLimitQuery.data?.continuations ?? EMPTY_CONTINUATIONS,
        mutedSessionIds,
        archivedSessionIds,
        settledSessionIds,
        matchesWorkspace: session =>
          preferences.workspaceFilter === null ||
          (SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession) ?? '') === preferences.workspaceFilter,
        matchesSource: session => ThreadViewModel.matchesSourceFilter(session, threadView.sourceFilter),
      }),
    [
      archivedSessionIds,
      settledSessionIds,
      mutedSessionIds,
      preferences.workspaceFilter,
      sessionState.byId,
      sessions,
      threadView.sourceFilter,
      usageLimitQuery.data?.continuations,
      workspaceBySession,
    ],
  )
  const usageLimitSessionIds = useMemo(() => new Set(usageLimitRows.map(row => row.session.id)), [usageLimitRows])
  const resumeUsageLimitThread = async (input: { readonly continuationId: string; readonly sessionId: string }): Promise<boolean> => {
    if (usageLimitBusyIds.has(input.continuationId)) return false
    setUsageLimitBusyIds(current => new Set(current).add(input.continuationId))
    try {
      const result = await accountsApi.resumeQuotaContinuation({ continuationId: input.continuationId })
      if (!result.accepted) {
        setNotice({ tone: 'warning', message: props.tSidebar('threadSidebarUsageLimitSuperseded') })
        await queryClient.invalidateQueries({ queryKey: usageLimitQueryKey })
        return false
      }
      setNotice({ tone: 'success', message: props.tSidebar('threadSidebarResumeSent', { count: 1 }) })
      await queryClient.invalidateQueries({ queryKey: usageLimitQueryKey })
      return true
    } catch {
      setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarActionFailure') })
      return false
    } finally {
      setUsageLimitBusyIds(current => {
        const next = new Set(current)
        next.delete(input.continuationId)
        return next
      })
    }
  }
  const changeUsageLimitRecovery = async (input: {
    readonly continuationId: string
    readonly duration?: UsageLimitSnooze
    readonly sessionId?: string
    readonly enabled?: boolean
  }): Promise<void> => {
    setUsageLimitBusyIds(current => new Set(current).add(input.continuationId))
    try {
      if (input.duration !== undefined) await accountsApi.snoozeQuotaContinuation({ continuationId: input.continuationId, duration: input.duration })
      if (input.enabled !== undefined && input.sessionId !== undefined) {
        await accountsApi.setQuotaContinuationAutoRetry({
          continuationId: input.continuationId,
          sessionId: input.sessionId,
          enabled: input.enabled,
        })
      }
      await queryClient.invalidateQueries({ queryKey: usageLimitQueryKey })
    } catch {
      setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarActionFailure') })
    } finally {
      setUsageLimitBusyIds(current => {
        const next = new Set(current)
        next.delete(input.continuationId)
        return next
      })
    }
  }
  const resumeAllUsageLimits = async (): Promise<void> => {
    if (usageLimitResumeAllBusy) return
    const pending = usageLimitRows.filter(row => !usageLimitBusyIds.has(row.continuation.continuationId))
    if (pending.length === 0) return
    setUsageLimitResumeAllBusy(true)
    setUsageLimitBusyIds(current => new Set([...current, ...pending.map(row => row.continuation.continuationId)]))
    let nextIndex = 0
    let sent = 0
    let failed = 0
    const worker = async (): Promise<void> => {
      while (nextIndex < pending.length) {
        const row = pending[nextIndex]
        nextIndex += 1
        if (row === undefined) continue
        try {
          const result = await accountsApi.resumeQuotaContinuation({ continuationId: row.continuation.continuationId })
          if (result.accepted) sent += 1
          else failed += 1
        } catch {
          failed += 1
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker))
      await queryClient.invalidateQueries({ queryKey: usageLimitQueryKey })
      setNotice(
        failed === 0
          ? { tone: 'success', message: props.tSidebar('threadSidebarResumeSent', { count: sent }) }
          : { tone: 'warning', message: props.tSidebar('threadSidebarResumePartial', { sent, failed }) },
      )
    } finally {
      setUsageLimitBusyIds(current => {
        const next = new Set(current)
        for (const row of pending) next.delete(row.continuation.continuationId)
        return next
      })
      setUsageLimitResumeAllBusy(false)
    }
  }
  const resumeAllRecoveries = async (rows: readonly SessionSummary[]): Promise<void> => {
    if (resumeAllBusy) return
    const sessionIds = rows.filter(session => !resumeBusySessionIds.has(session.id)).map(session => session.id)
    if (sessionIds.length === 0) return
    setResumeAllBusy(true)
    setResumeBusySessionIds(current => new Set([...current, ...sessionIds]))
    let nextIndex = 0
    let sent = 0
    let failed = 0
    const worker = async (): Promise<void> => {
      while (nextIndex < sessionIds.length) {
        const sessionId = sessionIds[nextIndex]
        nextIndex += 1
        if (sessionId === undefined) continue
        try {
          const result = await resumeMutation.mutateAsync({ sessionId })
          if (result.accepted) sent += 1
          else failed += 1
        } catch {
          failed += 1
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(3, sessionIds.length) }, worker))
      await queryClient.invalidateQueries({ queryKey: restartRecoveryQueryKey })
      setNotice(
        failed === 0
          ? { tone: 'success', message: props.tSidebar('threadSidebarResumeSent', { count: sent }) }
          : { tone: 'warning', message: props.tSidebar('threadSidebarResumePartial', { sent, failed }) },
      )
    } finally {
      setResumeBusySessionIds(current => {
        const next = new Set(current)
        for (const sessionId of sessionIds) next.delete(sessionId)
        return next
      })
      setResumeAllBusy(false)
    }
  }
  const unreadSessionIds = useStableValue(
    useMemo(
      () =>
        new Set(
          sessions.filter(session => !mutedSessionIds.has(session.id) && attention.records.get(session.id)?.manuallyUnread === true).map(session => session.id),
        ),
      [attention.records, mutedSessionIds, sessions],
    ),
    StableValueModel.sameSet,
  )
  /** Only an unacknowledged completion carries a timestamp; a hand mark alone is not a finished turn. */
  const finishedAtBySession = useMemo(() => {
    const completionAt: Record<string, number> = {}
    for (const record of attention.records.values()) if (record.finishedAt !== null) completionAt[record.sessionId] = record.finishedAt
    return completionAt
  }, [attention.records])
  // Sessions that stop running hold a fresh attention record on the Host; refresh then rather than on a timer alone.
  const runningSignature = useMemo(
    () =>
      sessions
        .filter(session => session.running)
        .map(session => session.id)
        .sort()
        .join(','),
    [sessions],
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
  const refreshAttention = attention.refresh
  useEffect(() => {
    if (!attentionRefreshed.current) {
      attentionRefreshed.current = true
      return
    }
    refreshAttention()
  }, [refreshAttention, runningSignature])
  useEffect(() => {
    const refresh = (): void => refreshAttention()
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisibility)
    // Another browser can acknowledge a thread at any time; this keeps this tab's list honest.
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh()
    }, 15_000)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisibility)
      window.clearInterval(timer)
    }
  }, [refreshAttention])
  const selectedAttention = selectedSessionId === undefined ? undefined : attention.records.get(selectedSessionId)
  const acknowledgeAttention = attention.acknowledge
  const acknowledgeManualUnread = attention.clearUnread
  useEffect(() => {
    if (selectedSessionId === undefined) {
      previousSelectedId.current = null
      return
    }
    const justSelected = previousSelectedId.current !== selectedSessionId
    previousSelectedId.current = selectedSessionId
    if (selectedAttention === undefined) return
    // Watching a thread finish acknowledges that turn; it never clears a mark the user made on purpose just now.
    if (selectedAttention.finishedAt !== null) acknowledgeAttention(selectedSessionId, selectedAttention.version)
    else if (justSelected) acknowledgeManualUnread(selectedSessionId, selectedAttention.version)
  }, [acknowledgeAttention, acknowledgeManualUnread, selectedAttention, selectedSessionId])
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
  }, [props.open, props.tSidebar, routeRequest, sessions, sessionState.phase, setNotice])

  useEffect(() => {
    if (selectedSession === undefined || routeRequest !== null) return
    if (suppressUrlForSession.current === selectedSession.id) return
    suppressUrlForSession.current = null
    const workspaceId = SidebarOrganization.workspaceForLineage(selectedSession, sessionState.byId, workspaceBySession)
    const next = buildThreadUrl(window.location.href, selectedSession.id, workspaceId)
    if (next !== window.location.href) window.history.replaceState(window.history.state, '', next)
  }, [routeRequest, selectedSession, sessionState.byId, workspaceBySession])

  const changePreferences = (patch: Partial<SidebarPreferences>): void => {
    updatePreferences(patch)
  }

  // Saved views moved from browser storage to Host settings: hand the browser copy over once, then drop it.
  const viewsMigrationStarted = useRef(false)
  useEffect(() => {
    if (!hostBacked || viewsMigrationStarted.current) return
    viewsMigrationStarted.current = true
    const legacy = threadViewPreferences.get()
    threadViewPreferences.remove()
    if (JSON.stringify(legacy) === JSON.stringify(DEFAULT_THREAD_VIEW_SETTINGS)) return
    if (JSON.stringify(preferences.threadViews) !== JSON.stringify(DEFAULT_THREAD_VIEW_SETTINGS)) return
    changePreferences({ threadViews: legacy })
  }, [changePreferences, hostBacked, preferences.threadViews])

  // Group collapse moved from browser storage to Host settings: hand the browser copy over once, then drop it.
  const groupsMigrationStarted = useRef(false)
  useEffect(() => {
    if (!hostBacked || groupsMigrationStarted.current) return
    groupsMigrationStarted.current = true
    const legacy = storedCollapsedGroups.get()
    storedCollapsedGroups.remove()
    if (legacy.length === 0 || preferences.collapsedGroups.length > 0) return
    changePreferences({ collapsedGroups: [...legacy] })
  }, [changePreferences, hostBacked, preferences.collapsedGroups])

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
                <span
                  className={cn('dshx:size-2 dshx:shrink-0 dshx:rounded-full', ThreadAttentionPresentationModel.attentionColorDotClass(color))}
                  aria-hidden="true"
                />
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
                    <span
                      className={cn('dshx:size-2 dshx:shrink-0 dshx:rounded-full', ThreadAttentionPresentationModel.attentionColorDotClass(option))}
                      aria-hidden="true"
                    />
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

  const tSidebar = props.tSidebar

  const selectThread = (sessionId: SessionSummary['id']): void => {
    const opened = attention.records.get(sessionId)
    if (opened !== undefined) attention.clearUnread(sessionId, opened.version)
    setRouteRequest(null)
    openedRouteId.current = sessionId
    suppressUrlForSession.current = null
    const session = sessionState.byId[sessionId]
    const workspaceId = session === undefined ? undefined : SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession)
    window.history.replaceState(window.history.state, '', buildThreadUrl(window.location.href, sessionId, workspaceId))
    props.open(sessionId)
  }

  /**
   * Select the thread in the main view. An archived thread is restored first: DSH drops an archived
   * Session from the main view on every list change, so opening one without restoring it fails as a
   * released Session reference — restoring is the one click that replaces that retry fight.
   */
  const openThread = (sessionId: SessionSummary['id']): void => {
    if (archivedSessionIds.has(sessionId)) {
      void props.unarchiveSession(sessionId).then(
        () => selectThread(sessionId),
        () => setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarActionFailure') }),
      )
      return
    }
    selectThread(sessionId)
  }

  const copyContextValue = async (value: string, successMessage: string): Promise<void> => {
    setNotice(
      (await writeClipboard(value))
        ? { tone: 'success', message: successMessage }
        : { tone: 'danger', message: props.tSidebar('threadSidebarClipboardFailure') },
    )
  }

  const notifyThread = (category: ThreadNotificationCategory, eventId: string, sessionId: SessionSummary['id'], title: string, fallbackBody: string): void => {
    const categoryPreferences = preferences.notificationCategories[category]
    if (!ThreadNotificationModel.threadNotificationHasOutput(categoryPreferences) || isMuteActive(mutedThreads[sessionId], Date.now())) return
    const session = sessionState.byId[sessionId]
    if (session === undefined || !SidebarOrganization.isAttentionSessionIncluded(session, preferences.includeSubagentAttention)) return
    const inApp = ThreadNotificationModel.notificationRouteHasInApp(categoryPreferences.delivery)
    const systemRequested = ThreadNotificationModel.notificationRouteHasSystem(categoryPreferences.delivery)
    const system = systemRequested && 'Notification' in window && window.Notification.permission === 'granted'
    if (!inApp && !system && !categoryPreferences.sound) return
    if (!ThreadNotificationModel.claimThreadNotification(eventId)) return
    if (inApp) {
      dispatchNoticeQueue({
        type: 'enqueue-notification',
        notice: {
          tone: notificationNoticeTones[category],
          message: `${title}: ${session.displayTitle ?? fallbackBody}`,
          durationMs: 5_000,
          actionLabel: props.tSidebar('threadSidebarNotificationOpenThread'),
          onAction: () => openThread(sessionId),
        },
      })
    }
    if (system) {
      try {
        const notification = new window.Notification(title, { body: fallbackBody })
        notification.onclick = () => {
          window.focus()
          openThread(sessionId)
          notification.close()
        }
      } catch {
        setNotice({ tone: 'warning', message: props.tSidebar('threadSidebarNotificationsUnavailable') })
      }
    }
    if (categoryPreferences.sound) ThreadNotificationAudioModel.play(categoryPreferences.soundPreset, categoryPreferences.volume)
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

  /** One Settings write per scan rather than one per thread; the status is ours, not a Host verb. */
  const settleSessions = (sessionIds: readonly string[]): void => {
    if (sessionIds.length === 0) return
    const status = { settledSessionIds: preferences.settledSessionIds, settledAt: preferences.settledAt }
    changePreferences(SettledThreadsModel.settle(status, sessionIds, Date.now()))
  }

  const toggleSettled = (sessionId: SessionSummary['id']): void => {
    const shouldSettle = !settledSessionIds.has(sessionId)
    if (shouldSettle && SidebarOrganization.hasRunningDescendant({ sessionId, sessions })) {
      setNotice({ tone: 'warning', message: props.tSidebar('threadSidebarRunningNotice') })
      return
    }
    const targets = threadActionTargetIds({
      threadId: sessionId,
      threads: Object.values(sessionState.byId).filter(session => !session.blank),
      cascadeToChildren: preferences.applyActionsToChildThreads,
    })
    const status = { settledSessionIds: preferences.settledSessionIds, settledAt: preferences.settledAt }
    changePreferences(shouldSettle ? SettledThreadsModel.settle(status, targets, Date.now()) : SettledThreadsModel.unsettle(status, targets))
    setNotice(shouldSettle ? { tone: 'success', message: props.tSidebar('threadSidebarSettledNotice') } : null)
  }

  const collapsedGroups = preferences.collapsedGroups
  const toggleGroup = (key: string): void => {
    changePreferences({ collapsedGroups: toggleCollapsedGroup(collapsedGroups, key) })
  }

  const toggleSection = (section: SidebarSection): void => {
    changePreferences({
      collapsedSections: SidebarPreferencesModel.toggleCollapsedSection(preferences.collapsedSections, section),
    })
  }

  // Archiving outranks settled: an archived thread keeps no settled status, so restoring it comes back usable
  // instead of waiting for the archive delay that already fired. Covers every archive path, the Agent's included.
  useEffect(() => {
    const archivedStillSettled = preferences.settledSessionIds.filter(sessionId => archivedSessionIds.has(sessionId))
    if (archivedStillSettled.length === 0) return
    const status = { settledSessionIds: preferences.settledSessionIds, settledAt: preferences.settledAt }
    changePreferences(SettledThreadsModel.unsettle(status, archivedStillSettled))
  }, [archivedSessionIds, changePreferences, preferences.settledAt, preferences.settledSessionIds])

  /** Both delay settings carry the same five choices, so one control renders each of them. */
  const threadDelayControl = (input: {
    readonly labelKey: ThreadSidebarLabelKey
    readonly hintKey: ThreadSidebarLabelKey
    readonly value: ThreadDelay
    readonly onChange: (delay: ThreadDelay) => void
  }): JSX.Element => (
    <div className="dshx:grid dshx:min-w-0 dshx:gap-1" role="group" aria-label={props.tSidebar(input.labelKey)}>
      <span className="dshx:text-xs">{props.tSidebar(input.labelKey)}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size="sm" variant="outline" className="dshx:min-w-0 dshx:justify-start">
            {props.tSidebar(threadDelayLabelKeys[input.value])}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup
            value={input.value}
            onValueChange={value => {
              const delay = threadDelayFromValue(value)
              if (delay !== undefined) input.onChange(delay)
            }}
          >
            {THREAD_DELAYS.map(delay => (
              <DropdownMenuRadioItem key={delay} value={delay}>
                {props.tSidebar(threadDelayLabelKeys[delay])}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <p className="dshx:text-xs dshx:text-muted-foreground">{props.tSidebar(input.hintKey)}</p>
    </div>
  )

  const runAutoSettle = async (): Promise<void> => {
    const latest = latestAutoSettle.current
    if (settleInFlight.current || latest === null || !SidebarOrganization.shouldScanForAutoSettle(latest.preferences)) return
    settleInFlight.current = true
    try {
      const now = Date.now()
      const due = latest.sessions.filter(
        session =>
          SidebarOrganization.isAutoSettleCandidate({
            session,
            workspaceId: latest.workspaceBySession.get(session.id),
            now,
            preferences: latest.preferences,
            archivedSessionIds: latest.archived,
            pinnedSessionIds: latest.pinned,
            settledSessionIds: latest.settled,
          }) && !SidebarOrganization.hasRunningDescendant({ sessionId: session.id, sessions: latest.sessions }),
      )
      if (due.length > 0) latest.settle(due.map(session => session.id))
    } finally {
      settleInFlight.current = false
    }
  }

  const runRebasedAutoSettle = useCallback(async (): Promise<void> => {
    const latest = latestAutoSettle.current
    if (settleInFlight.current || latest === null || latest.dueRebasedSessionIds.length === 0) return
    settleInFlight.current = true
    try {
      const due = latest.dueRebasedSessionIds.filter(
        sessionId => !latest.settled.has(sessionId) && !SidebarOrganization.hasRunningDescendant({ sessionId, sessions: latest.sessions }),
      )
      if (due.length > 0) latest.settle(due)
    } finally {
      settleInFlight.current = false
    }
  }, [])

  latestAutoSettle.current = {
    sessions,
    workspaceBySession,
    preferences,
    dueRebasedSessionIds: rebasedIndex.dueSessionIds,
    archived: archivedSessionIds,
    pinned: pinnedSessionIds,
    settled: settledSessionIds,
    settle: settleSessions,
  }

  useEffect(() => {
    if (!SidebarOrganization.shouldScanForAutoSettle(preferences)) return
    if (sessionState.phase !== 'ready' || workspaceState.phase !== 'ready') return
    void runAutoSettle()
    const timer = window.setInterval(() => void runAutoSettle(), preferences.scanIntervalMinutes * 60_000)
    return () => window.clearInterval(timer)
  }, [
    preferences.autoSettleEnabled,
    preferences.autoSettleDisabledSessionIds,
    preferences.autoSettleSessionIds,
    preferences.scanIntervalMinutes,
    sessionState.phase,
    workspaceState.phase,
  ])

  useEffect(() => {
    if (preferences.rebasedThreadSettleDelay === 'disabled' || jjRepositories.data === undefined) return
    if (sessionState.phase !== 'ready' || workspaceState.phase !== 'ready') return
    void runRebasedAutoSettle()
    const timer = window.setInterval(() => void runRebasedAutoSettle(), preferences.scanIntervalMinutes * 60_000)
    return () => window.clearInterval(timer)
  }, [
    jjRepositories.data,
    preferences.rebasedThreadSettleDelay,
    preferences.scanIntervalMinutes,
    runRebasedAutoSettle,
    sessionState.phase,
    workspaceState.phase,
  ])

  const threadTree = useMemo(() => {
    const listed: SessionSummary[] = []
    for (const sessionId of sessionState.ids) {
      const session = sessionState.byId[sessionId]
      if (session === undefined || session.blank || ThreadViewModel.isSideChat(session)) continue
      const workspaceId = SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession)
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
        workspaceId: SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession),
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
          workspaceId: SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession),
          activity: { id: session.id, updatedAt: effectiveActivityAt(mutedThreads, session, now), running: session.running },
        })),
      ),
    [mutedThreads, now, sessionState.byId, threadTree, workspaceBySession],
  )
  const detachedThreadEntries = useMemo(
    () =>
      Array.from(threadTree.detachedByMissingAncestor.values()).flatMap(children =>
        children.map(session => ({
          session,
          workspaceId: SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession),
          activity: { id: session.id, updatedAt: effectiveActivityAt(mutedThreads, session, now), running: session.running },
        })),
      ),
    [mutedThreads, now, sessionState.byId, threadTree, workspaceBySession],
  )
  const sourceFilteredThreadEntries = useMemo(() => {
    if (threadView.sourceFilter === 'subagents') {
      return [...childThreadEntries, ...sectionEntries.filter(entry => ThreadViewModel.matchesSourceFilter(entry.session, 'subagents'))]
    }
    if (threadView.sourceFilter === 'main') return sectionEntries.filter(entry => ThreadViewModel.matchesSourceFilter(entry.session, 'main'))
    return sectionEntries
  }, [childThreadEntries, sectionEntries, threadView.sourceFilter])
  const sourceFilteredThreadIds = useMemo(() => new Set(sourceFilteredThreadEntries.map(entry => entry.session.id)), [sourceFilteredThreadEntries])
  const currentWorkingThreadIds = useMemo(() => workingThreadIds(sectionEntries.map(entry => entry.activity)), [sectionEntries])
  const workingThreadCountsBySource = useMemo(
    () => ({
      all: sectionEntries.filter(entry => entry.activity.running).length + detachedThreadEntries.filter(entry => entry.activity.running).length,
      main: sectionEntries.filter(entry => entry.activity.running && ThreadViewModel.matchesSourceFilter(entry.session, 'main')).length,
      subagents: [
        ...childThreadEntries,
        ...detachedThreadEntries,
        ...sectionEntries.filter(entry => ThreadViewModel.matchesSourceFilter(entry.session, 'subagents')),
      ].filter(entry => entry.activity.running).length,
    }),
    [childThreadEntries, detachedThreadEntries, sectionEntries],
  )
  const nextMuteWake = useMemo(() => nextMuteExpiry(mutedThreads, now), [mutedThreads, now])
  const nextIdleAt = useMemo(
    () =>
      SidebarOrganization.nextIdleTransitionAt(
        sectionEntries.map(entry => entry.activity),
        now,
        preferences.idleMinutes,
      ),
    [now, preferences.idleMinutes, sectionEntries],
  )

  useEffect(() => {
    const nextBoundary = [nextIdleAt, nextMuteWake, nextSettledArchiveAt]
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right)[0]
    if (nextBoundary === undefined) return
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, nextBoundary - Date.now() + 1))
    return () => window.clearTimeout(timer)
  }, [nextIdleAt, nextMuteWake, nextSettledArchiveAt])

  // A snooze that ran out wakes the thread at once (through `now`); dropping its entry keeps the settings small.
  const mutesAwake = useMemo(() => withoutExpiredMutes(mutedThreads, now), [mutedThreads, now])
  useEffect(() => {
    if (Object.keys(mutesAwake).length !== Object.keys(mutedThreads).length) updatePreferences({ mutedThreads: mutesAwake })
  }, [mutedThreads, mutesAwake, updatePreferences])

  // The Host owns attention now: hand it whatever this browser still holds, then drop the browser copy.
  useEffect(() => {
    if (migrationStarted.current || !attention.available || sessionState.phase !== 'ready') return
    migrationStarted.current = true
    const legacy = legacyNotificationPreferences.get()
    if (legacy === null) return
    const migrated = legacyMutesToMigrate({
      legacy: legacy.mutedUntil,
      hostMutes: mutedThreads,
      updatedAt: sessionId => sessions.find(session => session.id === sessionId)?.updatedAt,
      now: Date.now(),
    })
    if (Object.keys(migrated).length > 0) updatePreferences({ mutedThreads: { ...mutedThreads, ...migrated } })
    if (legacy.enabled || preferences.desktopNotificationsEnabled) {
      updatePreferences({
        notificationCategories: ThreadNotificationModel.notificationCategoriesAreDefault(preferences.notificationCategories)
          ? ThreadNotificationModel.categoriesForLegacyDesktopNotifications()
          : preferences.notificationCategories,
        desktopNotificationsEnabled: false,
      })
    }
    const entries = ThreadNotificationModel.legacyAttentionEntries(legacy)
    // Keep the browser copy until the Host stored it, so a failed write is retried on the next load.
    if (entries.length === 0) legacyNotificationPreferences.remove()
    else
      void attention.migrate(entries).then(
        () => legacyNotificationPreferences.remove(),
        () => undefined,
      )
  }, [attention, mutedThreads, preferences.desktopNotificationsEnabled, preferences.notificationCategories, sessionState.phase, sessions, updatePreferences])

  const needsInputRows = useMemo(
    () =>
      selectInputNeededRows({
        sessions: attentionSessions,
        pendingInteractionKindFor: sessionId =>
          sessionStatus.get(sessionId)?.pendingInteraction?.kind ?? (continuedQuestionSessionIds.has(sessionId) ? 'question' : undefined),
        mutedSessionIds,
        archivedSessionIds,
        settledSessionIds,
        matchesWorkspace: session =>
          preferences.workspaceFilter === null ||
          (SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession) ?? '') === preferences.workspaceFilter,
      }),
    [
      archivedSessionIds,
      settledSessionIds,
      attentionSessions,
      continuedQuestionSessionIds,
      mutedSessionIds,
      preferences.workspaceFilter,
      sessionState.byId,
      sessionStatus,
      workspaceBySession,
    ],
  )
  const needsInputIds = useStableValue(
    useMemo(() => new Set(needsInputRows.map(session => session.id)), [needsInputRows]),
    StableValueModel.sameSet,
  )
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
            !settledSessionIds.has(session.id) &&
            (preferences.workspaceFilter === null ||
              (SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession) ?? '') === preferences.workspaceFilter)
          )
        })
        .sort((left, right) => right.updatedAt - left.updatedAt),
    [
      archivedSessionIds,
      settledSessionIds,
      attentionSessions,
      mutedSessionIds,
      preferences.workspaceFilter,
      selectedSession?.id,
      sessionState.byId,
      sessionStatus,
      workspaceBySession,
    ],
  )
  const approvalNeededIds = useStableValue(
    useMemo(() => new Set(approvalNeededRows.map(session => session.id)), [approvalNeededRows]),
    StableValueModel.sameSet,
  )
  const turnFinishedRows = useMemo(
    () =>
      selectTurnFinishedRows({
        sessions: attentionSessions,
        selectedSessionId: selectedSession?.id,
        inputNeededSessionIds: needsInputIds,
        approvalNeededSessionIds: approvalNeededIds,
        completionAt: finishedAtBySession,
        mutedSessionIds,
        archivedSessionIds,
        settledSessionIds,
        excludedSessionIds: usageLimitSessionIds,
        matchesWorkspace: session =>
          preferences.workspaceFilter === null ||
          (SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession) ?? '') === preferences.workspaceFilter,
      }),
    [
      approvalNeededIds,
      archivedSessionIds,
      settledSessionIds,
      attentionSessions,
      finishedAtBySession,
      mutedSessionIds,
      needsInputIds,
      preferences.workspaceFilter,
      selectedSession?.id,
      sessionState.byId,
      usageLimitSessionIds,
      workspaceBySession,
    ],
  )
  const waitingSessionIds = useStableValue(
    useMemo(() => new Set([...approvalNeededRows, ...needsInputRows].map(session => session.id)), [approvalNeededRows, needsInputRows]),
    StableValueModel.sameSet,
  )
  const attentionSessionIds = useStableValue(
    useMemo(
      () =>
        new Set([
          ...approvalNeededRows,
          ...needsInputRows,
          ...turnFinishedRows,
          ...needsResumeRows,
          ...interruptedRows,
          ...usageLimitRows.map(row => row.session.id),
        ]),
      [approvalNeededRows, interruptedRows, needsInputRows, needsResumeRows, turnFinishedRows, usageLimitRows],
    ),
    StableValueModel.sameSet,
  )
  const attentionRootIds = useStableValue(
    useMemo(() => {
      const ids = new Set(attentionSessionIds)
      for (const { session } of sectionEntries) {
        if ((threadTree.childrenByRoot.get(session.id) ?? NO_CHILDREN).some(child => attentionSessionIds.has(child.id))) ids.add(session.id)
      }
      return ids
    }, [attentionSessionIds, sectionEntries, threadTree]),
    StableValueModel.sameSet,
  )
  const visibleThreadEntries = useMemo(
    () =>
      sourceFilteredThreadEntries.filter(entry =>
        ThreadViewModel.matchesStatusFilter({
          filters: threadView.statusFilters,
          running: threadView.sourceFilter === 'subagents' ? entry.activity.running : currentWorkingThreadIds.has(entry.session.id),
          needsAttention: threadView.sourceFilter === 'subagents' ? attentionSessionIds.has(entry.session.id) : attentionRootIds.has(entry.session.id),
          archived: archivedSessionIds.has(entry.session.id),
          settled: settledSessionIds.has(entry.session.id),
          muted: mutedSessionIds.has(entry.session.id),
        }),
      ),
    [
      archivedSessionIds,
      settledSessionIds,
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
          ThreadViewModel.matchesStatusFilter({
            filters: threadView.statusFilters,
            running: threadView.sourceFilter === 'subagents' ? session.running : currentWorkingThreadIds.has(session.id),
            needsAttention: true,
            archived: archivedSessionIds.has(session.id),
            settled: settledSessionIds.has(session.id),
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
    settledSessionIds,
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
  const statusFilteredNeedsResumeRows = useMemo(
    () =>
      needsResumeRows.filter(session =>
        ThreadViewModel.matchesStatusFilter({
          filters: threadView.statusFilters,
          running: threadView.sourceFilter === 'subagents' ? session.running : currentWorkingThreadIds.has(session.id),
          needsAttention: true,
          archived: archivedSessionIds.has(session.id),
          settled: settledSessionIds.has(session.id),
          muted: mutedSessionIds.has(session.id),
        }),
      ),
    [archivedSessionIds, settledSessionIds, currentWorkingThreadIds, mutedSessionIds, needsResumeRows, threadView.sourceFilter, threadView.statusFilters],
  )
  const statusFilteredInterruptedRows = useMemo(
    () =>
      interruptedRows.filter(session =>
        ThreadViewModel.matchesStatusFilter({
          filters: threadView.statusFilters,
          running: threadView.sourceFilter === 'subagents' ? session.running : currentWorkingThreadIds.has(session.id),
          needsAttention: true,
          archived: archivedSessionIds.has(session.id),
          settled: settledSessionIds.has(session.id),
          muted: mutedSessionIds.has(session.id),
        }),
      ),
    [archivedSessionIds, settledSessionIds, currentWorkingThreadIds, interruptedRows, mutedSessionIds, threadView.sourceFilter, threadView.statusFilters],
  )
  const statusFilteredUsageLimitRows = useMemo(
    () =>
      usageLimitRows.filter(row =>
        ThreadViewModel.matchesStatusFilter({
          filters: threadView.statusFilters,
          running: threadView.sourceFilter === 'subagents' ? row.session.running : currentWorkingThreadIds.has(row.session.id),
          needsAttention: true,
          archived: archivedSessionIds.has(row.session.id),
          settled: settledSessionIds.has(row.session.id),
          muted: mutedSessionIds.has(row.session.id),
        }),
      ),
    [archivedSessionIds, settledSessionIds, currentWorkingThreadIds, mutedSessionIds, threadView.sourceFilter, threadView.statusFilters, usageLimitRows],
  )
  const statusFilteredRecoveryRows = useMemo(
    () => [...statusFilteredInterruptedRows, ...statusFilteredNeedsResumeRows, ...statusFilteredUsageLimitRows.map(row => row.session)],
    [statusFilteredInterruptedRows, statusFilteredNeedsResumeRows, statusFilteredUsageLimitRows],
  )
  const attentionIds = useStableValue(
    useMemo(
      () =>
        new Set(
          [
            ...groupedAttentionRows.approvalNeeded,
            ...groupedAttentionRows.inputNeeded,
            ...groupedAttentionRows.turnFinished,
            ...statusFilteredRecoveryRows,
          ].map(session => session.id),
        ),
      [groupedAttentionRows, statusFilteredRecoveryRows],
    ),
    StableValueModel.sameSet,
  )
  const inlineAttentionLabels = useStableValue(
    useMemo(() => {
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
    ]),
    StableValueModel.sameMap,
  )

  /**
   * Branches whose parent session is gone from the corpus. They keep the same
   * status and attention filtering as a listed parent's children, so a view
   * filter never resurrects a row the rest of the list hides.
   */
  const detachedThreadGroups = useMemo(() => {
    if (threadView.sourceFilter === 'main') return []
    return [...threadTree.detachedByMissingAncestor.entries()]
      .map(([missingAncestorId, children]) => {
        const listed = children.filter(
          child =>
            !(threadView.groupBy === 'status' && attentionIds.has(child.id)) &&
            ThreadViewModel.matchesStatusFilter({
              filters: threadView.statusFilters,
              running: child.running,
              needsAttention: attentionSessionIds.has(child.id),
              archived: archivedSessionIds.has(child.id),
              settled: settledSessionIds.has(child.id),
              muted: mutedSessionIds.has(child.id),
            }),
        )
        const selectedChildId = listed.some(child => child.id === selectedSession?.id) ? selectedSession?.id : undefined
        const { live, finished } = partitionFinishedChildren({
          children: listed,
          mode: preferences.finishedSubagents,
          isFinished: child => child.origin === 'subagent' && !child.running && !waitingSessionIds.has(child.id),
          selectedId: selectedChildId,
        })
        return { missingAncestorId, live, finished, selectedChildId, count: live.length + finished.length }
      })
      .filter(group => group.count > 0)
  }, [
    archivedSessionIds,
    attentionIds,
    attentionSessionIds,
    mutedSessionIds,
    settledSessionIds,
    preferences.finishedSubagents,
    selectedSession?.id,
    threadTree,
    threadView.groupBy,
    threadView.sourceFilter,
    threadView.statusFilters,
    waitingSessionIds,
  ])

  const rowsBySection = useMemo(() => {
    const rows = new Map<SidebarSection, SessionSummary[]>(sections.map(section => [section, []]))
    const activityAt = new Map(visibleThreadEntries.map(entry => [entry.session.id, entry.activity.updatedAt]))
    for (const { session, activity } of visibleThreadEntries) {
      if (threadView.groupBy === 'status' && attentionIds.has(session.id)) continue
      const section = SidebarOrganization.sectionForSession({
        session: activity,
        archivedSessionIds,
        pinnedSessionIds,
        parkedSessionIds,
        settledSessionIds,
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
    return ThreadViewModel.groupEntries({
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

  const rowActionButtons = useMemo(
    () => SidebarOrganization.orderRowActions(preferences.rowActionOrder).filter(action => !preferences.hiddenRowActions.includes(action)),
    [preferences.hiddenRowActions, preferences.rowActionOrder],
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
    changePreferences({ threadViews: ThreadViewPreferencesModel.updateThreadViewPreferences(threadViewSettings, patch) })
  }
  // The Settings write is asynchronous; a failure surfaces through the shared storage warning.
  const saveThreadViewSettings = (settings: ThreadViewSettings): boolean => {
    changePreferences({ threadViews: ThreadViewPreferencesModel.updateThreadViewSettings(settings) })
    return true
  }
  const updateThreadViewControls = (patch: Partial<Pick<ThreadViewSettings, 'showGroupControl' | 'showFilterControl'>>): void => {
    saveThreadViewSettings({ ...threadViewSettings, ...patch })
  }
  const selectThreadViewPreset = (viewId: string): void => {
    if (viewId === threadViewSettings.activeViewId) return
    saveThreadViewSettings(ThreadViewPreferencesModel.selectThreadView(threadViewSettings, viewId))
  }
  const selectThreadGroupBy = (value: string): void => {
    const decoded = ThreadViewPreferencesModel.decodeThreadViewPreferences({
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
    const decoded = ThreadViewPreferencesModel.decodeThreadViewPreferences({
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

  const asideOpener = useAsideOpen()
  const latestRowActions = useRef({
    openThread,
    openAside: asideOpener,
    mutateSession,
    toggleParked,
    toggleSettled,
    settleSessions,
    copyContextValue,
    resumeRecoverySession,
    dismissRecoverySession,
    markAttentionUnread: attention.markUnread,
    notifyThread,
    props,
    sessionsById: sessionState.byId,
    preferences,
    changePreferences,
  })
  latestRowActions.current = {
    openThread,
    openAside: asideOpener,
    mutateSession,
    toggleParked,
    toggleSettled,
    settleSessions,
    copyContextValue,
    resumeRecoverySession,
    dismissRecoverySession,
    markAttentionUnread: attention.markUnread,
    notifyThread,
    props,
    sessionsById: sessionState.byId,
    preferences,
    changePreferences,
  }
  useEffect(() => {
    PaletteApi.setRecentLimit(preferences.paletteRecentLimit)
  }, [preferences.paletteRecentLimit])
  useEffect(() => () => PaletteApi.setRecentLimit(10), [])
  useEffect(() => {
    const actions: readonly PaletteAction[] = [
      ...(asideOpener === null
        ? []
        : [
            {
              id: '@dshfiles/thread-sidebar/thread/open-aside',
              label: () => latestRowActions.current.props.tSidebar('threadSidebarOpenInSidePanel'),
              aliases: ['open in side panel', 'side panel', 'aside'],
              icon: <PanelRightOpenIcon className="dshx:size-4" />,
              group: 'action',
              isAvailable: context => context.thread !== null && !context.thread.archived,
              run: context => {
                const thread = context.thread
                if (thread === null) return
                const session = Object.values(latestRowActions.current.sessionsById).find(candidate => candidate.id === thread.id)
                if (session !== undefined) latestRowActions.current.openAside?.(session.id)
              },
            } satisfies PaletteAction,
          ]),
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
    const disposers = actions.map(action => PaletteApi.registerAction(action))
    return () => disposers.forEach(dispose => dispose())
  }, [])
  // One stable object for every row; it reads the latest closures so memoized rows never go stale.
  const rowActions = useMemo<RowActions>(() => {
    return {
      open: sessionId => latestRowActions.current.openThread(sessionId),
      mutate: (sessionId, operation) => latestRowActions.current.mutateSession(sessionId, operation),
      toggleParked: sessionId => latestRowActions.current.toggleParked(sessionId),
      toggleSettled: sessionId => latestRowActions.current.toggleSettled(sessionId),
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
        latestRowActions.current.markAttentionUnread(sessionId)
      },
      resume: sessionId => void latestRowActions.current.resumeRecoverySession(sessionId),
      dismissRecovery: sessionId => void latestRowActions.current.dismissRecoverySession(sessionId),
      setAutoSettleOverride: (sessionId, override) => {
        const current = latestRowActions.current
        const next = SidebarOrganization.setAutoSettleOverride(current.preferences, sessionId, override)
        current.changePreferences({
          autoSettleSessionIds: next.autoSettleSessionIds,
          autoSettleDisabledSessionIds: next.autoSettleDisabledSessionIds,
        })
      },
      translate: (...args) => latestRowActions.current.props.tSidebar(...args),
    }
  }, [])

  // Kept for this component's lifetime: the per-parent child rows must outlive a render to stay identical.
  const childRowCacheRef = useRef<ThreadChildRowCache | null>(null)
  childRowCacheRef.current ??= createThreadChildRowCache()
  const childRowCache = childRowCacheRef.current

  const renderThreadRow = (session: SessionSummary, attentionLabel: ThreadRowProps['attentionLabel']): JSX.Element => {
    const lineage = SidebarOrganization.sessionLineage(session, sessionState.byId)
    const workspaceId = SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession)
    // Derived once per parent change: an untouched parent keeps the arrays its row already holds, so memo holds.
    const childRow = childRowCache.resolve({
      children: threadTree.childrenByRoot.get(session.id) ?? NO_CHILDREN,
      groupedAttentionIds: attentionIds,
      listChildren: threadView.sourceFilter !== 'main',
      groupByStatus: threadView.groupBy === 'status',
      mode: preferences.finishedSubagents,
      waitingSessionIds,
      selectedSessionId: selectedSession?.id,
    })
    const rowAttentionLabel = attentionLabel ?? inlineAttentionLabels.get(session.id)
    return (
      <ThreadRow
        key={session.id}
        session={session}
        unread={unreadSessionIds.has(session.id)}
        autoSettleOverride={SidebarOrganization.autoSettleOverrideForSession(preferences, session.id)}
        unreadSessionIds={unreadSessionIds}
        archived={archivedSessionIds.has(session.id)}
        pinned={pinnedSessionIds.has(session.id)}
        parked={parkedSessionIds.has(session.id)}
        settled={settledSessionIds.has(session.id)}
        selected={selectedSession?.id === session.id}
        parentTitle={lineage.parentTitle}
        workspaceId={workspaceId}
        workspaceTitle={workspaceId === undefined ? undefined : workspaceTitleById.get(workspaceId)}
        machine={machine}
        age={formatAge(session.updatedAt)}
        mute={mutedSessionIds.has(session.id) ? mutedThreads[session.id] : undefined}
        attentionLabel={rowAttentionLabel}
        rebasedAt={rebasedIndex.rebasedAtBySessionId.get(session.id)}
        needsResume={recoverySessionIds.has(session.id)}
        resumeBusy={resumeBusySessionIds.has(session.id)}
        childAttentionLabels={inlineAttentionLabels}
        rowStyle={rowStyle}
        rowActions={rowActionButtons}
        childThreads={childRow.live}
        finishedChildThreads={childRow.finished}
        childrenOpen={shouldOpenChildThreadList({ children: childRow.listed, override: childrenOpenOverrides.get(session.id) })}
        allChildrenShown={expandedParents.has(session.id)}
        selectedChildId={childRow.selectedChildId}
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
        status: { pendingInteractionKey: status?.pendingInteraction?.key, pendingInteractionKind: status?.pendingInteraction?.kind },
      }
    })
    const currentStatus: Readonly<Record<string, ThreadInteractionStatus>> = Object.fromEntries(
      currentStatusEntries.map((entry): [string, ThreadInteractionStatus] => [entry.sessionId, entry.status]),
    )
    const transitions = ThreadNotificationModel.threadInteractionTransitions(previousStatus.current, currentStatusEntries)
    previousStatus.current = currentStatus
    for (const sessionId of transitions.approvalNeeded) {
      if (selectedSession?.id === sessionId) continue
      const interactionKey = sessionStatus.get(sessionId)?.pendingInteraction?.key
      if (interactionKey === undefined) continue
      latestRowActions.current.notifyThread(
        'approval-needed',
        `approval:${sessionId}:${interactionKey}`,
        sessionId,
        tSidebar('threadSidebarApprovalNotificationTitle'),
        tSidebar('threadSidebarApprovalNotificationBody'),
      )
    }
    for (const sessionId of transitions.inputNeeded) {
      if (selectedSession?.id === sessionId) continue
      const interactionKey = sessionStatus.get(sessionId)?.pendingInteraction?.key
      if (interactionKey === undefined) continue
      latestRowActions.current.notifyThread(
        'input-needed',
        `input:${sessionId}:${interactionKey}`,
        sessionId,
        tSidebar('threadSidebarInputNotificationTitle'),
        tSidebar('threadSidebarInputNotificationBody'),
      )
    }
  }, [tSidebar, selectedSession?.id, sessionStatus, sessionState.phase, sessions])

  // Host attention records carry the latest finish reason and sequence, so an acknowledged row can still be deduped by event id.
  useEffect(() => {
    const previous = previousAttention.current
    previousAttention.current = attention.records
    if (previous === null) return
    for (const [sessionId, record] of attention.records) {
      if (record.finishedAt === null || record.finishedSeq === null || selectedSession?.id === sessionId) continue
      if (previous.get(sessionId)?.finishedSeq === record.finishedSeq || record.finishedReason === null) continue
      const session = sessions.find(candidate => candidate.id === sessionId)
      if (session === undefined || sessionStatus.get(session.id)?.pendingInteraction !== undefined) continue
      const category = ThreadNotificationModel.categoryForFinishReason(record.finishedReason)
      const messageKeys = finishNotificationMessageKeys[category]
      latestRowActions.current.notifyThread(
        category,
        `finish:${sessionId}:${record.finishedSeq}`,
        session.id,
        tSidebar(messageKeys.title),
        tSidebar(messageKeys.body),
      )
    }
  }, [attention.records, selectedSession?.id, sessionStatus, sessions, tSidebar])

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
            className="dshx:mx-2 dshx:mb-2 dshx:grid dshx:min-h-0 dshx:shrink dshx:gap-3 dshx:overflow-y-auto dshx:overscroll-contain dshx:rounded-lg dshx:border dshx:bg-card dshx:p-3"
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
              <Checkbox checked={preferences.autoSettleEnabled} onCheckedChange={checked => changePreferences({ autoSettleEnabled: checked === true })} />
              {props.tSidebar('threadSidebarAutoArchive')}
            </Label>
            {threadDelayControl({
              labelKey: 'threadSidebarArchiveRebased',
              hintKey: 'threadSidebarArchiveRebasedHint',
              value: preferences.rebasedThreadSettleDelay,
              onChange: delay => changePreferences({ rebasedThreadSettleDelay: delay }),
            })}
            {threadDelayControl({
              labelKey: 'threadSidebarArchiveSettled',
              hintKey: 'threadSidebarArchiveSettledHint',
              value: preferences.settledArchiveDelay,
              onChange: delay => changePreferences({ settledArchiveDelay: delay }),
            })}
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
                onChange={event => changePreferences({ excludedSessionIds: SidebarOrganization.parseSessionIds(event.currentTarget.value) })}
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
        {(notice !== null && !isTransientNotice) || storageWarning ? (
          <div className="dshx:grid dshx:gap-2 dshx:px-2 dshx:pb-2">
            {notice !== null && !isTransientNotice ? noticeAlert : null}
            {storageWarning ? (
              <Alert variant="warning" className={noticeClass}>
                <SidebarNoticeMessage message={props.tSidebar('threadSidebarStorageFailure')} />
              </Alert>
            ) : null}
          </div>
        ) : null}

        <div
          data-testid="thread-sidebar-scroll"
          className="dshx:min-h-0 dshx:flex-1 dshx:overflow-auto dshx:overscroll-y-contain dshx:px-2 dshx:pb-3"
          onKeyDown={event =>
            ThreadListNavigationModel.navigate({
              event: event.nativeEvent,
              list: event.currentTarget,
              open: sessionId => {
                const session = sessionState.byId[SessionId(sessionId)]
                if (session !== undefined) openThread(session.id)
              },
              onLookahead: sessionIds => {
                if (props.onNavigationLookahead === undefined) return
                const lookaheadSessions = sessionIds.flatMap(sessionId => {
                  const session = sessionState.byId[SessionId(sessionId)]
                  return session === undefined ? [] : [session.id]
                })
                props.onNavigationLookahead(lookaheadSessions)
              },
            })
          }
        >
          {sessionState.phase !== 'ready' || workspaceState.phase !== 'ready' ? (
            <div className="dshx:flex dshx:items-center dshx:justify-center dshx:gap-2 dshx:py-6 dshx:text-sm dshx:text-muted-foreground">
              <Spinner />
              {props.tSidebar('threadSidebarLoading')}
            </div>
          ) : null}
          {statusFilteredInterruptedRows.length > 0 ? (
            <section className="dshx:mt-1" aria-label={props.tSidebar('threadSidebarInterrupted')}>
              <div className={cn(stickyHeaderClass, 'dshx:flex dshx:h-8 dshx:items-center dshx:gap-2 dshx:px-2.5 dshx:text-sm')}>
                <span
                  className={cn(
                    'dshx:whitespace-nowrap dshx:font-medium',
                    ThreadAttentionPresentationModel.attentionLabelClass('threadSidebarInterrupted', preferences.attentionColors),
                  )}
                >
                  {props.tSidebar('threadSidebarInterrupted')}
                </span>
                <span className="dshx:text-xs dshx:tabular-nums">({statusFilteredInterruptedRows.length})</span>
                <span className="dshx:h-px dshx:flex-1 dshx:bg-border" aria-hidden="true" />
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={resumeAllBusy}
                  onClick={() => void resumeAllRecoveries(statusFilteredInterruptedRows)}
                >
                  {resumeAllBusy ? <Spinner className="dshx:size-3" /> : null}
                  {props.tSidebar('threadSidebarResumeAll')}
                </Button>
              </div>
              <p className="dshx:px-2.5 dshx:pb-1 dshx:text-xs dshx:text-muted-foreground">{props.tSidebar('threadSidebarInterruptedHint')}</p>
              {statusFilteredInterruptedRows.map(session => renderThreadRow(session, 'threadSidebarInterrupted'))}
            </section>
          ) : null}
          {statusFilteredNeedsResumeRows.length > 0 ? (
            <section className="dshx:mt-1" aria-label={props.tSidebar('threadSidebarNeedsResume')}>
              <div className={cn(stickyHeaderClass, 'dshx:flex dshx:h-8 dshx:items-center dshx:gap-2 dshx:px-2.5 dshx:text-sm')}>
                <span
                  className={cn(
                    'dshx:whitespace-nowrap dshx:font-medium',
                    ThreadAttentionPresentationModel.attentionLabelClass('threadSidebarNeedsResume', preferences.attentionColors),
                  )}
                >
                  {props.tSidebar('threadSidebarNeedsResume')}
                </span>
                <span className="dshx:text-xs dshx:tabular-nums">({statusFilteredNeedsResumeRows.length})</span>
                <span className="dshx:h-px dshx:flex-1 dshx:bg-border" aria-hidden="true" />
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  disabled={resumeAllBusy}
                  onClick={() => void resumeAllRecoveries(statusFilteredNeedsResumeRows)}
                >
                  {resumeAllBusy ? <Spinner className="dshx:size-3" /> : null}
                  {props.tSidebar('threadSidebarResumeAll')}
                </Button>
              </div>
              {statusFilteredNeedsResumeRows.map(session => renderThreadRow(session, 'threadSidebarNeedsResume'))}
            </section>
          ) : null}
          <UsageLimitSection
            busyIds={usageLimitBusyIds}
            now={now}
            onAutoRetry={input => void changeUsageLimitRecovery(input)}
            onResume={input => void resumeUsageLimitThread(input)}
            onResumeAll={() => void resumeAllUsageLimits()}
            onSnooze={input => void changeUsageLimitRecovery(input)}
            open={openThread}
            selectedSessionId={selectedSessionId}
            resumeAllBusy={usageLimitResumeAllBusy}
            rows={statusFilteredUsageLimitRows}
            translate={props.tSidebar}
            withThreadMenu={(session, row) => (
              <ThreadContextMenu
                key={session.id}
                session={session}
                unread={unreadSessionIds.has(session.id)}
                autoSettleOverride={SidebarOrganization.autoSettleOverrideForSession(preferences, session.id)}
                mute={mutedSessionIds.has(session.id) ? mutedThreads[session.id] : undefined}
                archived={archivedSessionIds.has(session.id)}
                pinned={pinnedSessionIds.has(session.id)}
                parked={parkedSessionIds.has(session.id)}
                settled={settledSessionIds.has(session.id)}
                workspaceId={SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession)}
                actions={rowActions}
              >
                {row}
              </ThreadContextMenu>
            )}
          />
          {groupedAttentionRows.approvalNeeded.length > 0 ? (
            <section className="dshx:mt-1" aria-label={props.tSidebar('threadSidebarApprovalNeeded')}>
              <div className={cn(stickyHeaderClass, 'dshx:flex dshx:h-8 dshx:items-center dshx:gap-2 dshx:px-2.5 dshx:text-sm')}>
                <span
                  className={cn(
                    'dshx:whitespace-nowrap dshx:font-medium',
                    ThreadAttentionPresentationModel.attentionLabelClass('threadSidebarApprovalNeeded', preferences.attentionColors),
                  )}
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
                <span
                  className={cn(
                    'dshx:whitespace-nowrap dshx:font-medium',
                    ThreadAttentionPresentationModel.attentionLabelClass('threadSidebarInputNeeded', preferences.attentionColors),
                  )}
                >
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
                <span
                  className={cn(
                    'dshx:whitespace-nowrap dshx:font-medium',
                    ThreadAttentionPresentationModel.attentionLabelClass('threadSidebarTurnFinished', preferences.attentionColors),
                  )}
                >
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
            : groupedThreadEntries.map(group => {
                const groupCollapsed = group.showHeader && collapsedGroups.includes(group.key)
                return (
                  <section className="dshx:mt-1" key={group.key} aria-label={group.showHeader ? group.label : undefined}>
                    {group.showHeader ? (
                      <button
                        type="button"
                        className={cn(
                          stickyHeaderClass,
                          'dshx:flex dshx:h-8 dshx:w-full dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2.5 dshx:text-sm dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50',
                        )}
                        aria-expanded={!groupCollapsed}
                        onClick={() => toggleGroup(group.key)}
                      >
                        <span className="dshx:whitespace-nowrap">{group.label}</span>
                        <span className="dshx:text-xs dshx:tabular-nums">({group.threads.length})</span>
                        <span className="dshx:h-px dshx:flex-1 dshx:bg-border" aria-hidden="true" />
                        <span className="dshx:inline-flex dshx:shrink-0" aria-hidden="true">
                          {groupCollapsed ? <IconChevronDownOutlineRegular size={12} /> : <IconChevronUpOutlineRegular size={12} />}
                        </span>
                      </button>
                    ) : null}
                    {groupCollapsed ? null : group.threads.map(session => renderThreadRow(session, undefined))}
                  </section>
                )
              })}
          {detachedThreadGroups.map(group => (
            <section
              className="dshx:mt-1"
              key={`detached:${group.missingAncestorId}`}
              aria-label={`${props.tSidebar('threadSidebarMissingParent')} ${group.missingAncestorId}`}
            >
              <div
                className={cn(
                  stickyHeaderClass,
                  'dshx:flex dshx:h-8 dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:px-2.5 dshx:text-sm dshx:text-muted-foreground',
                )}
              >
                <span className="dshx:shrink-0 dshx:whitespace-nowrap">{props.tSidebar('threadSidebarMissingParent')}</span>
                <span className="dshx:min-w-0 dshx:truncate dshx:text-xs" title={group.missingAncestorId}>
                  {shortSessionId(group.missingAncestorId)}
                </span>
                <span className="dshx:text-xs dshx:tabular-nums">({group.count})</span>
                <span className="dshx:h-px dshx:flex-1 dshx:bg-border" aria-hidden="true" />
              </div>
              <ChildThreadList
                parentId={group.missingAncestorId}
                childThreads={group.live}
                finishedChildThreads={group.finished}
                unreadSessionIds={unreadSessionIds}
                allShown={expandedParents.has(group.missingAncestorId)}
                selectedChildId={group.selectedChildId}
                attentionLabels={inlineAttentionLabels}
                rowStyle={rowStyle}
                actions={rowActions}
              />
            </section>
          ))}
          {props.openRemoteThreads === undefined ? null : <RemoteThreadsSection headerClassName={stickyHeaderClass} onOpen={props.openRemoteThreads} />}
          {sessionState.phase === 'ready' &&
          detachedThreadGroups.length === 0 &&
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
