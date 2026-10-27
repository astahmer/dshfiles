import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceBrowserProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { jjIntegrationApi } from '@dshfiles/jj-integration/api'
import { workbenchPanels } from '@dshfiles/workbench/registry'
import { DetachedThreadsModel, type DetachedGroupAction } from './detached-threads.js'
import { DraftThreadsModel } from './draft-threads.js'
import type { SessionDraft, SessionDrafts } from '@dshfiles/session-controller/draft-client'
import { isListedUnsentThread, presentUnsentThread } from './unsent-threads.js'
import { HostSnapshotsModel } from './snapshots.js'
import { DEFAULT_THREAD_BOARD_VIEW, storedThreadBoardView, ThreadBoardViewModel } from './thread-board-view.js'
import { storedCollapsedGroups, toggleCollapsedGroup } from './collapsed-groups.js'
import { useNearViewport } from './use-near-viewport.js'
import { threadSurfaceOf, type ThreadSidebarSurface } from './thread-surface.js'
import { ThreadGroupHeader } from './thread-group-header.js'
import { formatAge } from './relative-age.js'
import { RemoteThreadItem, RemoteThreadsSection } from './remote-threads-section.js'
import { useRemoteSidebarThreads, type RemoteSidebarThread } from './remote-thread-inventory.js'
import { StableValueModel, useStableValue } from './stable-value.js'
import { createThreadChildRowCache, type ThreadChildRowCache } from './thread-child-rows.js'
import { useApi, useApiQuery } from '@dshfiles/dshx/client'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { startInteraction } from '@dshfiles/dshx/tracing/client'
import { createInventoryPoll } from './inventory-poll.js'
import { aiAccountsApi } from '@dshfiles/ai-accounts/api'
import { activeQuestionSessionIds } from './pending-questions.js'
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
  writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { useMutation, useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { Alert } from '@dshfiles/plugin-ui/components/ui/alert'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Combobox, type ComboboxOption } from '@dshfiles/plugin-ui/components/ui/combobox'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from '@dshfiles/plugin-ui/components/ui/context-menu'
import { InlineTitleEditor } from '@dshfiles/plugin-ui/components/ui/inline-title-editor'
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
  GripVerticalIcon,
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
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from 'react'
import { z } from 'zod'
import {
  SidebarOrganization,
  SIDEBAR_SECTIONS,
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
import type { PaletteAction } from '@dshfiles/command-palette/palette-contract'
import { PaletteBridge } from './palette-bridge.js'
import { useSidebarState } from './sidebar-state.js'
import { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'
import { ThreadReferencesItems } from './thread-references-menu.js'
import { ContinueInProjectItems } from './continue-in-menu.js'
import { projectTextTone } from './project-tone.js'
import { workspaceName, workspaceNameLabel } from './workspace-paths.js'
import {
  failedResumeNotice,
  INITIAL_SIDEBAR_NOTICE_QUEUE_STATE,
  scheduleSuccessNoticeDismissal,
  SidebarNotificationDismissButton,
  SidebarNoticeMessage,
  sidebarNoticeQueueReducer,
  type SidebarNotice,
} from './sidebar-notice.js'
import { threadSidebarMachineApi } from './machine-api.js'
import { threadSidebarRecoveryApi } from './recovery-api.js'
import { restartRecoveryRefetchInterval } from './restart-recovery-poll.js'
import { selectRecoveryRows } from './restart-recovery-rows.js'
import type { RecoveryReason } from './restart-recovery.js'
import { UsageLimitRowsModel, type QuotaContinuation, type UsageLimitRow } from './usage-limit-rows.js'
import { usageLimitRefetchInterval } from './usage-limit-poll.js'
import { UsageLimitSection, type UsageLimitSnooze } from './usage-limit-section.js'
import { groupThreadChildren, partitionFinishedChildren, shouldOpenChildThreadList, threadActionTargetIds, visibleChildren } from './thread-children.js'
import { buildThreadUrl, clearThreadUrl, readThreadUrl } from './thread-url.js'
import { ThreadListNavigationModel } from './thread-list-navigation.js'
import {
  EMPTY_THREAD_SELECTION,
  THREAD_MAIN_BUTTON_SELECTOR,
  isThreadSelectionBackgroundClick,
  ThreadSelectionModel,
  type ThreadSelectionState,
} from './thread-selection.js'
import { workingThreadIds } from './working-threads.js'
import { indexRebasedThreadSessions } from './rebased-threads.js'
import { indexQueuedIntegrationSessions } from './queued-integrations.js'
import { SettledThreadsModel, type SettledSessionState } from './settled-threads.js'
import { answerSettleRequests } from './settle-request.js'
import { THREAD_DELAYS, threadDelayMs, type ThreadDelay } from './thread-delays.js'
import { useAutoArchive, type AutoArchiveClient } from './auto-archive-machine.js'
import { useAutoSettle, type AutoSettleClient } from './auto-settle-machine.js'
import {
  THREAD_GROUP_BY_OPTIONS,
  THREAD_SOURCE_FILTER_OPTIONS,
  THREAD_STATUS_FILTER_GROUPS,
  THREAD_STATUS_FILTER_OPTIONS,
  ThreadViewModel,
  type ThreadGroupBy,
  type ThreadSourceFilter,
  type ThreadViewPreferences,
} from './thread-view.js'
import {
  doneViewFilterMigration,
  shippedViewFiltersMigration,
  ThreadViewPreferencesModel,
  threadViewPreferences,
  type ThreadViewSettings,
} from './thread-view-preferences.js'
import {
  ThreadViewManager,
  threadStatusFilterGroupLabelKeys,
  threadStatusFilterLabelKeys,
  threadViewPresetCompactLabel,
  threadViewPresetLabel,
} from './thread-view-manager.js'
import { useCompactViewTabs } from './thread-view-tabs.js'
import { captureThreadMentionInsertion, requestThreadMentionInsertion, ThreadMentionDrag } from './thread-mention.js'
import {
  ThreadNotificationModel,
  legacyNotificationPreferences,
  storedNotificationsMuted,
  type ThreadInteractionStatus,
  type ThreadNotificationCategory,
  type ThreadFinishNotificationCategory,
  type ThreadNotificationPlacement,
} from './thread-notifications.js'
import { ThreadNotificationAudioModel } from './thread-notification-audio.js'
import { createNotificationSoundPaletteAction, createNotificationSnoozePaletteAction } from './notification-sound-palette-action.js'
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

const sessionActivityAt = (options: {
  readonly session: Pick<SessionSummary, 'id' | 'updatedAt'>
  readonly mutedThreads: Readonly<Record<string, ThreadMute>>
  readonly finishedAt: number | undefined
  readonly now: number
}): number =>
  effectiveActivityAt(
    options.mutedThreads,
    {
      id: options.session.id,
      updatedAt: ThreadViewModel.latestActivityAt(options.session.updatedAt, options.finishedAt),
    },
    options.now,
  )

type InjectedActions = {
  archiveSession: (sessionId: SessionSummary['id']) => Promise<void>
  unarchiveSession: (sessionId: SessionSummary['id']) => Promise<void>
  pinSession: (sessionId: SessionSummary['id']) => Promise<void>
  unpinSession: (sessionId: SessionSummary['id']) => Promise<void>
  renameSession: (sessionId: SessionSummary['id'], title: string) => Promise<void>
  /** Show the remote thread view; set when the layout service is available. */
  openRemoteThreads?: () => void
  openRemoteSession?: (sessionId: string) => void
  /** Open the thread a page-load link names without closing a panel the user opened while the list was loading. */
  openLinkedSession?: (sessionId: SessionSummary['id']) => void
  startFollowUp: (sessionId: SessionSummary['id'], workspaceId: string | undefined) => void
  startProjectSession: (projectId: string) => void
  drafts?: SessionDrafts['list'] | undefined
  /** Fork the thread into another project and settle it; resolves to the continuing thread and whether it settled. */
  continueInProject: (
    sessionId: SessionSummary['id'],
    projectId: string,
  ) => Promise<{ readonly continuedSessionId: SessionSummary['id']; readonly settled: boolean }>
}

/** The slot runtime's global selector hooks, the one part of the props a `main` panel mount supplies itself. */
export type ThreadSidebarStandardProps = Pick<WorkspaceBrowserProps, 'useSessions' | 'useSessionStatus' | 'useWorkspaces'>

type ThreadSidebarProps = ThreadSidebarStandardProps &
  Pick<WorkspaceBrowserProps, 'open'> &
  InjectedActions & {
    tSidebar: TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>
    onNavigationLookahead?: (sessionIds: readonly SessionSummary['id'][]) => void
    /** The sidebar shell hides the thread region with CSS when it is collapsed; absent means a mount with no shell. */
    wide?: boolean
    /** Absent means `sidebar`. The board page mounts beside it, so only the primary mount runs side effects. */
    surface?: ThreadSidebarSurface
  }

type ThreadSidebarTranslate = ThreadSidebarProps['tSidebar']
const emptyThreadsMessage = {
  all: 'threadSidebarEmpty',
  working: 'threadSidebarNoWorkingThreads',
  'not-running': 'threadSidebarNoNotRunningThreads',
  attention: 'threadSidebarNoAttentionThreads',
  unread: 'threadSidebarNoUnreadThreads',
  'approval-needed': 'threadSidebarNoApprovalNeededThreads',
  'input-needed': 'threadSidebarNoInputNeededThreads',
  'turn-finished': 'threadSidebarNoTurnFinishedThreads',
  'needs-resume': 'threadSidebarNoNeedsResumeThreads',
  interrupted: 'threadSidebarNoInterruptedThreads',
  inactive: 'threadSidebarNoWorkingThreads',
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

const notificationPlacementClasses = {
  'top-left': 'dshx:top-3 dshx:justify-start',
  'top-center': 'dshx:top-3 dshx:justify-center',
  'top-right': 'dshx:top-3 dshx:justify-end',
  'bottom-left': 'dshx:bottom-3 dshx:justify-start',
  'bottom-center': 'dshx:bottom-3 dshx:justify-center',
  'bottom-right': 'dshx:bottom-3 dshx:justify-end',
} satisfies Record<ThreadNotificationPlacement, string>

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
/** Pointer travel before a press on a section header becomes a reorder drag instead of a fold. */
const SECTION_DRAG_THRESHOLD_PX = 5
const UNASSIGNED_PROJECT = '__unassigned__'

const sectionLabels: Record<SidebarSection, Parameters<ThreadSidebarTranslate>[0]> = {
  pinned: 'threadSidebarPinned',
  active: 'threadSidebarActive',
  parked: 'threadSidebarParked',
  settled: 'threadSidebarSettled',
  inactive: 'threadSidebarInactive',
  archived: 'threadSidebarArchived',
}

const isSidebarSection = (value: string | undefined): value is SidebarSection => SIDEBAR_SECTIONS.some(section => section === value)

const THREAD_TAB_FOCUS_EVENT = 'dshfiles:main-tabs:focus-thread'
const PANEL_ASIDE_EVENT = 'dshfiles:move-panel-aside'
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
const QUOTA_CONTINUATION_UPDATED_EVENT = 'dshfiles:ai-accounts:quota-continuation-updated'
/** Stable empty list, so a loading query never hands the selector a fresh array. */
const EMPTY_CONTINUATIONS: readonly QuotaContinuation[] = []

const sessionsForAutoArchive = (ids: readonly SessionSummary['id'][], byId: Readonly<Record<string, SessionSummary>>): SessionSummary[] =>
  ids.flatMap(sessionId => {
    const session = byId[sessionId]
    return session === undefined ? [] : [session]
  })

const keepThreadTab = (sessionId: string): void => {
  window.dispatchEvent(new CustomEvent('dshfiles:main-tabs:keep-thread', { detail: { sessionId } }))
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

interface BatchSelectionSnapshot {
  readonly ids: readonly string[]
  readonly anyPinned: boolean
  readonly anyUnpinned: boolean
  readonly anyLive: boolean
  readonly anyArchived: boolean
  readonly anyParked: boolean
  readonly anyUnparked: boolean
  readonly anySettled: boolean
  readonly anyUnsettled: boolean
  readonly anyMuted: boolean
}

interface RowActions {
  readonly open: (sessionId: SessionSummary['id']) => void
  readonly selection: () => ThreadSelectionState
  readonly selectForContext: (sessionId: SessionSummary['id']) => void
  readonly clearSelection: () => void
  readonly batch: () => BatchSelectionSnapshot
  readonly batchMutate: (operation: RowOperation) => void
  readonly batchSetParked: (park: boolean) => void
  readonly batchSetSettled: (settle: boolean) => void
  readonly batchMute: (option: ThreadMuteOption) => void
  readonly batchUnmute: () => void
  readonly batchMarkUnread: () => void
  readonly batchCopyLinks: () => void
  readonly mutate: (sessionId: SessionSummary['id'], operation: RowOperation) => Promise<void>
  readonly toggleParked: (sessionId: SessionSummary['id']) => void
  readonly toggleSettled: (sessionId: SessionSummary['id']) => void
  readonly copy: (value: string, successMessage: string) => Promise<void>
  readonly toggleChildren: (sessionId: SessionSummary['id'], currentlyOpen: boolean) => void
  /** Any parent id, including a missing ancestor only its detached children name. */
  readonly toggleAllChildren: (parentId: string) => void
  readonly moveToSection: (sessionId: SessionSummary['id'], section: SidebarSection) => void
  readonly mute: (sessionId: SessionSummary['id'], option: ThreadMuteOption) => void
  readonly unmute: (sessionId: SessionSummary['id']) => void
  readonly markUnread: (sessionId: SessionSummary['id']) => void
  readonly followUp: (sessionId: SessionSummary['id'], workspaceId: string | undefined) => void
  readonly continueIn: (sessionId: SessionSummary['id'], projectId: string) => void
  readonly resume: (sessionId: SessionSummary['id']) => void
  readonly dismissRecovery: (sessionId: SessionSummary['id']) => void
  readonly beginRename: (sessionId: SessionSummary['id']) => void
  readonly rename: (sessionId: SessionSummary['id'], title: string) => void
  readonly cancelRename: () => void
  readonly setAutoSettleOverride: (sessionId: SessionSummary['id'], override: AutoSettleOverride) => void
  readonly translate: ThreadSidebarTranslate
}

interface RowStyle {
  readonly density: ThreadRowDensity
  readonly project: boolean
  readonly projectColor: boolean
  readonly projectPalette: SidebarPreferences['projectColorPalette']
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
  /** The status section this row renders in; undefined for the attention and draft rows no drop reaches. */
  readonly section?: SidebarSection | undefined
  /** Set only on the row whose drag is in flight, so it reads as picked up. */
  readonly dragging: boolean
  readonly parentTitle: string | undefined
  readonly workspaceId: string | undefined
  readonly workspaceTitle: string | undefined
  readonly workspaceName: string | undefined
  readonly machine: string | undefined
  readonly age: string
  /** Set only while the thread is muted or snoozed. */
  readonly mute: ThreadMute | undefined
  readonly attentionLabel: ThreadAttentionLabel | undefined
  readonly rebasedAt: number | undefined
  readonly integrationQueuedAt: number | undefined
  readonly needsResume: boolean
  readonly resumeBusy: boolean
  readonly renaming: boolean
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
          draggable
          className={cn(
            lineClass,
            'dshx:data-[selected=true]:bg-accent',
            'dshx:relative dshx:data-[multi-selected=true]:bg-info/15 dshx:data-[multi-selected=true]:ring-1 dshx:data-[multi-selected=true]:ring-inset dshx:data-[multi-selected=true]:ring-info/40',
          )}
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
  'session' | 'unread' | 'autoSettleOverride' | 'mute' | 'archived' | 'pinned' | 'parked' | 'settled' | 'section' | 'workspaceId' | 'actions'
> & { readonly children: JSX.Element }

/** One menu for the whole batch: every verb applies to each selected thread the verb can still change. */
const BatchThreadMenuItems = (props: {
  readonly snapshot: BatchSelectionSnapshot
  readonly actions: RowActions
  readonly t: ThreadSidebarTranslate
}): JSX.Element => {
  const snapshot = props.snapshot
  return (
    <>
      <ContextMenuLabel>{props.t('threadSidebarSelectedCount', { count: snapshot.ids.length })}</ContextMenuLabel>
      <ContextMenuSeparator />
      {snapshot.anyUnpinned ? <ContextMenuItem onSelect={() => props.actions.batchMutate('pin')}>{props.t('threadSidebarPin')}</ContextMenuItem> : null}
      {snapshot.anyPinned ? <ContextMenuItem onSelect={() => props.actions.batchMutate('unpin')}>{props.t('threadSidebarUnpin')}</ContextMenuItem> : null}
      {snapshot.anyUnparked ? <ContextMenuItem onSelect={() => props.actions.batchSetParked(true)}>{props.t('threadSidebarPark')}</ContextMenuItem> : null}
      {snapshot.anyParked ? <ContextMenuItem onSelect={() => props.actions.batchSetParked(false)}>{props.t('threadSidebarUnpark')}</ContextMenuItem> : null}
      {snapshot.anyUnsettled ? <ContextMenuItem onSelect={() => props.actions.batchSetSettled(true)}>{props.t('threadSidebarSettle')}</ContextMenuItem> : null}
      {snapshot.anySettled ? <ContextMenuItem onSelect={() => props.actions.batchSetSettled(false)}>{props.t('threadSidebarUnsettle')}</ContextMenuItem> : null}
      <ContextMenuItem onSelect={() => props.actions.batchMarkUnread()}>{props.t('threadSidebarMarkUnread')}</ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger>{props.t('threadSidebarMute')}</ContextMenuSubTrigger>
        <ContextMenuSubContent className="dshx-root dshx:min-w-44">
          {THREAD_MUTE_OPTIONS.map(option => (
            <ContextMenuItem key={option} onSelect={() => props.actions.batchMute(option)}>
              {props.t(muteOptionLabelKeys[option])}
            </ContextMenuItem>
          ))}
          <ContextMenuSeparator />
          <ContextMenuItem disabled={!snapshot.anyMuted} onSelect={() => props.actions.batchUnmute()}>
            {props.t('threadSidebarUnmute')}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem onSelect={() => props.actions.batchCopyLinks()}>{props.t('threadSidebarCopyLinks')}</ContextMenuItem>
      <ContextMenuSeparator />
      {snapshot.anyLive ? <ContextMenuItem onSelect={() => props.actions.batchMutate('archive')}>{props.t('threadSidebarArchive')}</ContextMenuItem> : null}
      {snapshot.anyArchived ? (
        <ContextMenuItem onSelect={() => props.actions.batchMutate('unarchive')}>{props.t('threadSidebarRestore')}</ContextMenuItem>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => props.actions.clearSelection()}>{props.t('threadSidebarClearSelection')}</ContextMenuItem>
    </>
  )
}

const openRegisteredPanelAside = (panelId: string): void => {
  const registry = workbenchPanels()
  if (registry.get(panelId) === undefined) return
  window.dispatchEvent(new CustomEvent(PANEL_ASIDE_EVENT, { detail: { panelId }, cancelable: true }))
  registry.open(panelId)
}

const ThreadMenuBody = (props: ThreadContextMenuProps): JSX.Element => {
  const { session, unread, archived, pinned, parked, settled } = props
  const t = props.actions.translate
  const openAside = useAsideOpen()
  const registry = workbenchPanels()
  useSyncExternalStore(registry.subscribe, registry.list, registry.list)
  const sidePanelDefinitions = registry.listContextMenuPanels()
  const selection = props.actions.selection()
  if (selection.sessionIds.length > 1 && selection.sessionIds.includes(session.id)) {
    return <BatchThreadMenuItems snapshot={props.actions.batch()} actions={props.actions} t={t} />
  }
  return (
    <>
      <ContextMenuItem onSelect={() => requestThreadMentionInsertion(session.id, ThreadMentionDrag.activeComposerSessionId())}>
        {t('threadSidebarInsertMention')}
      </ContextMenuItem>
      <ContextMenuItem disabled={props.workspaceId === undefined} onSelect={() => props.actions.followUp(session.id, props.workspaceId)}>
        {t('threadSidebarFollowUp')}
      </ContextMenuItem>
      {archived ? null : (
        <ContextMenuSub>
          <ContextMenuSubTrigger disabled={session.running}>{t('threadSidebarContinueIn')}</ContextMenuSubTrigger>
          <ContextMenuSubContent className="dshx-root dshx:min-w-48 dshx:max-w-72" aria-label={t('threadSidebarContinueIn')}>
            <ContinueInProjectItems t={t} continueIn={projectId => props.actions.continueIn(session.id, projectId)} Item={ContextMenuItem} />
          </ContextMenuSubContent>
        </ContextMenuSub>
      )}
      <ContextMenuItem onSelect={() => props.actions.beginRename(session.id)}>{t('threadSidebarRenameThread')}</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuSub>
        <ContextMenuSubTrigger>{t('threadSidebarCopy')}</ContextMenuSubTrigger>
        <ContextMenuSubContent className="dshx-root dshx:min-w-44">
          <ContextMenuItem onSelect={() => void props.actions.copy(session.id, t('threadSidebarIdCopied'))}>{t('threadSidebarCopyId')}</ContextMenuItem>
          <ContextMenuItem
            onSelect={() => void props.actions.copy(buildThreadUrl(window.location.href, session.id, props.workspaceId), t('threadSidebarLinkCopied'))}
          >
            {t('threadSidebarCopyLink')}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      {archived || openAside === null ? null : <ContextMenuItem onSelect={() => openAside(session.id)}>{t('threadSidebarOpenInSidePanel')}</ContextMenuItem>}
      {!archived && sidePanelDefinitions.length > 0 ? (
        <ContextMenuSub>
          <ContextMenuSubTrigger>{t('threadSidebarOpenPluginInSidePanel')}</ContextMenuSubTrigger>
          <ContextMenuSubContent className="dshx-root dshx:min-w-44">
            {sidePanelDefinitions.map(definition => (
              <ContextMenuItem key={definition.id} onSelect={() => openRegisteredPanelAside(definition.id)}>
                {definition.title}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>
      ) : null}
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
      <ContextMenuSub>
        <ContextMenuSubTrigger>{t('threadSidebarMoveToSection')}</ContextMenuSubTrigger>
        <ContextMenuSubContent className="dshx-root dshx:min-w-44" aria-label={t('threadSidebarMoveToSection')}>
          {SIDEBAR_SECTIONS.map(section => (
            <ContextMenuItem key={section} disabled={section === props.section} onSelect={() => props.actions.moveToSection(session.id, section)}>
              {t(sectionLabels[section])}
            </ContextMenuItem>
          ))}
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
          <ContextMenuSub>
            <ContextMenuSubTrigger>{t('threadSidebarChangeStatus')}</ContextMenuSubTrigger>
            <ContextMenuSubContent className="dshx-root dshx:min-w-44">
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
            </ContextMenuSubContent>
          </ContextMenuSub>
        </>
      )}
    </>
  )
}

/** Right-click menu of one thread, shared by thread rows and the usage-limit rows. */
const ThreadContextMenu = (props: ThreadContextMenuProps): JSX.Element => (
  <ContextMenu>
    <ContextMenuTrigger asChild>{props.children}</ContextMenuTrigger>
    <ContextMenuContent className="dshx-root dshx:min-w-44" aria-label={props.actions.translate('threadSidebarContextMenu')}>
      <ThreadMenuBody {...props} />
    </ContextMenuContent>
  </ContextMenu>
)

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
  const workspaceLabel = workspaceNameLabel(props.workspaceName, props.workspaceTitle)
  const metaLine = showProject || showMachine || showPath || childCount > 0
  const headLine = rowStyle.title || rowStyle.time || rowStyle.statusDot || props.rebasedAt !== undefined || props.integrationQueuedAt !== undefined
  const openAside = useAsideOpen()
  /**
   * One hover action's button, or null when the row's own state rules it out: the recovery pair only on a thread that
   * needs a resume, an archived row's Restore instead of the live actions, the aside only when an entry provided
   * its opener, and no Park, Settle or Archive while the thread (or, for Settle, a child) is running. The row's preference picks which of them render, and in which order.
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
      if (session.running) return null
      return withTooltip(
        t(parked ? 'threadSidebarUnpark' : 'threadSidebarPark'),
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t(parked ? 'threadSidebarUnpark' : 'threadSidebarPark')}
          onClick={() => props.actions.toggleParked(session.id)}
        >
          {parked ? <IconPlayOutlineRegular size={14} /> : <IconPauseOutlineRegular size={14} />}
        </Button>,
      )
    }
    if (action === 'settle') {
      if (session.running || props.childThreads.some(child => child.running)) return null
      return withTooltip(
        t(settled ? 'threadSidebarUnsettle' : 'threadSidebarSettle'),
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t(settled ? 'threadSidebarUnsettle' : 'threadSidebarSettle')}
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
    if (session.running) return null
    return withTooltip(
      t('threadSidebarArchive'),
      <Button variant="ghost" size="icon-xs" aria-label={t('threadSidebarArchive')} onClick={() => void props.actions.mutate(session.id, 'archive')}>
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
      section={props.section}
      workspaceId={props.workspaceId}
      actions={props.actions}
    >
      <article
        ref={rowRef}
        className={cn('dshx:group/row dshx:relative dshx:min-w-0', props.dragging && 'dshx:opacity-50')}
        data-thread-id={session.id}
        data-selected={props.selected}
        data-thread-section-row={props.section === undefined ? undefined : ''}
        onContextMenu={captureThreadMentionInsertion}
      >
        <div className="dshx:relative dshx:rounded-md dshx:hover:bg-accent/60 dshx:focus-within:bg-accent/60 dshx:group-data-[selected=true]/row:bg-accent">
          {props.renaming ? (
            <div className={cn('dshx:flex dshx:min-w-0 dshx:items-center', compact ? 'dshx:px-2 dshx:py-1.5' : 'dshx:px-2.5 dshx:py-2.5')}>
              <InlineTitleEditor
                value={session.displayTitle}
                label={t('threadSidebarRenameThread')}
                className={cn(compact ? 'dshx:h-6 dshx:text-sm' : 'dshx:h-7 dshx:text-base')}
                onCommit={title => props.actions.rename(session.id, title)}
                onCancel={props.actions.cancelRename}
              />
            </div>
          ) : (
            <button
              type="button"
              draggable
              className={cn(
                'dshx:relative dshx:flex dshx:w-full dshx:min-w-0 dshx:flex-col dshx:rounded-md dshx:text-left dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:disabled:cursor-default',
                compact ? 'dshx:gap-0.5 dshx:px-2 dshx:py-1.5' : 'dshx:gap-1 dshx:px-2.5 dshx:py-2.5',
                'dshx:data-[multi-selected=true]:bg-info/15 dshx:data-[multi-selected=true]:ring-1 dshx:data-[multi-selected=true]:ring-inset dshx:data-[multi-selected=true]:ring-info/40',
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
                  {props.integrationQueuedAt === undefined
                    ? null
                    : withTooltip(
                        t('threadSidebarIntegrationQueuedHint'),
                        <Badge variant="secondary" aria-label={t('threadSidebarIntegrationQueuedHint')} data-testid="thread-sidebar-integration-queued-tag">
                          {t('threadSidebarIntegrationQueued')}
                        </Badge>,
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
                        rowStyle.projectColor && props.workspaceTitle !== undefined && projectTextTone(props.workspaceTitle, props.rowStyle.projectPalette),
                        (showMachine || showPath || props.parentTitle !== undefined) && 'dshx:max-w-[55%] dshx:shrink-0',
                      )}
                    >
                      {props.workspaceTitle ?? t('threadSidebarUnassigned')}
                    </span>
                  ) : null}
                  {workspaceLabel === undefined ? null : (
                    <span className="dshx:shrink-0 dshx:truncate" data-testid="thread-workspace-name">
                      · {workspaceLabel}
                    </span>
                  )}
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
          )}
          {childCount > 0 ? (
            <button
              type="button"
              data-thread-children-toggle=""
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
          {nearViewport && !props.renaming ? (
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

type SidebarGroupedThread =
  | { readonly kind: 'local'; readonly session: SessionSummary; readonly updatedAt: number }
  | { readonly kind: 'remote'; readonly remote: RemoteSidebarThread; readonly updatedAt: number }

type SidebarGroupedViewEntry = {
  readonly thread: SidebarGroupedThread
  readonly workspaceId: string | undefined
  readonly activityAt: number
}

const EMPTY_UNSENT_DRAFTS: Readonly<Record<string, SessionDraft>> = Object.freeze({})
const EMPTY_SESSION_IDS: ReadonlySet<string> = new Set()
const EMPTY_HOISTED_SESSIONS: readonly SessionSummary[] = []
const EMPTY_HOISTED_USAGE_LIMIT_ROWS: readonly UsageLimitRow<SessionSummary>[] = []

const ThreadSidebarContent = (props: ThreadSidebarProps): JSX.Element => {
  const surface = props.surface ?? 'sidebar'
  const isBoard = surface === 'board'
  // Both surfaces can be mounted at once: URL ownership, notifications, attention polling and the auto-archive/settle
  // scans stay with the sidebar mount, so one session change is never handled twice.
  const isPrimarySurface = !isBoard
  const hostSessionState = props.useSessions(HostSnapshotsModel.selectStableSessionListState)
  const subscribeDrafts = useCallback((listener: () => void) => props.drafts?.subscribe(listener) ?? (() => undefined), [props.drafts])
  const readDrafts = useCallback(() => props.drafts?.getSnapshot() ?? EMPTY_UNSENT_DRAFTS, [props.drafts])
  const unsentDrafts = useSyncExternalStore(subscribeDrafts, readDrafts, readDrafts)
  const translateDraft = props.tSidebar
  const sessionState = useMemo(
    () => ({
      ...hostSessionState,
      byId: Object.fromEntries(
        Object.values(hostSessionState.byId).map(session => [
          session.id,
          presentUnsentThread({
            session,
            draft: unsentDrafts[session.id],
            newChatLabel: translateDraft('threadSidebarNewChat'),
            draftLabel: preview => translateDraft('threadSidebarUnsentDraft', { preview }),
          }),
        ]),
      ),
    }),
    [hostSessionState, unsentDrafts, translateDraft],
  )
  const sessionStatus = props.useSessionStatus(state => state)
  const workspaceState = props.useWorkspaces(state => state)
  const { preferences, updatePreferences, storageWarning, hostBacked, threadViewWritePending, setSelectedThreadId, threadTitle } = useSidebarState()
  const attention = useThreadAttention({ enabled: sessionState.phase === 'ready' })
  const recoveryApi = useApi(threadSidebarRecoveryApi)
  const queryClient = useQueryClient()
  const recoveryQuery = useQuery({
    queryKey: restartRecoveryQueryKey,
    queryFn: ({ signal }) => recoveryApi.pending(undefined, { signal }),
    staleTime: 30_000,
    refetchInterval: query => {
      const pending = query.state.data?.entries ?? query.state.data?.sessionIds ?? []
      return restartRecoveryRefetchInterval({
        primarySurface: isPrimarySurface,
        ownerMissing: isApiOwnerMissing(query.state.error),
        hasData: query.state.data !== undefined,
        hasPending: pending.length > 0,
      })
    },
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
    refetchInterval: query =>
      usageLimitRefetchInterval({
        primarySurface: isPrimarySurface,
        ownerMissing: isApiOwnerMissing(query.state.error),
        errored: query.state.status === 'error',
      }),
    retry: false,
  })
  useEffect(() => {
    const refresh = (): void => void queryClient.invalidateQueries({ queryKey: usageLimitQueryKey })
    window.addEventListener(QUOTA_CONTINUATION_UPDATED_EVENT, refresh)
    return () => window.removeEventListener(QUOTA_CONTINUATION_UPDATED_EVENT, refresh)
  }, [queryClient])
  const [usageLimitBusyIds, setUsageLimitBusyIds] = useState<ReadonlySet<string>>(() => new Set())
  const [usageLimitResumeAllBusy, setUsageLimitResumeAllBusy] = useState(false)
  const machine = useApiQuery(threadSidebarMachineApi, 'name', { enabled: preferences.threadRowMachine }).data?.name
  // Collapsing the sidebar hides the thread region with CSS, so a jj scan bought while collapsed has no reader: the
  // query waits, the schedule stops, and expanding the sidebar fetches once and arms it again. The board page reads
  // the same cached inventory but never owns the schedule.
  const jjInventoryPolling = isPrimarySurface && props.wide !== false
  const jjRepositories = useApiQuery(jjIntegrationApi, 'repositories', { input: {}, enabled: props.wide !== false || isBoard })
  const jjInventoryRefreshInterval = jjRepositories.data?.refreshing === true ? 5_000 : INVENTORY_REFRESH_INTERVAL_MS
  const jjThreads = useApi(jjIntegrationApi)
  const refetchJjRepositories = jjRepositories.refetch
  const jjOwnerMissing = isApiOwnerMissing(jjRepositories.error)
  useEffect(() => {
    // The inventory schedule pauses with the page, waits while the sidebar is collapsed, and stops for good once the
    // API owner is missing, instead of polling a Host that no longer answers the integration API.
    const poll = createInventoryPoll({
      refresh: refetchJjRepositories,
      intervalMs: jjInventoryRefreshInterval,
      isHidden: () => document.hidden,
      schedule: (callback: () => void, delayMs: number) => window.setTimeout(callback, delayMs),
      cancel: (handle: number) => window.clearTimeout(handle),
    })
    const onVisibilityChange = (): void => poll.visibilityChanged()
    const onRepositoryChange = (): void => {
      if (jjInventoryPolling && !jjOwnerMissing) void refetchJjRepositories()
    }
    window.addEventListener('dshfiles:jj-changed', onRepositoryChange)
    document.addEventListener('visibilitychange', onVisibilityChange)
    poll.start()
    poll.setAvailable(!jjOwnerMissing && jjInventoryPolling)
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      window.removeEventListener('dshfiles:jj-changed', onRepositoryChange)
      poll.stop()
    }
  }, [jjInventoryPolling, jjInventoryRefreshInterval, jjOwnerMissing, refetchJjRepositories])
  const [childrenOpenOverrides, setChildrenOpenOverrides] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const [expandedParents, setExpandedParents] = useState<ReadonlySet<string>>(() => new Set())
  const [threadSelection, setThreadSelection] = useState<ThreadSelectionState>(EMPTY_THREAD_SELECTION)
  const [shiftPressed, setShiftPressed] = useState(false)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Shift') setShiftPressed(true)
    }
    const onKeyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Shift') setShiftPressed(false)
    }
    const onWindowBlur = (): void => setShiftPressed(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onWindowBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onWindowBlur)
    }
  }, [])
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const selectionRef = useRef(threadSelection)
  selectionRef.current = threadSelection
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [viewsManagerOpen, setViewsManagerOpen] = useState(false)
  const [threadToScrollTo, setThreadToScrollTo] = useState<string | null>(null)
  const threadViewSettings = preferences.threadViews
  const listThreadView = ThreadViewPreferencesModel.activeThreadView(threadViewSettings)
  const boardViewSettings = storedThreadBoardView.useValue() ?? DEFAULT_THREAD_BOARD_VIEW
  const threadView = isBoard ? boardViewSettings : listThreadView
  const activeWorkspaceFilter = isBoard ? boardViewSettings.projectFilter : preferences.workspaceFilter
  const remoteThreads = useRemoteSidebarThreads(props.wide !== false)
  const [now, setNow] = useState(() => Date.now())
  // The render path reads `now`; gestures and notices stamp with this reader instead, outside render.
  const readNow = useCallback(() => Date.now(), [])
  const settingsId = useId()
  const [noticeQueueState, dispatchNoticeQueue] = useReducer(sidebarNoticeQueueReducer, INITIAL_SIDEBAR_NOTICE_QUEUE_STATE)
  const notice = noticeQueueState.current
  const isThreadNotification = noticeQueueState.currentIsNotification
  const setNotice = useCallback((notice: SidebarNotice | null): void => dispatchNoticeQueue({ type: 'set', notice }), [dispatchNoticeQueue])
  const updateNotice = useCallback(
    (update: (current: SidebarNotice | null) => SidebarNotice | null): void => dispatchNoticeQueue({ type: 'update', update }),
    [dispatchNoticeQueue],
  )
  const beginRename = useCallback((sessionId: SessionSummary['id']): void => {
    setRenamingSessionId(sessionId)
  }, [])
  const cancelRename = useCallback((): void => {
    setRenamingSessionId(null)
  }, [])
  const renameThread = async (sessionId: SessionSummary['id'], title: string): Promise<void> => {
    try {
      await props.renameSession(sessionId, title)
      setRenamingSessionId(null)
      setNotice(null)
    } catch {
      setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarRenameFailure') })
    }
  }
  const continueThreadIn = async (sessionId: SessionSummary['id'], projectId: string): Promise<void> => {
    try {
      const continued = await props.continueInProject(sessionId, projectId)
      // The Host settle is what blocks further steps; a sidebar on browser-local preferences keeps its own copy, so it
      // settles the original itself, and never the continuation that is now its child thread.
      settleThreads([sessionId])
      setNotice(
        continued.settled
          ? { tone: 'success', message: props.tSidebar('threadSidebarContinuedIn') }
          : { tone: 'warning', message: props.tSidebar('threadSidebarContinuedUnsettled') },
      )
      openThreadRef.current(continued.continuedSessionId)
    } catch {
      setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarContinueInFailure') })
    }
  }
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
  const previousStatus = useRef<Readonly<Record<string, ThreadInteractionStatus>> | null>(null)
  const openedRouteId = useRef<string | null>(null)
  // The page-load link resolves once the thread list is ready; Back and Forward are explicit thread navigations.
  const routeFromPageLoad = useRef(routeRequest !== null)
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
  /** The workspace a Session really lives in, for the deep link; grouping keeps using the project attribution. */
  const realWorkspaceBySession = useMemo(() => {
    const result = SidebarOrganization.sessionWorkspaceIds(workspaceState.items)
    // Local blank identities are not attached on the Host until typing begins.
    for (const draft of Object.values(unsentDrafts)) {
      if (!result.has(draft.sessionId) && draft.workspaceId !== undefined) result.set(draft.sessionId, draft.workspaceId)
    }
    return result
  }, [workspaceState.items, unsentDrafts])
  const archivedSessionIds = useMemo(() => setIncludes(workspaceState.archivedSessionIds), [workspaceState.archivedSessionIds])
  const pinnedSessionIds = useMemo(() => setIncludes(workspaceState.pinnedSessionIds), [workspaceState.pinnedSessionIds])
  const settledSessionIds = useMemo(() => setIncludes(preferences.settledSessionIds), [preferences.settledSessionIds])
  const defaultProjectTitle = props.tSidebar('threadSidebarDefaultProject')
  const displayWorkspaces = useMemo(
    () =>
      SidebarOrganization.projectWorkspaces(workspaceState.items).map(workspace => ({
        id: workspace.workspaceId,
        title: workspace.title.length > 0 ? workspace.title : defaultProjectTitle,
      })),
    [defaultProjectTitle, workspaceState.items],
  )
  /** Titles by workspace id, so a row does not rescan every workspace on each render. */
  const workspaceTitleById = useMemo(() => new Map<string, string>(displayWorkspaces.map(workspace => [workspace.id, workspace.title])), [displayWorkspaces])
  const workspaceNameById = useMemo(
    () => new Map<string, string | undefined>(workspaceState.items.map(workspace => [workspace.workspaceId, workspaceName(workspace.path)])),
    [workspaceState.items],
  )
  const integrationQueuedAtBySessionId = useMemo(
    () => indexQueuedIntegrationSessions((jjRepositories.data?.repositories ?? []).flatMap(repository => repository.threads)),
    [jjRepositories.data],
  )
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
  const archiveSessionProp = props.archiveSession
  const archiveClient = useMemo<AutoArchiveClient>(
    () => ({
      archiveSession: sessionId => archiveSessionProp(sessionId),
      getCandidateSessionIds: () => archiveScan.current,
    }),
    [archiveSessionProp],
  )
  const { requestScan, refreshCandidates } = useAutoArchive({
    client: archiveClient,
    enabled: isPrimarySurface && settledArchiveEnabled,
    intervalMs: preferences.scanIntervalMinutes * 60_000,
    onSettled: () => refreshCandidates('all'),
  })
  const dueArchiveSessionIdsKey = dueSettledArchiveSessionIds.join(',')
  useEffect(() => {
    if (!isPrimarySurface || !settledArchiveEnabled || dueArchiveSessionIdsKey === '') return
    requestScan('all')
  }, [dueArchiveSessionIdsKey, isPrimarySurface, requestScan, settledArchiveEnabled])
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
  const continuedQuestionSessionIds = useMemo(
    () => new Set(activeQuestionSessionIds(questionCandidates, sessionState.byId)),
    [questionCandidates, sessionState.byId],
  )
  const parkedSessionIds = useMemo(() => setIncludes(preferences.parkedSessionIds), [preferences.parkedSessionIds])
  const mutedThreads = preferences.mutedThreads
  const mutedSessionIds = useMemo(
    () => new Set(Object.entries(mutedThreads).flatMap(([sessionId, mute]) => (isMuteActive(mute, now) ? [sessionId] : []))),
    [mutedThreads, now],
  )
  const selectedSession = useMemo(() => sessions.find(session => (session.retainedBy.mainView ?? 0) > 0), [sessions])
  const selectedSessionId = selectedSession?.id
  /**
   * Abandoned New threads. DSH mints the Session (and, when isolation is the default, a whole thread workspace) before
   * the first prompt, so an abandoned attempt leaves an untitled idle thread whose folder name becomes its row title.
   * They are folded into one "Empty drafts" row instead of posing as real threads.
   */
  const draftSessions = useMemo(
    () =>
      DraftThreadsModel.draftThreadsOf({
        sessions: sessions.filter(session => unsentDrafts[session.id] === undefined),
        exclusions: { archivedSessionIds, pinnedSessionIds, selectedSessionId },
      }),
    [archivedSessionIds, pinnedSessionIds, selectedSessionId, sessions, unsentDrafts],
  )
  const draftSessionIds = useMemo(() => new Set(draftSessions.map(draft => draft.id)), [draftSessions])
  const [draftsOpen, setDraftsOpen] = useState(false)
  const [draftsCleaning, setDraftsCleaning] = useState(false)
  const [detachedBranchBusy, setDetachedBranchBusy] = useState<ReadonlySet<string>>(() => new Set())
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
        activeWorkspaceFilter === null ||
        (SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession) ?? '') === activeWorkspaceFilter,
    }),
    [
      archivedSessionIds,
      settledSessionIds,
      mutedSessionIds,
      activeWorkspaceFilter,
      recoveryReasonFor,
      recoverySessionIds,
      sessionState.byId,
      sessions,
      workspaceBySession,
    ],
  )
  const allNeedsResumeRows = useMemo(() => selectRecoveryRows({ ...recoveryRowOptions, reason: 'restart', matchesSource: () => true }), [recoveryRowOptions])
  const allInterruptedRows = useMemo(
    () => selectRecoveryRows({ ...recoveryRowOptions, reason: 'interrupted', matchesSource: () => true }),
    [recoveryRowOptions],
  )
  const needsResumeRows = useMemo(
    () => allNeedsResumeRows.filter(session => ThreadViewModel.matchesSourceFilter(session, threadView.sourceFilter)),
    [allNeedsResumeRows, threadView.sourceFilter],
  )
  const allUsageLimitRows = useMemo(
    () =>
      UsageLimitRowsModel.select({
        sessions,
        continuations: usageLimitQuery.data?.continuations ?? EMPTY_CONTINUATIONS,
        mutedSessionIds,
        archivedSessionIds,
        settledSessionIds,
        matchesWorkspace: session =>
          activeWorkspaceFilter === null ||
          (SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession) ?? '') === activeWorkspaceFilter,
        matchesSource: () => true,
      }),
    [
      archivedSessionIds,
      settledSessionIds,
      mutedSessionIds,
      activeWorkspaceFilter,
      sessionState.byId,
      sessions,
      usageLimitQuery.data?.continuations,
      workspaceBySession,
    ],
  )
  const usageLimitRows = useMemo(
    () => allUsageLimitRows.filter(row => ThreadViewModel.matchesSourceFilter(row.session, threadView.sourceFilter)),
    [allUsageLimitRows, threadView.sourceFilter],
  )
  const allUsageLimitSessionIds = useMemo(() => new Set(allUsageLimitRows.map(row => row.session.id)), [allUsageLimitRows])
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
    readonly dismiss?: boolean
  }): Promise<void> => {
    setUsageLimitBusyIds(current => new Set(current).add(input.continuationId))
    try {
      if (input.dismiss === true) await accountsApi.dismissQuotaContinuation({ continuationId: input.continuationId })
      if (input.duration !== undefined) await accountsApi.snoozeQuotaContinuation({ continuationId: input.continuationId, duration: input.duration })
      if (input.enabled !== undefined && input.sessionId !== undefined) {
        await accountsApi.setQuotaContinuationAutoRetry({
          continuationId: input.continuationId,
          sessionId: input.sessionId,
          enabled: input.enabled,
        })
        window.dispatchEvent(new Event(QUOTA_CONTINUATION_UPDATED_EVENT))
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
    const failedSessionIds: SessionSummary['id'][] = []
    const worker = async (): Promise<void> => {
      while (nextIndex < pending.length) {
        const row = pending[nextIndex]
        nextIndex += 1
        if (row === undefined) continue
        try {
          const result = await accountsApi.resumeQuotaContinuation({ continuationId: row.continuation.continuationId })
          if (result.accepted) sent += 1
          else {
            failed += 1
            failedSessionIds.push(row.session.id)
          }
        } catch {
          failed += 1
          failedSessionIds.push(row.session.id)
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(3, pending.length) }, worker))
      await queryClient.invalidateQueries({ queryKey: usageLimitQueryKey })
      setNotice(
        failed === 0
          ? { tone: 'success', message: props.tSidebar('threadSidebarResumeSent', { count: sent }) }
          : failedResumeNotice({
              message: props.tSidebar('threadSidebarResumePartial', { sent, failed }),
              actionLabel: props.tSidebar('threadSidebarOpenFailedResume'),
              failedSessionIds,
              openThread,
            }),
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
    const failedSessionIds: SessionSummary['id'][] = []
    const worker = async (): Promise<void> => {
      while (nextIndex < sessionIds.length) {
        const sessionId = sessionIds[nextIndex]
        nextIndex += 1
        if (sessionId === undefined) continue
        try {
          const result = await resumeMutation.mutateAsync({ sessionId })
          if (result.accepted) sent += 1
          else {
            failed += 1
            failedSessionIds.push(sessionId)
          }
        } catch {
          failed += 1
          failedSessionIds.push(sessionId)
        }
      }
    }
    try {
      await Promise.all(Array.from({ length: Math.min(3, sessionIds.length) }, worker))
      await queryClient.invalidateQueries({ queryKey: restartRecoveryQueryKey })
      setNotice(
        failed === 0
          ? { tone: 'success', message: props.tSidebar('threadSidebarResumeSent', { count: sent }) }
          : failedResumeNotice({
              message: props.tSidebar('threadSidebarResumePartial', { sent, failed }),
              actionLabel: props.tSidebar('threadSidebarOpenFailedResume'),
              failedSessionIds,
              openThread,
            }),
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

  // The current empty chat has a row, not a durable navigation-history entry.
  const historySessionId =
    selectedSession !== undefined &&
    isListedUnsentThread({
      session: selectedSession,
      selectedSessionId: undefined,
      draft: unsentDrafts[selectedSession.id],
    })
      ? selectedSession.id
      : null
  useEffect(() => setSelectedThreadId(historySessionId), [historySessionId, setSelectedThreadId])
  useEffect(() => {
    if (!isPrimarySurface) return
    const onFocusThread = (event: Event): void => {
      const request = event instanceof CustomEvent ? threadTabFocusEventSchema.safeParse(event.detail) : undefined
      if (request?.success === true) setThreadToScrollTo(request.data.sessionId)
    }
    window.addEventListener(THREAD_TAB_FOCUS_EVENT, onFocusThread)
    return () => window.removeEventListener(THREAD_TAB_FOCUS_EVENT, onFocusThread)
  }, [isPrimarySurface])
  const refreshAttention = attention.refresh
  useEffect(() => {
    if (!isPrimarySurface) return
    if (!attentionRefreshed.current) {
      attentionRefreshed.current = true
      return
    }
    refreshAttention()
  }, [isPrimarySurface, refreshAttention, runningSignature])
  // The shared attention store owns the page-wide poll and its focus/visibility catch-up, so this
  // mount only refreshes when the running set changes (the one fact that makes attention stale fast).
  const selectedAttention = selectedSessionId === undefined ? undefined : attention.records.get(selectedSessionId)
  const acknowledgeAttention = attention.acknowledge
  const acknowledgeManualUnread = attention.clearUnread
  useEffect(() => {
    if (!isPrimarySurface) return
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
  }, [acknowledgeAttention, acknowledgeManualUnread, isPrimarySurface, selectedAttention, selectedSessionId])
  threadTitle.current = sessionId => sessionState.byId[sessionId]?.displayTitle

  const selectThread = (sessionId: SessionSummary['id'], options: { readonly linked?: boolean } = {}): void => {
    if (sessionId !== selectedSessionId) startInteraction('thread switch', { attributes: { 'dshx.thread.source': 'sidebar' } })
    const opened = attention.records.get(sessionId)
    if (opened !== undefined) attention.clearUnread(sessionId, opened.version)
    setRouteRequest(null)
    openedRouteId.current = sessionId
    suppressUrlForSession.current = null
    const session = sessionState.byId[sessionId]
    const workspaceId =
      session === undefined
        ? undefined
        : (realWorkspaceBySession.get(session.id) ?? SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession))
    window.history.replaceState(window.history.state, '', buildThreadUrl(window.location.href, sessionId, workspaceId))
    if (options.linked === true && props.openLinkedSession !== undefined) props.openLinkedSession(sessionId)
    else props.open(sessionId)
  }

  /**
   * Select the thread in the main view. An archived thread is restored first: DSH drops an archived
   * Session from the main view on every list change, so opening one without restoring it fails as a
   * released Session reference — restoring is the one click that replaces that retry fight.
   */
  const openThread = (sessionId: SessionSummary['id'], options: { readonly linked?: boolean } = {}): void => {
    if (archivedSessionIds.has(sessionId)) {
      void props.unarchiveSession(sessionId).then(
        () => selectThread(sessionId, options),
        () => setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarActionFailure') }),
      )
      return
    }
    selectThread(sessionId, options)
  }
  const openThreadRef = useRef(openThread)
  openThreadRef.current = openThread

  useEffect(() => {
    if (!isPrimarySurface) return
    const onPopState = (): void => {
      const requested = readThreadUrl(window.location.href)?.sessionId ?? null
      suppressUrlForSession.current = requested === null ? (selectedSession?.id ?? null) : null
      openedRouteId.current = null
      routeFromPageLoad.current = false
      setRouteRequest(requested)
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [isPrimarySurface, selectedSession?.id])

  useEffect(() => {
    if (!isPrimarySurface || routeRequest === null || sessionState.phase !== 'ready') return
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
    openThreadRef.current(target.id, { linked: routeFromPageLoad.current })
  }, [archivedSessionIds, isPrimarySurface, props, routeRequest, sessions, sessionState.phase, setNotice])

  useEffect(() => {
    if (!isPrimarySurface || selectedSession === undefined || routeRequest !== null) return
    if (suppressUrlForSession.current === selectedSession.id) return
    suppressUrlForSession.current = null
    const workspaceId =
      realWorkspaceBySession.get(selectedSession.id) ?? SidebarOrganization.workspaceForLineage(selectedSession, sessionState.byId, workspaceBySession)
    const next = buildThreadUrl(window.location.href, selectedSession.id, workspaceId)
    if (next !== window.location.href) window.history.replaceState(window.history.state, '', next)
  }, [isPrimarySurface, realWorkspaceBySession, routeRequest, selectedSession, sessionState.byId, workspaceBySession])

  const changePreferences = useCallback(
    (patch: Partial<SidebarPreferences>): void => {
      updatePreferences(patch)
    },
    [updatePreferences],
  )

  const viewsMigrationStarted = useRef(false)
  const doneViewMigrationTarget = useRef<ThreadViewSettings | null>(null)
  const removeLegacyViewsAfterMigration = useRef(false)
  useEffect(() => {
    if (!isPrimarySurface || !hostBacked || viewsMigrationStarted.current || threadViewWritePending) return
    viewsMigrationStarted.current = true
    const legacy = threadViewPreferences.get()
    const adoptLegacy =
      !ThreadViewPreferencesModel.isDefaultThreadViewSettings(legacy) && ThreadViewPreferencesModel.isDefaultThreadViewSettings(preferences.threadViews)
    const source = adoptLegacy ? legacy : preferences.threadViews
    const shouldMigrateDone = adoptLegacy || !doneViewFilterMigration.get() || ThreadViewPreferencesModel.isDefaultThreadViewSettings(source)
    const shouldUpgradeShippedFilters = adoptLegacy || !shippedViewFiltersMigration.get() || ThreadViewPreferencesModel.isDefaultThreadViewSettings(source)
    const doneMigrated = shouldMigrateDone ? ThreadViewPreferencesModel.migrateDoneViewSettings(source) : source
    const migrated = shouldUpgradeShippedFilters ? ThreadViewPreferencesModel.upgradeShippedViewFilters(doneMigrated) : doneMigrated
    const needsWrite = adoptLegacy || migrated !== source
    if (!needsWrite) {
      threadViewPreferences.remove()
      doneViewFilterMigration.set(true)
      shippedViewFiltersMigration.set(true)
      return
    }
    doneViewMigrationTarget.current = migrated
    removeLegacyViewsAfterMigration.current = true
    changePreferences({ threadViews: migrated })
  }, [changePreferences, hostBacked, isPrimarySurface, preferences.threadViews, threadViewWritePending])
  useEffect(() => {
    const target = doneViewMigrationTarget.current
    if (!isPrimarySurface || !hostBacked || target === null || threadViewWritePending || storageWarning) return
    if (JSON.stringify(preferences.threadViews) !== JSON.stringify(target)) return
    doneViewMigrationTarget.current = null
    doneViewFilterMigration.set(true)
    shippedViewFiltersMigration.set(true)
    if (removeLegacyViewsAfterMigration.current) threadViewPreferences.remove()
    removeLegacyViewsAfterMigration.current = false
  }, [hostBacked, isPrimarySurface, preferences.threadViews, storageWarning, threadViewWritePending])

  // Group collapse moved from browser storage to Host settings: hand the browser copy over once, then drop it.
  const groupsMigrationStarted = useRef(false)
  useEffect(() => {
    if (!isPrimarySurface || !hostBacked || groupsMigrationStarted.current) return
    groupsMigrationStarted.current = true
    const legacy = storedCollapsedGroups.get()
    storedCollapsedGroups.remove()
    if (legacy.length === 0 || preferences.collapsedGroups.length > 0) return
    changePreferences({ collapsedGroups: [...legacy] })
  }, [changePreferences, hostBacked, isPrimarySurface, preferences.collapsedGroups])

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

  const mutateThreads = async (threadIds: readonly SessionSummary['id'][], operation: RowOperation): Promise<boolean> => {
    const actionThreads = Object.values(sessionState.byId).filter(session => !session.blank)
    const targetIds = new Set<SessionSummary['id']>()
    for (const threadId of threadIds) {
      for (const targetId of threadActionTargetIds({ threadId, threads: actionThreads, cascadeToChildren: preferences.applyActionsToChildThreads })) {
        targetIds.add(targetId)
      }
    }
    const targetIdsToChange = [...targetIds].filter(targetId => {
      if (operation === 'pin') return !pinnedSessionIds.has(targetId)
      if (operation === 'unpin') return pinnedSessionIds.has(targetId)
      if (operation === 'archive') return !archivedSessionIds.has(targetId)
      return archivedSessionIds.has(targetId)
    })
    if (targetIdsToChange.length === 0) return true
    if (operation === 'archive' && targetIdsToChange.some(targetId => sessionState.byId[targetId]?.running)) {
      setNotice({ tone: 'warning', message: props.tSidebar('threadSidebarRunningNotice') })
      return false
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
        return !failed
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
      return !failed
    }
    setNotice(failed ? { tone: 'danger', message: props.tSidebar('threadSidebarActionFailure') } : null)
    return !failed
  }

  const mutateSession = async (sessionId: SessionSummary['id'], operation: RowOperation): Promise<void> => {
    await mutateThreads([sessionId], operation)
  }

  const batchSelectionIds = (): SessionSummary['id'][] =>
    selectionRef.current.sessionIds.map(sessionId => SessionId(sessionId)).filter(sessionId => sessionState.byId[sessionId] !== undefined)

  /** Selection rows plus the child rows the current cascade preference attaches to them. */
  const batchTargetIds = (): string[] => {
    const actionThreads = Object.values(sessionState.byId).filter(session => !session.blank)
    const targets = new Set<string>()
    for (const sessionId of batchSelectionIds()) {
      for (const targetId of threadActionTargetIds({
        threadId: sessionId,
        threads: actionThreads,
        cascadeToChildren: preferences.applyActionsToChildThreads,
      })) {
        targets.add(targetId)
      }
    }
    return [...targets]
  }

  const batchSnapshot = (): BatchSelectionSnapshot => {
    const ids = [...selectionRef.current.sessionIds]
    return {
      ids,
      anyPinned: ids.some(sessionId => pinnedSessionIds.has(SessionId(sessionId))),
      anyUnpinned: ids.some(sessionId => !pinnedSessionIds.has(SessionId(sessionId))),
      anyLive: ids.some(sessionId => !archivedSessionIds.has(SessionId(sessionId))),
      anyArchived: ids.some(sessionId => archivedSessionIds.has(SessionId(sessionId))),
      anyParked: ids.some(sessionId => parkedSessionIds.has(sessionId)),
      anyUnparked: ids.some(sessionId => !parkedSessionIds.has(sessionId)),
      anySettled: ids.some(sessionId => settledSessionIds.has(SessionId(sessionId))),
      anyUnsettled: ids.some(sessionId => !settledSessionIds.has(SessionId(sessionId))),
      anyMuted: ids.some(sessionId => mutedSessionIds.has(SessionId(sessionId))),
    }
  }

  const selectRowForContext = (sessionId: SessionSummary['id']): void => {
    if (selectionRef.current.sessionIds.includes(sessionId)) return
    setThreadSelection(ThreadSelectionModel.selectOnly(sessionId))
  }

  const clearThreadSelection = (): void => setThreadSelection(EMPTY_THREAD_SELECTION)

  const batchMutate = (operation: RowOperation): void => {
    const targetIds = batchSelectionIds()
    if (targetIds.length === 0) return
    void mutateThreads(targetIds, operation).then(succeeded => {
      if (succeeded) setThreadSelection(EMPTY_THREAD_SELECTION)
    })
  }

  const batchSetParked = (park: boolean): void => {
    const targetIds = batchTargetIds()
    if (targetIds.length === 0) return
    const next = new Set(preferences.parkedSessionIds)
    for (const targetId of targetIds) {
      if (park) next.add(targetId)
      else next.delete(targetId)
    }
    changePreferences({ parkedSessionIds: [...next] })
    setNotice(null)
    setThreadSelection(EMPTY_THREAD_SELECTION)
  }

  /** Settling also clears parked state and unpins threads, so a settled thread leaves the Pinned section. */
  const settleThreads = (sessionIds: readonly string[]): void => {
    changePreferences(
      SettledThreadsModel.settleAndUnpark({
        status: { settledSessionIds: preferences.settledSessionIds, settledAt: preferences.settledAt },
        parkedSessionIds: preferences.parkedSessionIds,
        sessionIds,
        now: readNow(),
      }),
    )
    void SettledThreadsModel.unpinSettledThreads({
      sessionIds,
      pinnedSessionIds,
      unpin: sessionId => props.unpinSession(SessionId(sessionId)),
    }).catch(() => setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarActionFailure') }))
  }

  const batchSetSettled = (settle: boolean): void => {
    const targetIds = batchTargetIds()
    if (targetIds.length === 0) return
    const status = { settledSessionIds: preferences.settledSessionIds, settledAt: preferences.settledAt }
    if (!settle) {
      const settledTargets = targetIds.filter(targetId => settledSessionIds.has(SessionId(targetId)))
      if (settledTargets.length > 0) changePreferences(SettledThreadsModel.unsettle(status, settledTargets))
      setThreadSelection(EMPTY_THREAD_SELECTION)
      return
    }
    const unsettledTargets = targetIds.filter(targetId => !settledSessionIds.has(SessionId(targetId)))
    if (unsettledTargets.length === 0) {
      setThreadSelection(EMPTY_THREAD_SELECTION)
      return
    }
    if (unsettledTargets.some(targetId => SidebarOrganization.hasRunningDescendant({ sessionId: SessionId(targetId), sessions }))) {
      setNotice({ tone: 'warning', message: props.tSidebar('threadSidebarRunningNotice') })
      return
    }
    settleThreads(unsettledTargets)
    setNotice({ tone: 'success', message: props.tSidebar('threadSidebarSettledNotice') })
    setThreadSelection(EMPTY_THREAD_SELECTION)
  }

  const batchMute = (option: ThreadMuteOption): void => {
    const targets = batchTargetIds().flatMap(targetId => {
      const session = sessionState.byId[SessionId(targetId)]
      return session === undefined || session.blank ? [] : [session]
    })
    if (targets.length === 0) return
    changePreferences({ mutedThreads: muteSessions({ mutes: preferences.mutedThreads, sessions: targets, until: muteUntil(option, readNow()) }) })
    setThreadSelection(EMPTY_THREAD_SELECTION)
  }

  const batchUnmute = (): void => {
    changePreferences({ mutedThreads: unmuteSessions(preferences.mutedThreads, batchTargetIds()) })
    setThreadSelection(EMPTY_THREAD_SELECTION)
  }

  const batchMarkUnread = (): void => {
    for (const sessionId of batchSelectionIds()) attention.markUnread(sessionId)
    setThreadSelection(EMPTY_THREAD_SELECTION)
  }

  const batchCopyLinks = (): void => {
    const links = batchSelectionIds().flatMap(sessionId => {
      const session = sessionState.byId[sessionId]
      if (session === undefined) return []
      const workspaceId = SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession)
      return [buildThreadUrl(window.location.href, session.id, workspaceId)]
    })
    if (links.length === 0) return
    void copyContextValue(links.join('\n'), props.tSidebar('threadSidebarLinksCopied', { count: links.length }))
  }

  const tSidebar = props.tSidebar

  const copyContextValue = async (value: string, successMessage: string): Promise<void> => {
    setNotice(
      (await writeClipboard(value))
        ? { tone: 'success', message: successMessage }
        : { tone: 'danger', message: props.tSidebar('threadSidebarClipboardFailure') },
    )
  }

  /**
   * Archive every empty draft and forget the thread workspaces that hold nothing but drafts. Archiving is reversible
   * from the archive section; jj-integration still refuses a workspace with unlanded revisions or uncommitted edits, so
   * a folder that turns out to hold work stays.
   */
  const cleanUpDrafts = async (): Promise<void> => {
    if (draftsCleaning) return
    setDraftsCleaning(true)
    try {
      const plan = DraftThreadsModel.planCleanup({ drafts: draftSessions, workspaces: workspaceState.items })
      let archived = 0
      for (const sessionId of plan.sessionIds) {
        try {
          await props.archiveSession(sessionId)
          archived += 1
        } catch {
          // One refused archive must not stop the rest of the cleanup.
        }
      }
      for (const path of plan.workspacePaths) await jjThreads.discard({ path, force: false }).catch(() => undefined)
      setNotice({ tone: 'success', message: props.tSidebar('threadSidebarDraftsCleaned', { count: archived }) })
      setDraftsOpen(false)
      void refetchJjRepositories()
    } catch {
      setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarActionFailure') })
    } finally {
      setDraftsCleaning(false)
    }
  }

  /**
   * Put a whole branch whose parent left the corpus away, or bring it back. Those rows are plain child rows with no
   * menu, and there is no parent row to cascade from, so the header is the only place that can archive the branch.
   */
  const mutateDetachedBranch = async (branch: {
    readonly missingAncestorId: string
    readonly threadIds: readonly SessionSummary['id'][]
    readonly action: DetachedGroupAction
  }): Promise<void> => {
    if (detachedBranchBusy.has(branch.missingAncestorId)) return
    setDetachedBranchBusy(current => new Set(current).add(branch.missingAncestorId))
    try {
      const succeeded = await mutateThreads(branch.threadIds, branch.action === 'restore' ? 'unarchive' : 'archive')
      if (branch.action === 'restore' && succeeded) setNotice({ tone: 'success', message: props.tSidebar('threadSidebarRestoredNotice') })
    } finally {
      setDetachedBranchBusy(current => {
        const next = new Set(current)
        next.delete(branch.missingAncestorId)
        return next
      })
    }
  }

  const notifyThread = (category: ThreadNotificationCategory, eventId: string, sessionId: SessionSummary['id'], title: string, fallbackBody: string): void => {
    const categoryPreferences = preferences.notificationCategories[category]
    if (
      storedNotificationsMuted.get() === true ||
      !ThreadNotificationModel.threadNotificationHasOutput(categoryPreferences) ||
      isMuteActive(mutedThreads[sessionId], readNow())
    )
      return
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
          durationMs: preferences.notificationDurationSeconds * 1_000,
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
    settleThreads(sessionIds)
  }

  const applySettled = (sessionId: SessionSummary['id'], shouldSettle: boolean): void => {
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
    if (shouldSettle) settleThreads(targets)
    else changePreferences(SettledThreadsModel.unsettle(status, targets))
    setNotice(shouldSettle ? { tone: 'success', message: props.tSidebar('threadSidebarSettledNotice') } : null)
  }

  const toggleSettled = (sessionId: SessionSummary['id']): void => {
    applySettled(sessionId, !settledSessionIds.has(sessionId))
  }

  /**
   * Drop a row into another status section. A section is a status, so entering one sets it and clears
   * the statuses that outrank it: dragging a settled thread out unsettles it and dragging an archived
   * thread out restores it. Active and Inactive are derived from idleness, so those drops record an
   * override, which a later turn supersedes by moving the thread's `updatedAt` past it.
   */
  const moveThreadsToSection = async (sessionId: SessionSummary['id'], section: SidebarSection): Promise<void> => {
    const plan = SidebarOrganization.sectionDropPlan(section)
    const targets = threadActionTargetIds({
      threadId: sessionId,
      threads: Object.values(sessionState.byId).filter(session => !session.blank),
      cascadeToChildren: preferences.applyActionsToChildThreads,
    })
    const running = targets.filter(targetId => sessionState.byId[targetId]?.running === true)
    if ((plan.archive || plan.park || plan.settle) && running.length > 0) {
      setNotice({ tone: 'warning', message: props.tSidebar('threadSidebarRunningNotice') })
      return
    }
    if (plan.settle && targets.some(targetId => SidebarOrganization.hasRunningDescendant({ sessionId: targetId, sessions }))) {
      setNotice({ tone: 'warning', message: props.tSidebar('threadSidebarRunningNotice') })
      return
    }
    let failed = false
    const archivedTargets = targets.filter(targetId => archivedSessionIds.has(SessionId(targetId)))
    if (plan.unarchive && archivedTargets.length > 0) failed = !(await mutateThreads(archivedTargets, 'unarchive')) || failed
    if (plan.archive) failed = !(await mutateThreads([sessionId], 'archive')) || failed
    if (plan.pin) failed = !(await mutateThreads([sessionId], 'pin')) || failed
    if (plan.unpin) failed = !(await mutateThreads([sessionId], 'unpin')) || failed

    const nextParked = new Set(preferences.parkedSessionIds)
    for (const targetId of targets) {
      if (plan.park) nextParked.add(targetId)
      if (plan.unpark) nextParked.delete(targetId)
    }
    const status = { settledSessionIds: preferences.settledSessionIds, settledAt: preferences.settledAt }
    const idleSectionOverrides = { ...preferences.idleSectionOverrides }
    for (const targetId of targets) {
      if (plan.idleOverride === null) delete idleSectionOverrides[targetId]
      else idleSectionOverrides[targetId] = { section: plan.idleOverride, at: readNow() }
    }
    // A drop opens the destination instead of folding it: the section the row was dragged inside is already open,
    // so toggling would fold it and hide the row that just landed.
    const nextCollapsedSections = collapsedSections.filter(item => item !== section)
    const nextPreferences = {
      parkedSessionIds: [...nextParked],
      ...(plan.settle ? SettledThreadsModel.settle(status, targets, readNow()) : plan.unsettle ? SettledThreadsModel.unsettle(status, targets) : {}),
      idleSectionOverrides,
    }
    if (isBoard) storedThreadBoardView.set(ThreadBoardViewModel.update(boardViewSettings, { collapsedSections: nextCollapsedSections }))
    changePreferences(isBoard ? nextPreferences : { ...nextPreferences, collapsedSections: [...nextCollapsedSections] })
    if (failed) setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarActionFailure') })
    else if (!plan.archive) setNotice(null)
  }

  /**
   * The jj-integration notice asks this sidebar to settle the thread it just integrated. Settling writes our own
   * status, so the sidebar answers the request and the notice keeps no second copy of it.
   */
  const settleRequest = useRef<(sessionId: SessionSummary['id']) => void>(() => undefined)
  settleRequest.current = sessionId => {
    if (!settledSessionIds.has(sessionId)) applySettled(sessionId, true)
  }
  useEffect(() => {
    if (!isPrimarySurface) return
    return answerSettleRequests(sessionId => settleRequest.current(SessionId(sessionId)))
  }, [isPrimarySurface])

  const collapsedGroups = isBoard ? boardViewSettings.collapsedGroups : preferences.collapsedGroups
  const collapsedSections = isBoard ? boardViewSettings.collapsedSections : preferences.collapsedSections
  const toggleGroup = (key: string): void => {
    const nextCollapsedGroups = toggleCollapsedGroup(collapsedGroups, key)
    if (isBoard) storedThreadBoardView.set(ThreadBoardViewModel.update(boardViewSettings, { collapsedGroups: nextCollapsedGroups }))
    else changePreferences({ collapsedGroups: nextCollapsedGroups })
  }

  const toggleSection = (section: SidebarSection): void => {
    const nextCollapsedSections = SidebarPreferencesModel.toggleCollapsedSection(collapsedSections, section)
    if (isBoard) storedThreadBoardView.set(ThreadBoardViewModel.update(boardViewSettings, { collapsedSections: nextCollapsedSections }))
    else changePreferences({ collapsedSections: nextCollapsedSections })
  }

  // Archiving outranks settled: an archived thread keeps no settled status, so restoring it comes back usable
  // instead of waiting for the archive delay that already fired. Covers every archive path, the Agent's included.
  useEffect(() => {
    if (!isPrimarySurface) return
    const archivedStillSettled = preferences.settledSessionIds.filter(sessionId => archivedSessionIds.has(sessionId))
    if (archivedStillSettled.length === 0) return
    const status = { settledSessionIds: preferences.settledSessionIds, settledAt: preferences.settledAt }
    changePreferences(SettledThreadsModel.unsettle(status, archivedStillSettled))
  }, [archivedSessionIds, changePreferences, isPrimarySurface, preferences.settledAt, preferences.settledSessionIds])

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

  const autoSettleClient: AutoSettleClient = {
    scan: () => {
      const latest = latestAutoSettle.current
      if (latest === null) return
      const dueSessionIds = new Set<string>()

      if (SidebarOrganization.shouldScanForAutoSettle(latest.preferences)) {
        const now = readNow()
        for (const session of latest.sessions) {
          const isCandidate = SidebarOrganization.isAutoSettleCandidate({
            session,
            workspaceId: latest.workspaceBySession.get(session.id),
            now,
            preferences: latest.preferences,
            archivedSessionIds: latest.archived,
            pinnedSessionIds: latest.pinned,
            settledSessionIds: latest.settled,
          })
          if (!isCandidate || SidebarOrganization.hasRunningDescendant({ sessionId: session.id, sessions: latest.sessions })) continue
          dueSessionIds.add(session.id)
        }
      }

      if (latest.preferences.rebasedThreadSettleDelay !== 'disabled') {
        for (const sessionId of latest.dueRebasedSessionIds) {
          if (latest.settled.has(sessionId) || SidebarOrganization.hasRunningDescendant({ sessionId, sessions: latest.sessions })) continue
          dueSessionIds.add(sessionId)
        }
      }

      latest.settle([...dueSessionIds])
    },
  }

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

  const autoSettleEnabled =
    sessionState.phase === 'ready' &&
    workspaceState.phase === 'ready' &&
    (SidebarOrganization.shouldScanForAutoSettle(preferences) || (preferences.rebasedThreadSettleDelay !== 'disabled' && jjRepositories.data !== undefined))
  const autoSettleRefreshKey = JSON.stringify({
    autoSettleEnabled: preferences.autoSettleEnabled,
    autoSettleDisabledSessionIds: preferences.autoSettleDisabledSessionIds,
    autoSettleSessionIds: preferences.autoSettleSessionIds,
    rebasedThreadSettleDelay: preferences.rebasedThreadSettleDelay,
    dueRebasedSessionIds: rebasedIndex.dueSessionIds,
    sessionPhase: sessionState.phase,
    workspacePhase: workspaceState.phase,
  })
  useAutoSettle({
    client: autoSettleClient,
    enabled: isPrimarySurface && autoSettleEnabled,
    intervalMs: preferences.scanIntervalMinutes * 60_000,
    refreshKey: autoSettleRefreshKey,
  })

  const threadTree = useMemo(() => {
    const listed: SessionSummary[] = []
    for (const sessionId of sessionState.ids) {
      const session = sessionState.byId[sessionId]
      if (
        session === undefined ||
        !isListedUnsentThread({ session, selectedSessionId, draft: unsentDrafts[session.id] }) ||
        draftSessionIds.has(session.id) ||
        ThreadViewModel.isSideChat(session)
      )
        continue
      const workspaceId = SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession)
      if (activeWorkspaceFilter !== null && (workspaceId ?? '') !== activeWorkspaceFilter) continue
      const ownRow = session.parentId !== undefined && !SidebarOrganization.foldsUnderParent(session, sessionState.byId, workspaceBySession)
      listed.push(ownRow ? SidebarOrganization.withoutParent(session) : session)
    }
    return groupThreadChildren({ threads: listed })
  }, [draftSessionIds, activeWorkspaceFilter, sessionState.byId, sessionState.ids, workspaceBySession, selectedSessionId, unsentDrafts])

  useEffect(() => {
    if (!isPrimarySurface || threadToScrollTo === null) return
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
  }, [childrenOpenOverrides, isPrimarySurface, threadToScrollTo, threadTree])

  const sectionEntries = useMemo(
    () =>
      threadTree.roots.map(session => ({
        session,
        workspaceId: SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession),
        activity: {
          id: session.id,
          updatedAt: sessionActivityAt({ session, mutedThreads, finishedAt: finishedAtBySession[session.id], now }),
          // A parent waiting on a running subagent is still active work.
          running: session.running || (threadTree.childrenByRoot.get(session.id) ?? NO_CHILDREN).some(child => child.running),
        },
      })),
    [finishedAtBySession, mutedThreads, now, sessionState.byId, threadTree, workspaceBySession],
  )
  const childThreadEntries = useMemo(
    () =>
      Array.from(threadTree.childrenByRoot.values()).flatMap(children =>
        children.map(session => ({
          session,
          workspaceId: SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession),
          activity: {
            id: session.id,
            updatedAt: sessionActivityAt({ session, mutedThreads, finishedAt: finishedAtBySession[session.id], now }),
            running: session.running,
          },
        })),
      ),
    [finishedAtBySession, mutedThreads, now, sessionState.byId, threadTree, workspaceBySession],
  )
  const detachedThreadEntries = useMemo(
    () =>
      Array.from(threadTree.detachedByMissingAncestor.values()).flatMap(children =>
        children.map(session => ({
          session,
          workspaceId: SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession),
          activity: {
            id: session.id,
            updatedAt: sessionActivityAt({ session, mutedThreads, finishedAt: finishedAtBySession[session.id], now }),
            running: session.running,
          },
        })),
      ),
    [finishedAtBySession, mutedThreads, now, sessionState.byId, threadTree, workspaceBySession],
  )
  const sourceFilteredThreadEntries = useMemo(() => {
    if (threadView.sourceFilter === 'subagents') {
      return [...childThreadEntries, ...sectionEntries.filter(entry => ThreadViewModel.matchesSourceFilter(entry.session, 'subagents'))]
    }
    if (threadView.sourceFilter === 'main') return sectionEntries.filter(entry => ThreadViewModel.matchesSourceFilter(entry.session, 'main'))
    return sectionEntries
  }, [childThreadEntries, sectionEntries, threadView.sourceFilter])
  const sourceFilteredThreadIds = useMemo(() => new Set(sourceFilteredThreadEntries.map(entry => entry.session.id)), [sourceFilteredThreadEntries])
  const currentWorkingThreadIds = useMemo(() => workingThreadIds(sectionEntries), [sectionEntries])
  const inactiveThreadIds = useMemo(
    () =>
      new Set(
        [...sectionEntries, ...childThreadEntries].flatMap(entry =>
          SidebarOrganization.sectionForSession({
            session: entry.activity,
            archivedSessionIds,
            pinnedSessionIds,
            parkedSessionIds,
            settledSessionIds,
            idleSectionOverrides: preferences.idleSectionOverrides,
            now,
            idleMinutes: preferences.idleMinutes,
          }) === 'inactive'
            ? [entry.session.id]
            : [],
        ),
      ),
    [
      archivedSessionIds,
      childThreadEntries,
      now,
      parkedSessionIds,
      pinnedSessionIds,
      preferences.idleMinutes,
      preferences.idleSectionOverrides,
      sectionEntries,
      settledSessionIds,
    ],
  )
  const workingThreadCountsBySource = useMemo(
    () => ({
      all: currentWorkingThreadIds.size + detachedThreadEntries.filter(entry => entry.session.running).length,
      main: sectionEntries.filter(entry => currentWorkingThreadIds.has(entry.session.id) && ThreadViewModel.matchesSourceFilter(entry.session, 'main')).length,
      subagents: [
        ...childThreadEntries,
        ...detachedThreadEntries,
        ...sectionEntries.filter(entry => ThreadViewModel.matchesSourceFilter(entry.session, 'subagents')),
      ].filter(entry => entry.session.running).length,
    }),
    [childThreadEntries, currentWorkingThreadIds, detachedThreadEntries, sectionEntries],
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
    const nextBoundary = [nextIdleAt, nextMuteWake, nextSettledArchiveAt, ThreadViewModel.nextLocalDateBoundary(now)]
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right)[0]
    if (nextBoundary === undefined) return
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, nextBoundary - Date.now() + 1))
    return () => window.clearTimeout(timer)
  }, [nextIdleAt, nextMuteWake, nextSettledArchiveAt, now])

  // A snooze that ran out wakes the thread at once (through `now`); dropping its entry keeps the settings small.
  const mutesAwake = useMemo(() => withoutExpiredMutes(mutedThreads, now), [mutedThreads, now])
  useEffect(() => {
    if (!isPrimarySurface) return
    if (Object.keys(mutesAwake).length !== Object.keys(mutedThreads).length) updatePreferences({ mutedThreads: mutesAwake })
  }, [isPrimarySurface, mutedThreads, mutesAwake, updatePreferences])

  // The Host owns attention now: hand it whatever this browser still holds, then drop the browser copy.
  useEffect(() => {
    if (!isPrimarySurface || migrationStarted.current || !attention.available || sessionState.phase !== 'ready') return
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
  }, [
    attention,
    isPrimarySurface,
    mutedThreads,
    preferences.desktopNotificationsEnabled,
    preferences.notificationCategories,
    sessionState.phase,
    sessions,
    updatePreferences,
  ])

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
          activeWorkspaceFilter === null ||
          (SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession) ?? '') === activeWorkspaceFilter,
      }),
    [
      archivedSessionIds,
      settledSessionIds,
      attentionSessions,
      continuedQuestionSessionIds,
      mutedSessionIds,
      activeWorkspaceFilter,
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
            (activeWorkspaceFilter === null ||
              (SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession) ?? '') === activeWorkspaceFilter)
          )
        })
        .sort((left, right) => right.updatedAt - left.updatedAt),
    [
      archivedSessionIds,
      settledSessionIds,
      attentionSessions,
      mutedSessionIds,
      activeWorkspaceFilter,
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
        excludedSessionIds: allUsageLimitSessionIds,
        matchesWorkspace: session =>
          activeWorkspaceFilter === null ||
          (SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession) ?? '') === activeWorkspaceFilter,
      }),
    [
      approvalNeededIds,
      archivedSessionIds,
      settledSessionIds,
      attentionSessions,
      finishedAtBySession,
      mutedSessionIds,
      needsInputIds,
      activeWorkspaceFilter,
      selectedSession?.id,
      sessionState.byId,
      allUsageLimitSessionIds,
      workspaceBySession,
    ],
  )
  const waitingSessionIds = useStableValue(
    useMemo(() => new Set([...approvalNeededRows, ...needsInputRows].map(session => session.id)), [approvalNeededRows, needsInputRows]),
    StableValueModel.sameSet,
  )
  const attentionLabelsBySession = useMemo(() => {
    const labels = new Map<SessionSummary['id'], readonly ThreadAttentionLabel[]>()
    const addLabel = (sessionId: SessionSummary['id'], label: ThreadAttentionLabel): void => {
      const current = labels.get(sessionId) ?? []
      if (!current.includes(label)) labels.set(sessionId, [...current, label])
    }
    for (const session of turnFinishedRows) addLabel(session.id, 'threadSidebarTurnFinished')
    for (const session of allNeedsResumeRows) addLabel(session.id, 'threadSidebarNeedsResume')
    for (const row of allUsageLimitRows) addLabel(row.session.id, 'threadSidebarNeedsResume')
    for (const session of needsInputRows) addLabel(session.id, 'threadSidebarInputNeeded')
    for (const session of approvalNeededRows) addLabel(session.id, 'threadSidebarApprovalNeeded')
    for (const session of allInterruptedRows) addLabel(session.id, 'threadSidebarInterrupted')
    return labels
  }, [allInterruptedRows, allNeedsResumeRows, allUsageLimitRows, approvalNeededRows, needsInputRows, turnFinishedRows])
  /** A root row carries its own labels plus its children's, which is exactly what its row badge shows. */
  const attentionLabelsByRow = useMemo(() => {
    const labels = new Map<SessionSummary['id'], readonly ThreadAttentionLabel[]>(attentionLabelsBySession)
    for (const { session } of sectionEntries) {
      const childLabels = (threadTree.childrenByRoot.get(session.id) ?? NO_CHILDREN).flatMap(child => attentionLabelsBySession.get(child.id) ?? [])
      if (childLabels.length === 0) continue
      labels.set(session.id, [...(labels.get(session.id) ?? []), ...childLabels])
    }
    return labels
  }, [attentionLabelsBySession, sectionEntries, threadTree])
  const threadViewAttentionEntries = useMemo(() => {
    // A tab's dot follows the dots its rows draw, and a row's dot shows only its own state: a child's label lights
    // the tab only in views that list that child.
    const entryFor = (entry: (typeof sectionEntries)[number] | (typeof childThreadEntries)[number] | (typeof detachedThreadEntries)[number]) => {
      const attentionLabel = ThreadViewModel.mostUrgentAttentionLabel(attentionLabelsBySession.get(entry.session.id) ?? [])
      return {
        thread: entry.session,
        attentionLabel,
        unread: attention.records.has(entry.session.id),
        running: entry.session.running,
        inactive: inactiveThreadIds.has(entry.session.id),
        archived: archivedSessionIds.has(entry.session.id),
        settled: settledSessionIds.has(entry.session.id),
        muted: mutedSessionIds.has(entry.session.id),
      }
    }
    return [...sectionEntries.map(entryFor), ...childThreadEntries.map(entryFor), ...detachedThreadEntries.map(entryFor)]
  }, [
    archivedSessionIds,
    attention.records,
    attentionLabelsBySession,
    childThreadEntries,
    inactiveThreadIds,
    detachedThreadEntries,
    mutedSessionIds,
    sectionEntries,
    settledSessionIds,
  ])
  const attentionLabelByViewId = useMemo(
    () => new Map(threadViewSettings.views.map(view => [view.id, ThreadViewPreferencesModel.attentionLabelForPreset(view, threadViewAttentionEntries)])),
    [threadViewAttentionEntries, threadViewSettings.views],
  )
  const unreadCountByViewId = useMemo(
    () => new Map(threadViewSettings.views.map(view => [view.id, ThreadViewPreferencesModel.unreadCountForPreset(view, threadViewAttentionEntries)])),
    [threadViewAttentionEntries, threadViewSettings.views],
  )
  const [viewTabRow, setViewTabRow] = useState<HTMLDivElement | null>(null)
  const [fullViewTabs, setFullViewTabs] = useState<HTMLDivElement | null>(null)
  const compactViewTabs = useCompactViewTabs(viewTabRow, fullViewTabs)
  const viewTabs = threadViewSettings.views
    .filter(view => view.enabled)
    .map(view => {
      // A view that lists working threads counts them, whatever else it also lists; an unread count there read as a
      // wrong number of working threads.
      const workingCount = view.statusFilters.includes('working') ? workingThreadCountsBySource[view.sourceFilter] : null
      const unreadCount = unreadCountByViewId.get(view.id) ?? 0
      return {
        view,
        label: threadViewPresetLabel(view, props.tSidebar),
        attentionLabel: attentionLabelByViewId.get(view.id),
        visibleCount: view.showCount === false ? null : (workingCount ?? (unreadCount > 0 ? unreadCount : null)),
      }
    })
  const visibleThreadEntries = useMemo(
    () =>
      sourceFilteredThreadEntries.filter(entry =>
        ThreadViewModel.matchesStatusFilter({
          filters: threadView.statusFilters,
          // A subagent row reports its own state; a root row reports its children's, so a finished child keeps its
          // parent in the view that names that label.
          labels: attentionLabelsByRow.get(entry.session.id) ?? [],
          unread: attention.records.has(entry.session.id),
          running: threadView.sourceFilter === 'subagents' ? entry.activity.running : currentWorkingThreadIds.has(entry.session.id),
          inactive: inactiveThreadIds.has(entry.session.id),
          archived: archivedSessionIds.has(entry.session.id),
          settled: settledSessionIds.has(entry.session.id),
          muted: mutedSessionIds.has(entry.session.id),
        }),
      ),
    [
      archivedSessionIds,
      settledSessionIds,
      attention.records,
      attentionLabelsByRow,
      currentWorkingThreadIds,
      inactiveThreadIds,
      mutedSessionIds,
      sourceFilteredThreadEntries,
      threadView.sourceFilter,
      threadView.statusFilters,
    ],
  )
  const groupedAttentionRows = useMemo(() => {
    const filterRows = (rows: readonly SessionSummary[], label: ThreadAttentionLabel): SessionSummary[] => {
      if (threadView.groupBy !== 'status' || isBoard) return []
      return rows.filter(
        session =>
          sourceFilteredThreadIds.has(session.id) &&
          ThreadViewModel.matchesStatusFilter({
            filters: threadView.statusFilters,
            running: threadView.sourceFilter === 'subagents' ? session.running : currentWorkingThreadIds.has(session.id),
            labels: [label],
            unread: attention.records.has(session.id),
            archived: archivedSessionIds.has(session.id),
            settled: settledSessionIds.has(session.id),
            // Attention rows already leave muted threads out.
            muted: false,
          }),
      )
    }
    return {
      approvalNeeded: preferences.approvalNeededDisplay === 'group' ? filterRows(approvalNeededRows, 'threadSidebarApprovalNeeded') : [],
      inputNeeded: preferences.inputNeededDisplay === 'group' ? filterRows(needsInputRows, 'threadSidebarInputNeeded') : [],
      turnFinished: preferences.turnFinishedDisplay === 'group' ? filterRows(turnFinishedRows, 'threadSidebarTurnFinished') : [],
    }
  }, [
    archivedSessionIds,
    settledSessionIds,
    approvalNeededRows,
    attention.records,
    currentWorkingThreadIds,
    isBoard,
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
          labels: ['threadSidebarNeedsResume'],
          unread: attention.records.has(session.id),
          archived: archivedSessionIds.has(session.id),
          settled: settledSessionIds.has(session.id),
          muted: mutedSessionIds.has(session.id),
        }),
      ),
    [
      archivedSessionIds,
      attention.records,
      settledSessionIds,
      currentWorkingThreadIds,
      mutedSessionIds,
      needsResumeRows,
      threadView.sourceFilter,
      threadView.statusFilters,
    ],
  )
  const sourceFilteredInterruptedRows = useMemo(
    () =>
      allInterruptedRows.filter(session => {
        if (threadView.sourceFilter !== 'main') return ThreadViewModel.matchesSourceFilter(session, threadView.sourceFilter)
        const rootId = Array.from(threadTree.childrenByRoot).find(([, children]) => children.some(child => child.id === session.id))?.[0]
        const root = sectionEntries.find(entry => entry.session.id === rootId)?.session
        return ThreadViewModel.matchesAttentionSourceFilter({ thread: session, rootThread: root, sourceFilter: threadView.sourceFilter })
      }),
    [allInterruptedRows, sectionEntries, threadTree, threadView.sourceFilter],
  )
  const statusFilteredInterruptedRows = useMemo(
    () =>
      sourceFilteredInterruptedRows.filter(session =>
        ThreadViewModel.matchesStatusFilter({
          filters: threadView.statusFilters,
          running: threadView.sourceFilter === 'subagents' ? session.running : currentWorkingThreadIds.has(session.id),
          labels: ['threadSidebarInterrupted'],
          unread: attention.records.has(session.id),
          archived: archivedSessionIds.has(session.id),
          settled: settledSessionIds.has(session.id),
          muted: mutedSessionIds.has(session.id),
        }),
      ),
    [
      archivedSessionIds,
      attention.records,
      settledSessionIds,
      currentWorkingThreadIds,
      sourceFilteredInterruptedRows,
      mutedSessionIds,
      threadView.sourceFilter,
      threadView.statusFilters,
    ],
  )
  const statusFilteredUsageLimitRows = useMemo(
    () =>
      usageLimitRows.filter(row =>
        ThreadViewModel.matchesStatusFilter({
          filters: threadView.statusFilters,
          running: threadView.sourceFilter === 'subagents' ? row.session.running : currentWorkingThreadIds.has(row.session.id),
          labels: ['threadSidebarNeedsResume'],
          unread: attention.records.has(row.session.id),
          archived: archivedSessionIds.has(row.session.id),
          settled: settledSessionIds.has(row.session.id),
          muted: mutedSessionIds.has(row.session.id),
        }),
      ),
    [
      archivedSessionIds,
      attention.records,
      settledSessionIds,
      currentWorkingThreadIds,
      mutedSessionIds,
      threadView.sourceFilter,
      threadView.statusFilters,
      usageLimitRows,
    ],
  )
  // The board shows only columns: recovery threads stay in their status column instead of a group above it.
  const hoistedInterruptedRows = isBoard ? EMPTY_HOISTED_SESSIONS : statusFilteredInterruptedRows
  const hoistedNeedsResumeRows = isBoard ? EMPTY_HOISTED_SESSIONS : statusFilteredNeedsResumeRows
  const hoistedUsageLimitRows = isBoard ? EMPTY_HOISTED_USAGE_LIMIT_ROWS : statusFilteredUsageLimitRows
  const hasHoistedGroups = hoistedInterruptedRows.length > 0 || hoistedNeedsResumeRows.length > 0 || hoistedUsageLimitRows.length > 0
  const statusFilteredRecoveryRows = useMemo(
    () => [...hoistedInterruptedRows, ...hoistedNeedsResumeRows, ...hoistedUsageLimitRows.map(row => row.session)],
    [hoistedInterruptedRows, hoistedNeedsResumeRows, hoistedUsageLimitRows],
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
      if (isBoard) {
        for (const [sessionId, sessionLabels] of attentionLabelsBySession) {
          const label = ThreadViewModel.mostUrgentAttentionLabel(sessionLabels)
          if (label !== undefined) labels.set(sessionId, label)
        }
        return labels
      }
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
      attentionLabelsBySession,
      isBoard,
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
    const archivedShown = DetachedThreadsModel.showsArchived(threadView.statusFilters)
    return [...threadTree.detachedByMissingAncestor.entries()]
      .map(([missingAncestorId, children]) => {
        const listed = children.filter(
          child =>
            (archivedShown || !archivedSessionIds.has(child.id)) &&
            !attentionIds.has(child.id) &&
            ThreadViewModel.matchesStatusFilter({
              filters: threadView.statusFilters,
              running: child.running,
              labels: attentionLabelsBySession.get(child.id) ?? [],
              unread: attention.records.has(child.id),
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
        return {
          missingAncestorId,
          live,
          finished,
          selectedChildId,
          count: live.length + finished.length,
          threadIds: listed.map(child => child.id),
          branchAction: DetachedThreadsModel.actionFor(listed.map(child => ({ archived: archivedSessionIds.has(child.id) }))),
        }
      })
      .filter(group => group.count > 0)
  }, [
    archivedSessionIds,
    attention.records,
    attentionIds,
    attentionLabelsBySession,
    mutedSessionIds,
    settledSessionIds,
    preferences.finishedSubagents,
    selectedSession?.id,
    threadTree,
    threadView.sourceFilter,
    threadView.statusFilters,
    waitingSessionIds,
  ])

  const orderedSections = useMemo(() => SidebarOrganization.orderSections(preferences.sectionOrder), [preferences.sectionOrder])
  // The board has no separate Remote threads group: remote threads join the columns they belong to.
  const separatesRemoteThreads = preferences.separateRemoteThreads && !isBoard
  const visibleRemoteThreads = useMemo(
    () =>
      separatesRemoteThreads || threadView.sourceFilter === 'subagents'
        ? []
        : remoteThreads.filter(thread =>
            ThreadViewModel.matchesStatusFilter({
              filters: threadView.statusFilters,
              running: thread.running,
              labels: [],
              unread: false,
              archived: false,
              settled: false,
              muted: false,
            }),
          ),
    [separatesRemoteThreads, remoteThreads, threadView.sourceFilter, threadView.statusFilters],
  )
  const remoteRowsBySection = useMemo(() => {
    const rows = new Map<SidebarSection, RemoteSidebarThread[]>(SIDEBAR_SECTIONS.map(section => [section, []]))
    for (const thread of visibleRemoteThreads) {
      const section = SidebarOrganization.sectionForSession({
        session: { id: SessionId(`remote:${thread.runtimeId}:${thread.sessionId}`), running: thread.running, updatedAt: thread.updatedAt },
        archivedSessionIds: EMPTY_SESSION_IDS,
        pinnedSessionIds: EMPTY_SESSION_IDS,
        parkedSessionIds: EMPTY_SESSION_IDS,
        settledSessionIds: EMPTY_SESSION_IDS,
        now,
        idleMinutes: preferences.idleMinutes,
      })
      rows.get(section)?.push(thread)
    }
    for (const entries of rows.values()) entries.sort((left, right) => right.updatedAt - left.updatedAt)
    return rows
  }, [now, preferences.idleMinutes, visibleRemoteThreads])
  const activityAtBySessionId = useMemo(() => new Map(visibleThreadEntries.map(entry => [entry.session.id, entry.activity.updatedAt])), [visibleThreadEntries])
  const rowsBySection = useMemo(() => {
    const rows = new Map<SidebarSection, SessionSummary[]>(SIDEBAR_SECTIONS.map(section => [section, []]))
    for (const { session, activity } of visibleThreadEntries) {
      if (attentionIds.has(session.id)) continue
      const section = SidebarOrganization.sectionForSession({
        session: activity,
        archivedSessionIds,
        pinnedSessionIds,
        parkedSessionIds,
        settledSessionIds,
        idleSectionOverrides: preferences.idleSectionOverrides,
        now,
        idleMinutes: preferences.idleMinutes,
      })
      rows.get(section)?.push(session)
    }
    for (const entries of rows.values())
      entries.sort((left, right) => (activityAtBySessionId.get(right.id) ?? right.updatedAt) - (activityAtBySessionId.get(left.id) ?? left.updatedAt))
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
    settledSessionIds,
    preferences.idleMinutes,
    preferences.idleSectionOverrides,
    activityAtBySessionId,
    visibleThreadEntries,
    workspaceState.pinnedSessionIds,
  ])
  // Empty sections fold away rather than render a header, so a drag only reorders the ones on screen.
  const shownSections = useMemo(
    () =>
      orderedSections.filter(section => {
        if (section === 'active') return true
        if (section === 'remote') return preferences.separateRemoteThreads && props.openRemoteThreads !== undefined
        return (rowsBySection.get(section)?.length ?? 0) + (remoteRowsBySection.get(section)?.length ?? 0) > 0
      }),
    [orderedSections, preferences.separateRemoteThreads, props.openRemoteThreads, remoteRowsBySection, rowsBySection],
  )
  const sectionHeaderRefs = useRef<(HTMLButtonElement | null)[]>([])
  const sectionDragRef = useRef<{ pointerId: number; from: number; startY: number; centers: number[] | null } | null>(null)
  const suppressSectionClick = useRef(false)
  const [sectionDrag, setSectionDrag] = useState<{ from: number; to: number } | null>(null)
  const [rowDrag, setRowDrag] = useState<{ sessionId: SessionSummary['id']; section: SidebarSection } | null>(null)
  const [rowDropSection, setRowDropSection] = useState<SidebarSection | null>(null)
  const rowDragRef = useRef<{ sessionId: SessionSummary['id']; section: SidebarSection } | null>(null)
  const rowDropSectionRef = useRef<SidebarSection | null>(null)
  const suppressRowClick = useRef(false)
  const moveThreadsToSectionRef = useRef(moveThreadsToSection)
  moveThreadsToSectionRef.current = moveThreadsToSection
  // A dropped row lands in a section that is already on screen: revealing the empty ones during the gesture would
  // re-parent the dragged row, and the browser cancels a native drag whose source node moves.
  const renderedSections = useMemo(
    () =>
      sectionDrag === null
        ? shownSections
        : SidebarOrganization.reorderSections({
            savedOrder: orderedSections,
            shownSections,
            fromShownIndex: sectionDrag.from,
            toShownIndex: sectionDrag.to,
          }).filter(section => shownSections.includes(section)),
    [shownSections, orderedSections, sectionDrag],
  )
  const endSectionDrag = (): void => {
    sectionDragRef.current = null
    setSectionDrag(null)
  }
  const commitSectionOrder = (fromShownIndex: number, toShownIndex: number): void => {
    if (fromShownIndex === toShownIndex) return
    changePreferences({
      sectionOrder: SidebarOrganization.reorderSections({ savedOrder: orderedSections, shownSections, fromShownIndex, toShownIndex }),
    })
  }
  /**
   * A thread row is `draggable` so it can be dropped into the composer as a mention, and the browser's own drag
   * suppresses pointer events for the gesture, so moving a row between sections rides the same native
   * dragstart/dragover/drop stream instead of a pointer gesture that never sees the move.
   */
  useEffect(() => {
    const sectionAt = (clientX: number, clientY: number): { readonly element: Element | null; readonly section: SidebarSection } | null => {
      const element = document.elementFromPoint(clientX, clientY)
      const section = element instanceof Element ? element.closest<HTMLElement>('[data-thread-section]')?.dataset.threadSection : undefined
      return isSidebarSection(section) ? { element, section } : null
    }
    const onDragStart = (event: DragEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      const row = target.closest<HTMLElement>('article[data-thread-id][data-thread-section-row]')
      if (row === null || threadSurfaceOf(row) !== surface) return
      const section = row.closest<HTMLElement>('[data-thread-section]')?.dataset.threadSection
      const threadId = row.dataset.threadId
      if (!isSidebarSection(section) || threadId === undefined) return
      const sessionId = SessionId(threadId)
      rowDragRef.current = { sessionId, section }
      setRowDrag({ sessionId, section })
    }
    const onDragOver = (event: DragEvent): void => {
      if (rowDragRef.current === null) return
      const target = sectionAt(event.clientX, event.clientY)
      const next = target !== null && threadSurfaceOf(target.element) === surface ? target.section : null
      if (next === null) {
        rowDropSectionRef.current = null
        setRowDropSection(current => (current === null ? current : null))
        return
      }
      // Without preventDefault the browser refuses the drop and no `drop` event ever fires.
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
      rowDropSectionRef.current = next
      setRowDropSection(current => (current === next ? current : next))
    }
    const endRowDrag = (): void => {
      rowDragRef.current = null
      rowDropSectionRef.current = null
      setRowDrag(null)
      setRowDropSection(null)
    }
    const onDrop = (event: DragEvent): void => {
      const current = rowDragRef.current
      if (current === null) return
      const target = sectionAt(event.clientX, event.clientY)
      const droppedOn = target !== null && threadSurfaceOf(target.element) === surface ? target.section : null
      if (droppedOn === null) {
        endRowDrag()
        return
      }
      event.preventDefault()
      endRowDrag()
      // The click that ends a drop belongs to the drag, not to the row it started on.
      suppressRowClick.current = true
      window.setTimeout(() => {
        suppressRowClick.current = false
      }, 0)
      if (droppedOn !== current.section) void moveThreadsToSectionRef.current(current.sessionId, droppedOn)
    }
    window.addEventListener('dragstart', onDragStart, true)
    window.addEventListener('dragover', onDragOver, true)
    window.addEventListener('drop', onDrop, true)
    window.addEventListener('dragend', endRowDrag, true)
    return () => {
      window.removeEventListener('dragstart', onDragStart, true)
      window.removeEventListener('dragover', onDragOver, true)
      window.removeEventListener('drop', onDrop, true)
      window.removeEventListener('dragend', endRowDrag, true)
    }
  }, [surface])
  const groupedThreadEntries = useMemo(() => {
    if (threadView.groupBy === 'status') return []
    const entries: SidebarGroupedViewEntry[] = [
      ...visibleThreadEntries
        .filter(entry => !attentionIds.has(entry.session.id))
        .map((entry): SidebarGroupedViewEntry => ({
          thread: { kind: 'local', session: entry.session, updatedAt: entry.activity.updatedAt },
          workspaceId: entry.workspaceId,
          activityAt: entry.activity.updatedAt,
        })),
      ...visibleRemoteThreads.map((thread): SidebarGroupedViewEntry => ({
        thread: { kind: 'remote', remote: thread, updatedAt: thread.updatedAt },
        workspaceId: thread.workspaceId,
        activityAt: thread.updatedAt,
      })),
    ]
    const workspaceTitles = new Map<string, string>(displayWorkspaces.map(workspace => [workspace.id, workspace.title]))
    for (const thread of visibleRemoteThreads) {
      if (thread.workspaceId !== undefined && thread.workspaceTitle !== undefined) workspaceTitles.set(thread.workspaceId, thread.workspaceTitle)
    }
    return ThreadViewModel.groupEntries({
      groupBy: threadView.groupBy,
      entries,
      workspaceTitles,
      localProjectIds: new Set(displayWorkspaces.map(workspace => workspace.id)),
      unassignedTitle: tSidebar('threadSidebarUnassigned'),
      dateTitles: {
        today: tSidebar('threadSidebarToday'),
        yesterday: tSidebar('threadSidebarYesterday'),
        lastSevenDays: tSidebar('threadSidebarLast7Days'),
        older: tSidebar('threadSidebarOlder'),
      },
      now,
    })
  }, [attentionIds, displayWorkspaces, now, tSidebar, threadView.groupBy, visibleRemoteThreads, visibleThreadEntries])

  const rowStyle = useMemo<RowStyle>(
    () => ({
      density: preferences.threadRowDensity,
      project: preferences.threadRowProject,
      projectColor: preferences.threadRowProjectColor,
      projectPalette: preferences.projectColorPalette,
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

  const projectFilterValue = activeWorkspaceFilter === null ? ALL_PROJECTS : activeWorkspaceFilter.length === 0 ? UNASSIGNED_PROJECT : activeWorkspaceFilter

  const selectProject = (value: string): void => {
    setSettingsOpen(false)
    const projectFilter = value === ALL_PROJECTS ? null : value === UNASSIGNED_PROJECT ? '' : value
    if (isBoard) storedThreadBoardView.set(ThreadBoardViewModel.update(boardViewSettings, { projectFilter }))
    else changePreferences({ workspaceFilter: projectFilter })
  }

  const projectOptions: readonly ComboboxOption[] = [
    { value: ALL_PROJECTS, label: props.tSidebar('threadSidebarAllProjects') },
    { value: UNASSIGNED_PROJECT, label: props.tSidebar('threadSidebarUnassigned') },
    ...displayWorkspaces.map(workspace => ({ value: workspace.id, label: workspace.title })),
  ]

  const projectFilterLabel = projectOptions.find(option => option.value === projectFilterValue)?.label ?? props.tSidebar('threadSidebarAllProjects')
  const showGroupControl = isBoard || threadViewSettings.showGroupControl
  const showFilterControl = isBoard || threadViewSettings.showFilterControl

  const updateThreadView = (patch: Partial<ThreadViewPreferences>): void => {
    if (isBoard) {
      storedThreadBoardView.set(ThreadBoardViewModel.update(boardViewSettings, patch))
      return
    }
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
    selection: () => selectionRef.current,
    selectForContext: selectRowForContext,
    clearSelection: clearThreadSelection,
    batch: batchSnapshot,
    batchMutate,
    batchSetParked,
    batchSetSettled,
    batchMute,
    batchUnmute,
    batchMarkUnread,
    batchCopyLinks,
    mutateSession,
    toggleParked,
    toggleSettled,
    settleSessions,
    moveThreadsToSection,
    copyContextValue,
    resumeRecoverySession,
    dismissRecoverySession,
    renameSession: renameThread,
    beginRename,
    cancelRename,
    markAttentionUnread: attention.markUnread,
    startFollowUp: props.startFollowUp,
    continueThreadIn,
    notifyThread,
    props,
    sessionsById: sessionState.byId,
    preferences,
    changePreferences,
  })
  latestRowActions.current = {
    openThread,
    openAside: asideOpener,
    selection: () => selectionRef.current,
    selectForContext: selectRowForContext,
    clearSelection: clearThreadSelection,
    batch: batchSnapshot,
    batchMutate,
    batchSetParked,
    batchSetSettled,
    batchMute,
    batchUnmute,
    batchMarkUnread,
    batchCopyLinks,
    mutateSession,
    toggleParked,
    toggleSettled,
    settleSessions,
    moveThreadsToSection,
    copyContextValue,
    resumeRecoverySession,
    dismissRecoverySession,
    renameSession: renameThread,
    beginRename,
    cancelRename,
    markAttentionUnread: attention.markUnread,
    startFollowUp: props.startFollowUp,
    continueThreadIn,
    notifyThread,
    props,
    sessionsById: sessionState.byId,
    preferences,
    changePreferences,
  }
  useEffect(() => {
    if (!isPrimarySurface) return
    PaletteBridge.setRecentLimit(preferences.paletteRecentLimit)
  }, [isPrimarySurface, preferences.paletteRecentLimit])
  useEffect(() => {
    if (!isPrimarySurface) return
    return () => PaletteBridge.setRecentLimit(PaletteBridge.defaultRecentLimit)
  }, [isPrimarySurface])
  useEffect(() => {
    if (!isPrimarySurface) return
    const actions: readonly PaletteAction[] = [
      createNotificationSoundPaletteAction(latestRowActions.current.props.tSidebar),
      createNotificationSnoozePaletteAction(latestRowActions.current.props.tSidebar),
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
    return PaletteBridge.addActions(actions)
  }, [asideOpener, isPrimarySurface])
  // One stable object for every row; it reads the latest closures so memoized rows never go stale.
  const rowActions = useMemo<RowActions>(() => {
    return {
      open: sessionId => latestRowActions.current.openThread(sessionId),
      selection: () => latestRowActions.current.selection(),
      selectForContext: sessionId => latestRowActions.current.selectForContext(sessionId),
      clearSelection: () => latestRowActions.current.clearSelection(),
      batch: () => latestRowActions.current.batch(),
      batchMutate: operation => latestRowActions.current.batchMutate(operation),
      batchSetParked: park => latestRowActions.current.batchSetParked(park),
      batchSetSettled: settle => latestRowActions.current.batchSetSettled(settle),
      batchMute: option => latestRowActions.current.batchMute(option),
      batchUnmute: () => latestRowActions.current.batchUnmute(),
      batchMarkUnread: () => latestRowActions.current.batchMarkUnread(),
      batchCopyLinks: () => latestRowActions.current.batchCopyLinks(),
      mutate: (sessionId, operation) => latestRowActions.current.mutateSession(sessionId, operation),
      toggleParked: sessionId => latestRowActions.current.toggleParked(sessionId),
      toggleSettled: sessionId => latestRowActions.current.toggleSettled(sessionId),
      moveToSection: (sessionId, section) => void latestRowActions.current.moveThreadsToSection(sessionId, section),
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
      followUp: (sessionId, workspaceId) => latestRowActions.current.startFollowUp(sessionId, workspaceId),
      continueIn: (sessionId, projectId) => void latestRowActions.current.continueThreadIn(sessionId, projectId),
      resume: sessionId => void latestRowActions.current.resumeRecoverySession(sessionId),
      dismissRecovery: sessionId => void latestRowActions.current.dismissRecoverySession(sessionId),
      beginRename: sessionId => latestRowActions.current.beginRename(sessionId),
      rename: (sessionId, title) => void latestRowActions.current.renameSession(sessionId, title),
      cancelRename: () => latestRowActions.current.cancelRename(),
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

  useEffect(() => {
    const list = scrollAreaRef.current
    if (list === null) return
    ThreadSelectionModel.applyToDom({ list, sessionIds: threadSelection.sessionIds })
    if (threadSelection.sessionIds.length === 0) return
    const observer = new MutationObserver(() => ThreadSelectionModel.applyToDom({ list, sessionIds: threadSelection.sessionIds }))
    observer.observe(list, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [threadSelection.sessionIds])

  const orderedVisibleThreadIds = (list: HTMLElement): string[] => ThreadListNavigationModel.visibleRows(list).map(row => row.id)

  const navigateThreadList = (event: KeyboardEvent): void => {
    const list = scrollAreaRef.current
    if (list === null) return
    ThreadListNavigationModel.navigate({
      event,
      list,
      selection: threadSelection,
      onSelectionChange: setThreadSelection,
      arrowKeysSwitchThread: preferences.arrowKeysSwitchThread,
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

  const handleSelectionClickCapture = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // The click a pointer drag produces on release belongs to the drag, not to the row it started on.
    if (suppressRowClick.current) {
      suppressRowClick.current = false
      event.preventDefault()
      event.stopPropagation()
      return
    }
    const target = event.target
    if (!(target instanceof Element)) return
    if (isThreadSelectionBackgroundClick({ target, surface: event.currentTarget })) {
      if (!event.shiftKey && !event.metaKey && !event.ctrlKey && threadSelection.sessionIds.length > 0) {
        setThreadSelection(EMPTY_THREAD_SELECTION)
      }
      return
    }
    const rowButton = target.closest<HTMLButtonElement>(THREAD_MAIN_BUTTON_SELECTOR)
    if (rowButton === null || !event.currentTarget.contains(rowButton)) return
    const sessionId = rowButton.dataset.threadId
    if (sessionId === undefined) return
    if (event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      const orderedIds = orderedVisibleThreadIds(event.currentTarget)
      setThreadSelection(current =>
        ThreadSelectionModel.extend({
          state: current,
          orderedIds,
          sessionId,
          fallbackAnchorId: current.anchorId ?? selectedSession?.id ?? sessionId,
        }),
      )
      return
    }
    if (event.metaKey || event.ctrlKey) {
      event.preventDefault()
      event.stopPropagation()
      setThreadSelection(current => ThreadSelectionModel.toggle(current, sessionId))
      return
    }
    if (threadSelection.sessionIds.length > 0) setThreadSelection(EMPTY_THREAD_SELECTION)
  }

  /** Right-clicking outside a batch starts a new single-row selection; inside it, the batch survives. */
  const handleSelectionContextMenuCapture = (event: ReactMouseEvent<HTMLDivElement>): void => {
    const target = event.target
    if (!(target instanceof Element)) return
    const rowButton = target.closest<HTMLButtonElement>(THREAD_MAIN_BUTTON_SELECTOR)
    if (rowButton === null || !event.currentTarget.contains(rowButton)) return
    const sessionId = rowButton.dataset.threadId
    if (sessionId === undefined) return
    selectRowForContext(SessionId(sessionId))
  }

  const selectedSessionIds = threadSelection.sessionIds
  const allSelectedPinned = selectedSessionIds.length > 0 && selectedSessionIds.every(sessionId => pinnedSessionIds.has(sessionId))
  const allSelectedSettled = selectedSessionIds.length > 0 && selectedSessionIds.every(sessionId => settledSessionIds.has(SessionId(sessionId)))
  const applyToSelection = async (operation: RowOperation): Promise<void> => {
    const targetIds = selectedSessionIds.flatMap(sessionId => {
      const session = sessionState.byId[SessionId(sessionId)]
      return session === undefined ? [] : [session.id]
    })
    if (targetIds.length === 0) return
    if (await mutateThreads(targetIds, operation)) setThreadSelection(EMPTY_THREAD_SELECTION)
  }
  const settleSelection = (): void => {
    const targets = new Set<SessionSummary['id']>()
    const actionThreads = Object.values(sessionState.byId).filter(session => !session.blank)
    for (const sessionId of selectedSessionIds) {
      const session = sessionState.byId[SessionId(sessionId)]
      if (session === undefined) continue
      for (const targetId of threadActionTargetIds({
        threadId: session.id,
        threads: actionThreads,
        cascadeToChildren: preferences.applyActionsToChildThreads,
      })) {
        if (!settledSessionIds.has(targetId)) targets.add(targetId)
      }
    }
    if (targets.size === 0) {
      setThreadSelection(EMPTY_THREAD_SELECTION)
      return
    }
    if ([...targets].some(sessionId => SidebarOrganization.hasRunningDescendant({ sessionId, sessions }))) {
      setNotice({ tone: 'warning', message: props.tSidebar('threadSidebarRunningNotice') })
      return
    }
    settleSessions([...targets])
    setNotice({ tone: 'success', message: props.tSidebar('threadSidebarSettledNotice') })
    setThreadSelection(EMPTY_THREAD_SELECTION)
  }

  const renderThreadRow = (session: SessionSummary, attentionLabel: ThreadRowProps['attentionLabel'], section?: SidebarSection): JSX.Element => {
    const lineage = SidebarOrganization.sessionLineage(session, sessionState.byId)
    const workspaceId = SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession)
    // Derived once per parent change: an untouched parent keeps the arrays its row already holds, so memo holds.
    const childRow = childRowCache.resolve({
      children: threadTree.childrenByRoot.get(session.id) ?? NO_CHILDREN,
      groupedAttentionIds: attentionIds,
      listChildren: threadView.sourceFilter !== 'main',
      mode: preferences.finishedSubagents,
      waitingSessionIds,
      selectedSessionId: selectedSession?.id,
    })
    const rowAttentionLabel = attentionLabel ?? inlineAttentionLabels.get(session.id)
    const realWorkspaceId = realWorkspaceBySession.get(session.id)
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
        section={section}
        dragging={rowDrag?.sessionId === session.id}
        selected={selectedSession?.id === session.id}
        parentTitle={lineage.parentTitle}
        workspaceId={workspaceId}
        workspaceTitle={workspaceId === undefined ? undefined : workspaceTitleById.get(workspaceId)}
        workspaceName={realWorkspaceId === undefined || realWorkspaceId === workspaceId ? undefined : workspaceNameById.get(realWorkspaceId)}
        machine={machine}
        age={formatAge(session.updatedAt)}
        mute={mutedSessionIds.has(session.id) ? mutedThreads[session.id] : undefined}
        attentionLabel={rowAttentionLabel}
        rebasedAt={rebasedIndex.rebasedAtBySessionId.get(session.id)}
        integrationQueuedAt={integrationQueuedAtBySessionId.get(session.id)}
        needsResume={recoverySessionIds.has(session.id)}
        resumeBusy={resumeBusySessionIds.has(session.id)}
        renaming={renamingSessionId === session.id}
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
  const renderRemoteThreadRow = (thread: RemoteSidebarThread): JSX.Element => (
    <RemoteThreadItem
      key={`${thread.runtimeId}:${thread.sessionId}`}
      runtimeId={thread.runtimeId}
      sessionId={thread.sessionId}
      label={thread.title}
      cwd={thread.cwd}
      hostName={thread.hostName}
      connected={thread.connected}
      onOpen={() => (props.openRemoteSession === undefined ? props.openRemoteThreads?.() : props.openRemoteSession(thread.sessionId))}
    />
  )

  useEffect(() => {
    if (!isPrimarySurface || sessionState.phase !== 'ready') return
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
  }, [isPrimarySurface, tSidebar, selectedSession?.id, sessionStatus, sessionState.phase, sessions])

  // Host attention records carry the latest finish reason and sequence, so an acknowledged row can still be deduped by event id.
  useEffect(() => {
    if (!isPrimarySurface) return
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
  }, [attention.records, isPrimarySurface, selectedSession?.id, sessionStatus, sessions, tSidebar])

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
          {isThreadNotification ? (
            <SidebarNotificationDismissButton label={props.tSidebar('threadSidebarDismissNotification')} onDismiss={() => setNotice(null)} />
          ) : null}
        </div>
      </Alert>
    )

  return (
    <TooltipProvider delayDuration={500}>
      <section
        className={cn('dshx-root dshx:relative dshx:flex dshx:h-full dshx:w-full dshx:min-h-0 dshx:min-w-0 dshx:flex-col', shiftPressed && 'dshx:select-none')}
        aria-label={props.tSidebar(isBoard ? 'threadSidebarBoardTitle' : 'threadSidebarTitle')}
        data-thread-surface={surface}
        onClickCapture={handleSelectionClickCapture}
        onContextMenuCapture={handleSelectionContextMenuCapture}
      >
        <header className={cn('dshx:px-2 dshx:py-1', isBoard && 'dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-2 dshx:border-b dshx:px-4 dshx:py-2.5')}>
          {isBoard ? <h1 className="dshx:text-base dshx:font-semibold">{props.tSidebar('threadSidebarBoardTitle')}</h1> : null}
          <div className={cn('dshx:flex dshx:items-center dshx:gap-1', isBoard && 'dshx:shrink-0')}>
            <Combobox
              contentClassName="dshx:w-(--radix-popover-trigger-width) dshx:min-w-56"
              emptyLabel={props.tSidebar('threadSidebarProjectSearchEmpty')}
              label={props.tSidebar('threadSidebarProjectFilter')}
              onValueChange={selectProject}
              options={projectOptions}
              searchAbove={0}
              searchLabel={props.tSidebar('threadSidebarProjectSearch')}
              searchPlaceholder={props.tSidebar('threadSidebarProjectSearchPlaceholder')}
              triggerClassName={cn(
                'dshx:h-8 dshx:min-w-0 dshx:justify-between dshx:border-0 dshx:bg-transparent dshx:px-2.5 dshx:font-medium dshx:hover:bg-accent',
                isBoard ? 'dshx:w-56 dshx:text-sm' : 'dshx:flex-1 dshx:text-base',
              )}
              triggerContent={
                <>
                  <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{projectFilterLabel}</span>
                  <span className="dshx:inline-flex dshx:text-muted-foreground" aria-hidden="true">
                    <IconChevronDownOutlineRegular size={14} />
                  </span>
                </>
              }
              value={projectFilterValue}
            />
            {isBoard ? null : (
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
            )}
          </div>
          <div
            ref={setViewTabRow}
            role="group"
            className={cn('dshx:flex dshx:gap-1', compactViewTabs ? 'dshx:overflow-x-hidden' : 'dshx:overflow-x-auto', !isBoard && 'dshx:pt-1')}
            aria-label={props.tSidebar('threadSidebarListView')}
            data-compact-view-tabs={compactViewTabs ? '' : undefined}
            onKeyDown={event => navigateThreadList(event.nativeEvent)}
            hidden={isBoard}
          >
            {viewTabs.map(({ view, label, attentionLabel, visibleCount }) => {
              const compactLabel = threadViewPresetCompactLabel(view)
              const matchingThreadIds = threadViewAttentionEntries
                .filter(entry => ThreadViewModel.matchesAttentionView(entry, { filters: view.statusFilters, sourceFilter: view.sourceFilter }))
                .map(entry => entry.thread.id)
              const clearViewUnread = (): void => {
                const entries = matchingThreadIds.flatMap(sessionId => {
                  const record = attention.records.get(sessionId)
                  return record === undefined ? [] : [{ sessionId, version: record.version }]
                })
                if (entries.length > 0) attention.clearUnreadMany(entries)
              }
              const markViewUnread = (): void => {
                const sessionIds = matchingThreadIds.filter(sessionId => !attention.records.has(sessionId))
                if (sessionIds.length > 0) attention.markUnreadMany(sessionIds)
              }
              const countSuffix = visibleCount === null ? '' : ` (${visibleCount})`
              const accessibleLabel =
                attentionLabel === undefined && visibleCount === null
                  ? undefined
                  : `${label}${countSuffix}${attentionLabel === undefined ? '' : `, ${props.tSidebar(attentionLabel)}`}`
              return (
                <ContextMenu key={view.id}>
                  <ContextMenuTrigger asChild>
                    <Button
                      type="button"
                      data-thread-list-view-button=""
                      variant={view.id === listThreadView.id ? 'secondary' : 'ghost'}
                      size="sm"
                      className={cn('dshx:flex-1', compactViewTabs ? 'dshx:min-w-0 dshx:shrink dshx:gap-1 dshx:px-1.5' : 'dshx:min-w-20 dshx:shrink-0')}
                      title={label}
                      aria-label={accessibleLabel}
                      aria-pressed={view.id === listThreadView.id}
                      onClick={() => selectThreadViewPreset(view.id)}
                    >
                      {compactViewTabs ? (
                        <>
                          <span className="dshx:sr-only">{label}</span>
                          {compactLabel.kind === 'icon' ? (
                            <compactLabel.icon aria-hidden="true" data-testid="thread-view-compact-icon" />
                          ) : (
                            <span aria-hidden="true" data-testid="thread-view-compact-initial" className="dshx:font-semibold">
                              {compactLabel.initial}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="dshx:truncate">{label}</span>
                      )}
                      {attentionLabel === undefined ? null : (
                        <span
                          aria-hidden="true"
                          data-testid="thread-view-attention-dot"
                          className={cn(
                            'dshx:size-1.5 dshx:shrink-0 dshx:rounded-full',
                            ThreadAttentionPresentationModel.attentionDotClass({
                              attentionLabel,
                              attentionColors: preferences.attentionColors,
                              unread: false,
                              running: false,
                            }),
                          )}
                        />
                      )}
                      {visibleCount === null ? null : <span className="dshx:shrink-0">{compactViewTabs ? visibleCount : `(${visibleCount})`}</span>}
                    </Button>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="dshx-root">
                    <ContextMenuItem
                      disabled={!attention.available || !matchingThreadIds.some(sessionId => attention.records.has(sessionId))}
                      onSelect={clearViewUnread}
                    >
                      {props.tSidebar('threadSidebarMarkViewRead')}
                    </ContextMenuItem>
                    <ContextMenuItem disabled={!attention.available || matchingThreadIds.length === 0} onSelect={markViewUnread}>
                      {props.tSidebar('threadSidebarMarkViewUnread')}
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              )
            })}
          </div>
          {/* The full-name tabs at their natural width, clipped to nothing: the row compacts only when it is narrower. */}
          <div aria-hidden="true" className="dshx:relative dshx:h-0 dshx:w-0 dshx:overflow-hidden" hidden={isBoard}>
            <div
              ref={setFullViewTabs}
              data-thread-view-tab-measure=""
              className="dshx:invisible dshx:absolute dshx:top-0 dshx:left-0 dshx:flex dshx:w-max dshx:gap-1"
            >
              {viewTabs.map(({ view, label, attentionLabel, visibleCount }) => (
                <span
                  key={view.id}
                  className="dshx:inline-flex dshx:h-7 dshx:min-w-20 dshx:items-center dshx:justify-center dshx:gap-1.5 dshx:px-2.5 dshx:text-xs dshx:font-medium dshx:whitespace-nowrap"
                >
                  {label}
                  {attentionLabel === undefined ? null : <span className="dshx:size-1.5 dshx:shrink-0" />}
                  {visibleCount === null ? null : <span className="dshx:shrink-0">({visibleCount})</span>}
                </span>
              ))}
            </div>
          </div>
          {showGroupControl || showFilterControl ? (
            <div
              className={cn(
                'dshx:grid dshx:gap-1',
                isBoard
                  ? 'dshx:grid-flow-col dshx:auto-cols-max'
                  : cn('dshx:pt-1', showGroupControl && showFilterControl ? 'dshx:grid-cols-2' : 'dshx:grid-cols-1'),
              )}
            >
              {showGroupControl ? (
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
              {showFilterControl ? (
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
                    <DropdownMenuCheckboxItem
                      checked={threadView.statusFilters.length === 0}
                      onCheckedChange={checked => selectThreadStatusFilter('all', checked)}
                      onSelect={event => event.preventDefault()}
                    >
                      {props.tSidebar(threadStatusFilterLabelKeys.all)}
                    </DropdownMenuCheckboxItem>
                    {THREAD_STATUS_FILTER_GROUPS.map(group => (
                      <div key={group.id}>
                        <DropdownMenuLabel>{props.tSidebar(threadStatusFilterGroupLabelKeys[group.id])}</DropdownMenuLabel>
                        {group.filters.map(filter => (
                          <DropdownMenuCheckboxItem
                            checked={threadView.statusFilters.includes(filter)}
                            key={filter}
                            onCheckedChange={checked => selectThreadStatusFilter(filter, checked)}
                            onSelect={event => event.preventDefault()}
                          >
                            {props.tSidebar(threadStatusFilterLabelKeys[filter])}
                          </DropdownMenuCheckboxItem>
                        ))}
                      </div>
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

        {settingsOpen && !isBoard ? (
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
            <Label className="dshx:font-normal dshx:leading-snug">
              <Checkbox
                checked={preferences.separateRemoteThreads}
                onCheckedChange={checked => changePreferences({ separateRemoteThreads: checked === true })}
              />
              {props.tSidebar('threadSidebarSeparateRemoteThreads')}
            </Label>
            <p className="dshx:text-xs dshx:text-muted-foreground">{props.tSidebar('threadSidebarSeparateRemoteThreadsHint')}</p>
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
            className={cn(
              'dshx:pointer-events-none dshx:absolute dshx:inset-x-2 dshx:z-20 dshx:flex',
              isThreadNotification ? notificationPlacementClasses[preferences.notificationPlacement] : 'dshx:bottom-3 dshx:justify-center',
            )}
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
          ref={scrollAreaRef}
          data-testid="thread-sidebar-scroll"
          className={cn('dshx:min-h-0 dshx:flex-1 dshx:overflow-auto dshx:overscroll-y-contain dshx:px-2 dshx:pb-3', isBoard && 'dshx:p-4')}
          onKeyDown={event => {
            if (!isBoard) navigateThreadList(event.nativeEvent)
          }}
        >
          {sessionState.phase !== 'ready' || workspaceState.phase !== 'ready' ? (
            <div className="dshx:flex dshx:items-center dshx:justify-center dshx:gap-2 dshx:py-6 dshx:text-sm dshx:text-muted-foreground">
              <Spinner />
              {props.tSidebar('threadSidebarLoading')}
            </div>
          ) : null}
          {hoistedInterruptedRows.length > 0 ? (
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
                <span className="dshx:text-xs dshx:tabular-nums">({hoistedInterruptedRows.length})</span>
                <span className="dshx:h-px dshx:flex-1 dshx:bg-border" aria-hidden="true" />
                <Button type="button" size="xs" variant="outline" disabled={resumeAllBusy} onClick={() => void resumeAllRecoveries(hoistedInterruptedRows)}>
                  {resumeAllBusy ? <Spinner className="dshx:size-3" /> : null}
                  {props.tSidebar('threadSidebarResumeAll')}
                </Button>
              </div>
              <p className="dshx:px-2.5 dshx:pb-1 dshx:text-xs dshx:text-muted-foreground">{props.tSidebar('threadSidebarInterruptedHint')}</p>
              {hoistedInterruptedRows.map(session => renderThreadRow(session, 'threadSidebarInterrupted'))}
            </section>
          ) : null}
          {hoistedNeedsResumeRows.length > 0 ? (
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
                <span className="dshx:text-xs dshx:tabular-nums">({hoistedNeedsResumeRows.length})</span>
                <span className="dshx:h-px dshx:flex-1 dshx:bg-border" aria-hidden="true" />
                <Button type="button" size="xs" variant="outline" disabled={resumeAllBusy} onClick={() => void resumeAllRecoveries(hoistedNeedsResumeRows)}>
                  {resumeAllBusy ? <Spinner className="dshx:size-3" /> : null}
                  {props.tSidebar('threadSidebarResumeAll')}
                </Button>
              </div>
              {hoistedNeedsResumeRows.map(session => renderThreadRow(session, 'threadSidebarNeedsResume'))}
            </section>
          ) : null}
          <UsageLimitSection
            busyIds={usageLimitBusyIds}
            now={now}
            onAutoRetry={input => void changeUsageLimitRecovery(input)}
            onDismiss={input => void changeUsageLimitRecovery({ continuationId: input.continuationId, dismiss: true })}
            onResume={input => void resumeUsageLimitThread(input)}
            onResumeAll={() => void resumeAllUsageLimits()}
            onSnooze={input => void changeUsageLimitRecovery(input)}
            open={openThread}
            selectedSessionId={selectedSessionId}
            resumeAllBusy={usageLimitResumeAllBusy}
            rows={hoistedUsageLimitRows}
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
                workspaceId={realWorkspaceBySession.get(session.id) ?? SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession)}
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
          <div className={cn(isBoard && 'dshx:flex dshx:min-h-full dshx:items-start dshx:gap-3 dshx:overflow-x-auto dshx:pb-2')}>
            {threadView.groupBy === 'status'
              ? (isBoard ? orderedSections.filter(section => section !== 'remote') : renderedSections).map((section, index) => {
                  if (section === 'remote') {
                    return !preferences.separateRemoteThreads || props.openRemoteThreads === undefined ? null : (
                      <RemoteThreadsSection
                        key="remote"
                        threads={remoteThreads}
                        headerClassName={stickyHeaderClass}
                        onOpen={props.openRemoteThreads}
                        onOpenSession={props.openRemoteSession}
                        hint={props.tSidebar('threadSidebarSectionReorderHint')}
                        keepEmpty
                        onHeaderRef={element => {
                          sectionHeaderRefs.current[index] = element
                        }}
                        onHeaderPointerDown={event => {
                          if (isBoard || event.button !== 0) return
                          sectionDragRef.current = { pointerId: event.pointerId, from: index, startY: event.clientY, centers: null }
                        }}
                        onHeaderPointerMove={event => {
                          const current = sectionDragRef.current
                          if (current === null || current.pointerId !== event.pointerId) return
                          if (current.centers === null) {
                            if (Math.abs(event.clientY - current.startY) < SECTION_DRAG_THRESHOLD_PX) return
                            current.centers = shownSections.map((_, position) => {
                              const rect = sectionHeaderRefs.current[position]?.getBoundingClientRect()
                              return rect === undefined ? Number.POSITIVE_INFINITY : rect.top + rect.height / 2
                            })
                            event.currentTarget.setPointerCapture(event.pointerId)
                          }
                          event.preventDefault()
                          setSectionDrag({
                            from: current.from,
                            to: SidebarOrganization.dropIndexAt({ centers: current.centers, fromIndex: current.from, position: event.clientY }),
                          })
                        }}
                        onHeaderPointerUp={event => {
                          const current = sectionDragRef.current
                          if (current === null || current.pointerId !== event.pointerId) return
                          if (current.centers !== null) {
                            suppressSectionClick.current = true
                            commitSectionOrder(
                              current.from,
                              SidebarOrganization.dropIndexAt({ centers: current.centers, fromIndex: current.from, position: event.clientY }),
                            )
                          }
                          endSectionDrag()
                        }}
                        onHeaderPointerCancel={endSectionDrag}
                        onHeaderLostPointerCapture={() => {
                          if (sectionDragRef.current?.centers !== null) endSectionDrag()
                        }}
                        onHeaderKeyDown={event => {
                          if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
                          const fromShownIndex = shownSections.indexOf(section)
                          const toShownIndex = fromShownIndex + (event.key === 'ArrowUp' ? -1 : 1)
                          if (fromShownIndex < 0 || toShownIndex < 0 || toShownIndex >= shownSections.length) return
                          event.preventDefault()
                          commitSectionOrder(fromShownIndex, toShownIndex)
                        }}
                        onHeaderClick={event => {
                          if (suppressSectionClick.current) {
                            suppressSectionClick.current = false
                            event.preventDefault()
                            return
                          }
                          props.openRemoteThreads?.()
                        }}
                        dragging={sectionDrag?.from === index}
                      />
                    )
                  }
                  const rows = rowsBySection.get(section) ?? []
                  const remoteRows = remoteRowsBySection.get(section) ?? []
                  const sectionRows: SidebarGroupedThread[] = [
                    ...rows.map((session): SidebarGroupedThread => ({
                      kind: 'local',
                      session,
                      updatedAt: activityAtBySessionId.get(session.id) ?? session.updatedAt,
                    })),
                    ...remoteRows.map((remote): SidebarGroupedThread => ({ kind: 'remote', remote, updatedAt: remote.updatedAt })),
                  ]
                  if (section !== 'pinned') sectionRows.sort((left, right) => right.updatedAt - left.updatedAt)
                  const collapsed = collapsedSections.includes(section)
                  return (
                    <section
                      className={cn(
                        'dshx:mt-1 dshx:rounded-md',
                        isBoard && 'dshx:flex dshx:min-h-[24rem] dshx:min-w-72 dshx:flex-1 dshx:flex-col dshx:bg-muted/45 dshx:p-1.5',
                        rowDrag !== null && rowDropSection === section && 'dshx:bg-accent/40 dshx:ring-1 dshx:ring-inset dshx:ring-ring/30',
                      )}
                      key={section}
                      data-thread-section={section}
                      data-thread-board-column={isBoard ? section : undefined}
                      aria-label={isBoard ? `${props.tSidebar(sectionLabels[section])} column` : undefined}
                    >
                      <button
                        ref={element => {
                          sectionHeaderRefs.current[index] = element
                        }}
                        type="button"
                        data-thread-section-header=""
                        title={props.tSidebar('threadSidebarSectionReorderHint')}
                        className={cn(
                          stickyHeaderClass,
                          'dshx:group dshx:flex dshx:h-8 dshx:w-full dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2.5 dshx:text-sm dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50',
                          rowDrag !== null && 'dshx:ring-1 dshx:ring-ring/20',
                          rowDropSection === section && 'dshx:bg-accent dshx:text-foreground dshx:ring-ring/50',
                          sectionDrag?.from === index && 'dshx:cursor-grabbing dshx:bg-accent dshx:opacity-70',
                        )}
                        aria-expanded={!collapsed}
                        onPointerDown={event => {
                          if (isBoard || event.button !== 0) return
                          sectionDragRef.current = { pointerId: event.pointerId, from: index, startY: event.clientY, centers: null }
                        }}
                        onPointerMove={event => {
                          const current = sectionDragRef.current
                          if (current === null || current.pointerId !== event.pointerId) return
                          if (current.centers === null) {
                            if (Math.abs(event.clientY - current.startY) < SECTION_DRAG_THRESHOLD_PX) return
                            current.centers = shownSections.map((_, position) => {
                              const rect = sectionHeaderRefs.current[position]?.getBoundingClientRect()
                              return rect === undefined ? Number.POSITIVE_INFINITY : rect.top + rect.height / 2
                            })
                            event.currentTarget.setPointerCapture(event.pointerId)
                          }
                          event.preventDefault()
                          setSectionDrag({
                            from: current.from,
                            to: SidebarOrganization.dropIndexAt({ centers: current.centers, fromIndex: current.from, position: event.clientY }),
                          })
                        }}
                        onPointerUp={event => {
                          const current = sectionDragRef.current
                          if (current === null || current.pointerId !== event.pointerId) return
                          if (current.centers !== null) {
                            suppressSectionClick.current = true
                            commitSectionOrder(
                              current.from,
                              SidebarOrganization.dropIndexAt({ centers: current.centers, fromIndex: current.from, position: event.clientY }),
                            )
                          }
                          endSectionDrag()
                        }}
                        onPointerCancel={endSectionDrag}
                        onLostPointerCapture={() => {
                          if (sectionDragRef.current?.centers !== null) endSectionDrag()
                        }}
                        onKeyDown={event => {
                          if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
                          const fromShownIndex = shownSections.indexOf(section)
                          const toShownIndex = fromShownIndex + (event.key === 'ArrowUp' ? -1 : 1)
                          if (fromShownIndex < 0 || toShownIndex < 0 || toShownIndex >= shownSections.length) return
                          event.preventDefault()
                          commitSectionOrder(fromShownIndex, toShownIndex)
                        }}
                        onClick={() => {
                          if (suppressSectionClick.current) {
                            suppressSectionClick.current = false
                            return
                          }
                          toggleSection(section)
                        }}
                      >
                        <span
                          className="dshx:inline-flex dshx:shrink-0 dshx:opacity-0 dshx:transition-opacity dshx:group-hover:opacity-100 dshx:group-focus-visible:opacity-100"
                          aria-hidden="true"
                        >
                          <GripVerticalIcon className="dshx:size-3 dshx:cursor-grab dshx:active:cursor-grabbing" />
                        </span>
                        <span className="dshx:inline-flex dshx:shrink-0" aria-hidden="true">
                          {sectionIcons[section]}
                        </span>
                        <span className="dshx:whitespace-nowrap">{props.tSidebar(sectionLabels[section])}</span>
                        <span className="dshx:text-xs dshx:tabular-nums">({sectionRows.length})</span>
                        <span className="dshx:h-px dshx:flex-1 dshx:bg-border" aria-hidden="true" />
                        <span className="dshx:inline-flex dshx:shrink-0" aria-hidden="true">
                          {collapsed ? <IconChevronDownOutlineRegular size={12} /> : <IconChevronUpOutlineRegular size={12} />}
                        </span>
                      </button>
                      {!collapsed
                        ? sectionRows.map(entry =>
                            entry.kind === 'local' ? renderThreadRow(entry.session, undefined, section) : renderRemoteThreadRow(entry.remote),
                          )
                        : null}
                    </section>
                  )
                })
              : groupedThreadEntries.map(group => {
                  // A flat list under a hoisted group (Usage limit, Interrupted…) gets its own header, so its rows do
                  // not read as part of the group above.
                  const showHeader = group.showHeader || (!isBoard && hasHoistedGroups)
                  const groupLabel =
                    group.label || (viewTabs.find(tab => tab.view.id === threadViewSettings.activeViewId)?.label ?? props.tSidebar('threadSidebarAllThreads'))
                  const groupCollapsed = showHeader && collapsedGroups.includes(group.key)
                  return (
                    <section
                      className={cn(
                        'dshx:mt-1 dshx:rounded-md',
                        isBoard && 'dshx:flex dshx:min-h-[24rem] dshx:min-w-72 dshx:flex-1 dshx:flex-col dshx:bg-muted/45 dshx:p-1.5',
                      )}
                      key={group.key}
                      data-thread-board-column={isBoard ? group.key : undefined}
                      aria-label={isBoard ? `${group.label || props.tSidebar('threadSidebarAllThreads')} column` : showHeader ? groupLabel : undefined}
                    >
                      {showHeader ? (
                        <ThreadGroupHeader
                          label={groupLabel}
                          count={group.threads.length}
                          collapsed={groupCollapsed}
                          projectId={group.projectId}
                          className={stickyHeaderClass}
                          onToggle={() => toggleGroup(group.key)}
                          startProjectSession={props.startProjectSession}
                          t={props.tSidebar}
                        />
                      ) : null}
                      {groupCollapsed
                        ? null
                        : group.threads.map(entry =>
                            entry.kind === 'local' ? renderThreadRow(entry.session, undefined) : renderRemoteThreadRow(entry.remote),
                          )}
                    </section>
                  )
                })}
            {detachedThreadGroups.map(group => {
              const branchAction = group.branchAction
              const branchBusy = detachedBranchBusy.has(group.missingAncestorId)
              return (
                <section
                  className={cn(
                    'dshx:mt-1',
                    isBoard && 'dshx:flex dshx:min-h-[24rem] dshx:min-w-72 dshx:flex-1 dshx:flex-col dshx:rounded-md dshx:bg-muted/45 dshx:p-1.5',
                  )}
                  data-thread-board-column={isBoard ? `detached:${group.missingAncestorId}` : undefined}
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
                    {branchAction === null ? null : (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        className="dshx:shrink-0"
                        aria-label={props.tSidebar(branchAction === 'restore' ? 'threadSidebarMissingParentRestore' : 'threadSidebarMissingParentArchive')}
                        title={props.tSidebar(branchAction === 'restore' ? 'threadSidebarMissingParentRestoreHint' : 'threadSidebarMissingParentArchiveHint')}
                        disabled={branchBusy}
                        onClick={() =>
                          void mutateDetachedBranch({ missingAncestorId: group.missingAncestorId, threadIds: group.threadIds, action: branchAction })
                        }
                      >
                        {branchAction === 'restore' ? <IconUnarchiveOutlineRegular size={13} /> : <IconArchiveOutlineRegular size={13} />}
                      </Button>
                    )}
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
              )
            })}
          </div>
          {threadView.groupBy !== 'status' && separatesRemoteThreads && props.openRemoteThreads !== undefined ? (
            <RemoteThreadsSection
              threads={remoteThreads}
              headerClassName={stickyHeaderClass}
              onOpen={props.openRemoteThreads}
              onOpenSession={props.openRemoteSession}
            />
          ) : null}
          {isBoard || draftSessions.length === 0 ? null : (
            <section className="dshx:mt-1" key="drafts" aria-label={props.tSidebar('threadSidebarDrafts')}>
              <div
                className={cn(
                  stickyHeaderClass,
                  'dshx:flex dshx:h-8 dshx:min-w-0 dshx:items-center dshx:gap-1 dshx:px-1 dshx:text-sm dshx:text-muted-foreground',
                )}
              >
                <button
                  type="button"
                  data-thread-section-header=""
                  className="dshx:flex dshx:h-8 dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-1.5 dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50"
                  aria-expanded={draftsOpen}
                  onClick={() => setDraftsOpen(current => !current)}
                >
                  <span className="dshx:inline-flex dshx:shrink-0" aria-hidden="true">
                    <IconArchiveOutlineRegular size={14} />
                  </span>
                  <span className="dshx:whitespace-nowrap">{props.tSidebar('threadSidebarDrafts')}</span>
                  <span className="dshx:text-xs dshx:tabular-nums">({draftSessions.length})</span>
                  <span className="dshx:h-px dshx:flex-1 dshx:bg-border" aria-hidden="true" />
                  <span className="dshx:inline-flex dshx:shrink-0" aria-hidden="true">
                    {draftsOpen ? <IconChevronUpOutlineRegular size={12} /> : <IconChevronDownOutlineRegular size={12} />}
                  </span>
                </button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  className="dshx:shrink-0"
                  aria-label={props.tSidebar('threadSidebarDraftsCleanUp')}
                  title={props.tSidebar('threadSidebarDraftsCleanUpHint')}
                  disabled={draftsCleaning}
                  onClick={() => void cleanUpDrafts()}
                >
                  <IconArchiveOutlineRegular size={13} />
                </Button>
              </div>
              {draftsOpen ? draftSessions.map(session => renderThreadRow(session, undefined)) : null}
            </section>
          )}
          {sessionState.phase === 'ready' &&
          (isBoard || draftSessions.length === 0) &&
          detachedThreadGroups.length === 0 &&
          statusFilteredRecoveryRows.length === 0 &&
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
        {selectedSessionIds.length > 0 ? (
          <div
            role="toolbar"
            aria-label={props.tSidebar('threadSidebarSelection')}
            title={props.tSidebar('threadSidebarSelectionHint')}
            data-testid="thread-selection-bar"
            className="dshx:mx-2 dshx:mb-2 dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1 dshx:rounded-md dshx:border dshx:bg-card dshx:p-1.5 dshx:text-xs"
          >
            <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:font-medium" aria-live="polite">
              {props.tSidebar('threadSidebarSelectedCount', { count: selectedSessionIds.length })}
            </span>
            <Button size="xs" variant="outline" onClick={() => void applyToSelection(allSelectedPinned ? 'unpin' : 'pin')}>
              {allSelectedPinned ? <IconPinFillRegular size={13} /> : <IconPinOutlineRegular size={13} />}
              {props.tSidebar(allSelectedPinned ? 'threadSidebarUnpin' : 'threadSidebarPin')}
            </Button>
            <Button size="xs" variant="outline" disabled={allSelectedSettled} onClick={settleSelection}>
              <IconCheckCircleOutlineRegular size={13} />
              {props.tSidebar('threadSidebarSettle')}
            </Button>
            <Button size="xs" variant="outline" onClick={() => void applyToSelection('archive')}>
              <IconArchiveOutlineRegular size={13} />
              {props.tSidebar('threadSidebarArchive')}
            </Button>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={props.tSidebar('threadSidebarClearSelection')}
              onClick={() => setThreadSelection(EMPTY_THREAD_SELECTION)}
            >
              <XIcon className="dshx:size-3.5" />
            </Button>
          </div>
        ) : null}
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
