import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { WorkspaceBrowserProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { jjIntegrationApi } from '@dshfiles/jj-integration/api'
import { NoFolderWorkspace } from '@dshfiles/jj-integration/no-folder'
import { workbenchPanels } from '@dshfiles/workbench/registry'
import { DetachedThreadsModel, type DetachedGroupAction } from './detached-threads.js'
import { DraftThreadsModel } from './draft-threads.js'
import { DraftsSection } from './drafts-section.js'
import { ListFade } from './list-fade.js'
import { ApprovalDetail } from './approval-detail.js'
import type { SessionDraft, SessionDrafts } from '@dshfiles/session-controller/draft-client'
import { isListedUnsentThread, presentUnsentRows } from './unsent-threads.js'
import { HostSnapshotsModel } from './snapshots.js'
import { DEFAULT_THREAD_BOARD_VIEW, storedThreadBoardView, ThreadBoardViewModel, type ThreadBoardViewSettings } from './thread-board-view.js'
import { toggleCollapsedGroup } from './collapsed-groups.js'
import { threadDragMachine, type ThreadDragCommands } from './thread-drag-machine.js'
import { ThreadRouteModel } from './thread-route.js'
import { useNearViewport } from './use-near-viewport.js'
import { RowSwipeModel, useRowSwipe } from './row-swipe.js'
import { HeldGroupsModel, type HeldGroups } from './held-groups.js'
import { PeekCard, RowPeek } from '@dshfiles/plugin-ui/components/peek'
import { useCommands } from '@dshfiles/plugin-ui/hooks/commands'
import { useLastReply, type RetainThread } from '@dshfiles/plugin-ui/hooks/last-reply'
import { VirtualThreadRows } from './virtual-thread-rows.js'
import { threadSurfaceOf, type ThreadSidebarSurface } from './thread-surface.js'
import { ProjectIcon } from '@dshfiles/workspace-folder-picker/project-icon-view'
import { LiveElapsed } from '@dshfiles/plugin-ui/components/live-elapsed'
import { LiveActivityLine, useLiveTurns, type LiveTurnView } from './live-activity.js'
import { projectLifecycleApi } from '@dshfiles/workspace-folder-picker/project-lifecycle-api'
import { GroupChevron, groupCountStatusOf, ThreadGroupHeader } from './thread-group-header.js'
import { formatAge } from './relative-age.js'
import { RemoteThreadItem, RemoteThreadsSection, type RemoteThreadRowLabels } from './remote-threads-section.js'
import { RemoteThreadInventoryModel, useRemoteSidebarThreads, useRemoteThreadArchive, type RemoteSidebarThread } from './remote-thread-inventory.js'
import { StableValueModel, useStableValue } from './stable-value.js'
import { createThreadChildRowCache, type ThreadChildRowCache } from './thread-child-rows.js'
import { StatusGlyph, type WorkStatus } from '@dshfiles/plugin-ui/components/work-status'
import { useInboxThreadSignals } from './inbox-signals.js'
import { STATUS_GROUP_KEY_PREFIX, ThreadStatusModel, type RowInlineVerb, type ThreadStatus, type ThreadStatusCopy, type ThreadStatusGroup } from './thread-status.js'
import { RowVerb } from './row-verb.js'
import { AttentionSubtitleModel } from './attention-subtitle.js'
import { plural, useApi, useApiEvent, useApiQuery, usePlugin, useRegistry, type CommandTrigger } from '@dshfiles/dshx/client'
import { useThreadSubscriptions, type ThreadNotifyChoice } from './subscriptions-client.js'
import { useMachine } from '@dshfiles/plugin-ui/machine'
import { ThreadRowActions, type ThreadRowActionTarget } from './thread-row-actions.js'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { isApiOwnerMissing } from '@dshfiles/dshx/api'
import { startInteraction } from '@dshfiles/dshx/tracing/client'
import { createInventoryPoll } from './inventory-poll.js'
import { aiAccountsApi } from '@dshfiles/ai-accounts/api'
import { activeQuestionSessionIds } from './pending-questions.js'
import { IconPinFillRegular, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import { Alert } from '@dshfiles/plugin-ui/components/ui/alert'
import { useHostConnection } from '@dshfiles/plugin-ui/lib/host-connection'
import { WORK_COUNT_SEPARATOR, workCountLabel, workCountParts } from '@dshfiles/plugin-ui/lib/work-count'
import { WorkCountText } from '@dshfiles/plugin-ui/components/work-count'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { LEADING_GLYPH_ATTRIBUTE, MARKER_KEEP } from '@dshfiles/plugin-ui/components/selection'
import { AttentionMeta } from '@dshfiles/plugin-ui/components/ui/attention-meta'
import { RouteModel } from '@dshfiles/plugin-ui/components/model-mark'
import { SubagentRouteLabelModel } from './subagent-provenance/route-label.js'
import { subagentCountWords } from './subagent-provenance/subagent-count.js'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ProjectMark } from '@dshfiles/plugin-ui/components/ui/project-mark'
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
import { ListHeaderExtras } from './list-header-extras.js'
import { HoverStripFit } from './hover-strip-fit.js'
import { filterPanelInitialFocus, ListFilterPanel, type ListFilterAction } from './list-filter-panel.js'
import { Popover, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { ThreadListScope } from './list-scope.js'
import { PresetChips, PresetDeleteDialog, PresetNameDialog, type PresetNamePrompt } from './filter-presets.js'
import { ProjectAddFlow } from '@dshfiles/workspace-folder-picker/project-add-flow'
import { Empty, EmptyTitle } from '@dshfiles/plugin-ui/components/ui/empty'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { Label } from '@dshfiles/plugin-ui/components/ui/label'
import { Spinner } from '@dshfiles/plugin-ui/components/ui/spinner'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import {
  ActivityIcon,
  AlarmClockIcon,
  ArchiveIcon,
  ArchiveRestoreIcon,
  BellIcon,
  BellOffIcon,
  BellRingIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CirclePauseIcon,
  FolderIcon,
  GitBranchIcon,
  GripVerticalIcon,
  LayersIcon,
  LinkIcon,
  ListFilterIcon,
  MailIcon,
  MonitorIcon,
  PanelRightOpenIcon,
  PauseIcon,
  PinIcon,
  PinOffIcon,
  PlayIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Settings2Icon,
  SlidersHorizontalIcon,
  XIcon,
} from '@dshfiles/plugin-ui/icons'
import { OverflowGlyph } from '@dshfiles/plugin-ui/components/ui/overflow-glyph'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { PhoneLayout } from './phone-layout.js'
import { ThreadMenu, type ThreadMenuEntries, type ThreadMenuKit } from './thread-menu.js'
import { ThreadMenuModel } from './thread-menu-model.js'
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import {
  SidebarOrganization,
  SIDEBAR_SECTIONS,
  type AutoSettleOverride,
  type AttentionColor,
  type AttentionColorKey,
  type AttentionColors,
  type ProjectColorPalette,
  type SidebarPreferences,
  type SidebarSection,
  type ThreadRowAction,
  type ThreadRowDensity,
} from './organization.js'
import { ThreadAttentionPresentationModel, type ThreadAttentionLabel } from './attention-presentation.js'
import { SidebarPreferencesModel, attentionColorSchema } from './preferences.js'
import { selectInputNeededRows, selectTurnFinishedRows } from './attention-rows.js'
import { ApprovalRows } from './approval-rows.js'
import type { PaletteAction } from '@dshfiles/command-palette/palette-contract'
import { PaletteBridge } from './palette-bridge.js'
import { useSidebarState } from './sidebar-state.js'
import { useStageCovered } from './stage-cover.js'
import { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'
import { ThreadReferencesItems } from './thread-references-menu.js'
import { ContinueInProjectItems } from './continue-in-menu.js'
import { useSavedProjectChip } from './project-colors.js'
import { PaletteProjectColorsModel } from './palette-project-colors.js'
import { RowArrivalTintModel } from './row-arrival-tint.js'
import { useThreadDirectories } from './use-thread-directories.js'
import {
  failedResumeNotice,
  INITIAL_SIDEBAR_NOTICE_QUEUE_STATE,
  scheduleSuccessNoticeDismissal,
  SidebarNoticeAlert,
  SidebarNoticeMessage,
  sidebarNoticeQueueReducer,
  type SidebarNotice,
} from './sidebar-notice.js'
import { threadSidebarMachineApi } from './machine-api.js'
import { useRecoveryOperations, type RecoveryOperationsSettled } from './recovery-operations-machine.js'
import { threadSidebarRecoveryApi } from './recovery-api.js'
import { restartRecoveryRefetchInterval } from './restart-recovery-poll.js'
import { selectRecoveryRows } from './restart-recovery-rows.js'
import type { RecoveryReason } from './restart-recovery.js'
import { UsageLimitRowsModel, type QuotaContinuation, type UsageLimitRow } from './usage-limit-rows.js'
import { ResumeAttentionModel } from './resume-attention.js'
import { usageLimitRefetchInterval } from './usage-limit-poll.js'
import { UsageLimitSection, type UsageLimitSnooze } from './usage-limit-section.js'
import { groupThreadChildren, launchOrdered, partitionFinishedChildren, shouldOpenChildThreadList, threadActionTargetIds, visibleChildren } from './thread-children.js'
import { buildThreadUrl, clearThreadUrl, pageLoadThreadRoute, readThreadUrl } from './thread-url.js'
import { PHONE_HISTORY_SELF_POP_EVENT } from '@dshfiles/workbench/phone-history'
import { ScreenWakeLock, useScreenWakeLock } from './wake-lock.js'
import { ThreadListNavigationModel } from './thread-list-navigation.js'
import {
  EMPTY_THREAD_SELECTION,
  THREAD_MAIN_BUTTON_SELECTOR,
  isThreadSelectionBackgroundClick,
  shouldClearUnreadOnReselect,
  ThreadSelectionModel,
  type ThreadSelectionState,
} from './thread-selection.js'
import { createThreadMultiSelectionStore, useThreadMultiSelected, useThreadMultiSelectedIds, type ThreadMultiSelectionStore } from './thread-multi-selection.js'
import { ThreadSelectionBar } from './thread-selection-bar.js'
import { workingThreadIds, WorkingThreadsProjection } from './working-threads.js'
import { HeldUpdatesPill } from './held-updates-pill.js'
import { RunningJobsModel } from './running-jobs.js'
import type { ThreadWorkStatus } from './thread-status-client.js'
import { threadWorkStatusStore } from './thread-work-status-store.js'
import { indexRebasedThreadSessions, type RebasedSessionState } from './rebased-threads.js'
import { OwnWorkspaceModel, type OwnWorkspace as OwnWorkspaceView, type OwnWorkspaceStateKind, type OwnWorkspaceThread } from './own-workspace.js'
import { indexQueuedIntegrationSessions } from './queued-integrations.js'
import { SettledThreadsModel, type SettledSessionState } from './settled-threads.js'
import { answerSettleRequests } from './settle-request.js'
import { THREAD_DELAYS, threadDelayMs, type ThreadDelay } from './thread-delays.js'
import { useAutoArchive, type AutoArchiveClient } from './auto-archive-machine.js'
import { useAutoSettle, type AutoSettleClient } from './auto-settle-machine.js'
import {
  THREAD_SOURCE_FILTER_OPTIONS,
  THREAD_STATUS_FILTER_GROUPS,
  THREAD_STATUS_FILTER_OPTIONS,
  ThreadViewModel,
  type ThreadGroupBy,
  type ThreadSourceFilter,
  type ThreadViewPreferences,
} from './thread-view.js'
import { ALL_THREADS_VIEW_ID, MAX_THREAD_VIEWS, ThreadViewPreferencesModel, type ThreadViewSettings, WORKING_VIEW_ID } from './thread-view-preferences.js'
import { SHOW_WORKING_THREADS_EVENT } from './working-status-item.js'
import {
  ThreadViewManager,
  threadStatusFilterGroupLabelKeys,
  threadStatusFilterLabelKeys,
  threadViewPresetCompactLabel,
  threadViewPresetLabel,
} from './thread-view-manager.js'
import { useCompactViewTabs } from './thread-view-tabs.js'
import { captureThreadMentionInsertion, requestThreadMentionInsertion } from './thread-mention.js'
import {
  AGENT_MESSAGE_NOTIFICATION_CATEGORY,
  ThreadNotificationModel,
  legacyNotificationPreferences,
  storedNotificationsMuted,
  type ThreadInteractionStatus,
  type ThreadNotificationCategory,
  type ThreadFinishNotificationCategory,
  type ThreadNotificationPlacement,
} from './thread-notifications.js'
import { userNotificationApi, type UserNotificationPageOutcome } from './user-notification-api.js'
import { ViewedThreadModel } from './viewed-thread.js'
import { ThreadNotificationAudioModel } from './thread-notification-audio.js'
import { createNotificationSoundPaletteAction, createNotificationSnoozePaletteAction } from './notification-sound-palette-action.js'
import { useThreadAttention } from './attention-client.js'
import { useFailedTurns } from './failed-turns-client.js'
import { useRowAgentHandles } from './use-row-agent-handles.js'
import type { ThreadAttentionView } from './attention-api.js'
import { SinceYouLeftModel } from '@dshfiles/chat/thread-tools'
import { threadSidebarAutoSettleApi } from './auto-settle-api.js'
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
import { StatusDot } from '@dshfiles/plugin-ui/components/ui/status-dot'

/**
 * Hand Chat the unseen range of a thread being opened (productivity pass T4.3), before this surface clears the record.
 * Only a finished-turn record carries one; a manual unread mark has no turn to start from.
 */
const noteSinceYouLeft = (record: ThreadAttentionView): void => {
  if (record.finishedAt === null || record.finishedSeq === null) return
  SinceYouLeftModel.note({ sessionId: record.sessionId, firstUnreadSeq: record.firstUnreadSeq ?? null, finishedSeq: record.finishedSeq })
}

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
  /**
   * Opens the thread header's Land confirmation for this thread (jj-integration's `ThreadHeaderLand.confirm`); false
   * when nothing can confirm, and then nothing lands. A row's Land never lands on its own.
   */
  confirmLand?: (sessionId: string) => boolean
  startProjectSession: (projectId: string) => void
  drafts?: SessionDrafts['list'] | undefined
  /** Root uiSession selection; scoped or retained sidebar occurrences do not select the main conversation. */
  currentSessionId?: ObservableSnapshot<string | undefined>
  /** Fork the thread into another project and settle it; resolves to the continuing thread and whether it settled. */
  continueInProject: (
    sessionId: SessionSummary['id'],
    projectId: string,
  ) => Promise<{ readonly continuedSessionId: SessionSummary['id']; readonly settled: boolean }>
  /** Register one scratch thread's folder as a project; resolves to the title it actually got. */
  projectRegister: (input: { readonly path: string; readonly title: string }) => Promise<{ readonly title: string }>
}

/** The slot runtime's global selector hooks, the one part of the props a `main` panel mount supplies itself. */
export type ThreadSidebarStandardProps = Pick<WorkspaceBrowserProps, 'useSessions' | 'useSessionStatus' | 'useWorkspaces'>

type ThreadSidebarProps = ThreadSidebarStandardProps &
  Pick<WorkspaceBrowserProps, 'open'> &
  InjectedActions & {
    tSidebar: TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>
    onNavigationLookahead?: (sessionIds: readonly SessionSummary['id'][]) => void
    /** Retain a thread's history for a Space peek of its last reply; absent mounts show no reply. */
    retainPeek?: RetainThread
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

/** One notice tone per category: failures read as errors, work that needs review as warnings, an agent's message as a plain card. */
const notificationNoticeTones = {
  'approval-needed': 'warning',
  'input-needed': 'warning',
  'agent-message': 'neutral',
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
  state: 'threadSidebarGroupState',
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
/** Picker entries that open the project add flow (productivity pass Q5, T5.5), never a filter value. */
const ADD_FOLDER = '__add-folder__'
const NEW_PROJECT = '__new-project__'
/**
 * How often the sidebar re-reads the JJ inventory while the page is visible. The Host keeps a repository view for sixty
 * seconds, so a shorter schedule spent a full jj scan on every other tick.
 */
const INVENTORY_REFRESH_INTERVAL_MS = 60_000
/** Pointer travel before a press on a section header becomes a reorder drag instead of a fold. */
const SECTION_DRAG_THRESHOLD_PX = 5
const UNASSIGNED_PROJECT = '__unassigned__'

const sectionLabels = {
  pinned: 'threadSidebarPinned',
  active: 'threadSidebarActive',
  parked: 'threadSidebarParked',
  settled: 'threadSidebarSettled',
  inactive: 'threadSidebarInactive',
  archived: 'threadSidebarArchived',
} satisfies Record<SidebarSection, Parameters<ThreadSidebarTranslate>[0]>

const isSidebarSection = (value: string | undefined): value is SidebarSection => SIDEBAR_SECTIONS.some(section => section === value)

const THREAD_TAB_FOCUS_EVENT = 'dshfiles:main-tabs:focus-thread'
const PANEL_ASIDE_EVENT = 'dshfiles:move-panel-aside'
const threadTabFocusEventSchema = Schema.StructWithRest(Schema.Struct({ sessionId: Schema.String.check(Schema.isMinLength(1)) }), [
  Schema.Record(Schema.String, Schema.Never),
])

const noticeClass = 'dshx:w-auto dshx:px-3 dshx:py-2 dshx:text-xs'
// The list sits on the sidebar fill, so its sticky headers do too (no lighter band over a recessive surface).
const stickyHeaderClass = 'dshx:sticky dshx:top-0 dshx:z-10 dshx:bg-(--dsw-specific-sidebar-fill)'

const sectionIcons = {
  pinned: <PinIcon strokeWidth={1.5} size={14} />,
  active: <ActivityIcon className="dshx:size-3.5" />,
  parked: <PauseIcon strokeWidth={1.5} size={14} />,
  settled: <CircleCheckIcon strokeWidth={1.5} size={14} />,
  inactive: <CirclePauseIcon className="dshx:size-3.5" />,
  archived: <ArchiveIcon strokeWidth={1.5} size={14} />,
} satisfies Record<SidebarSection, ReactNode>

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

const sameFolderRows = (left: Readonly<Record<SessionId, SessionSummary>>, right: Readonly<Record<SessionId, SessionSummary>>): boolean =>
  HostSnapshotsModel.sameRowsBy(left, right, (before, after) => before.cwd === after.cwd)

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

export interface RowActions {
  readonly open: (sessionId: SessionSummary['id']) => void
  readonly selection: () => ThreadSelectionState
  /** Rows read their own multi-selected state here, so a toggle re-renders only the rows it changes. */
  readonly multiSelection: ThreadMultiSelectionStore
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
  /** Turn a scratch thread's own folder into a project, so the thread stops being a No folder thread. */
  readonly turnIntoProject: (session: SessionSummary, folder: string | undefined) => void
  readonly resume: (sessionId: SessionSummary['id']) => void
  readonly dismissRecovery: (sessionId: SessionSummary['id']) => void
  readonly beginRename: (sessionId: SessionSummary['id']) => void
  readonly rename: (sessionId: SessionSummary['id'], title: string) => void
  readonly cancelRename: () => void
  readonly setAutoSettleOverride: (sessionId: SessionSummary['id'], override: AutoSettleOverride) => void
  /** Opt-in completion notices: the open thread is told when the target thread finishes, at the chosen level. */
  readonly setNotify: (input: ThreadNotifyTarget, choice: ThreadNotifyChoice) => void
  /** The open thread a batch notice level applies to, or undefined when none can subscribe. */
  readonly batchNotifySubscriber: () => { readonly title: string } | undefined
  readonly batchNotify: (choice: ThreadNotifyChoice) => void
  readonly notifyDefaultLevel: () => Exclude<ThreadNotifyChoice, 'off' | 'default'>
  /** The row's one inline verb (plan §4.3): an inbox item's provider verb, a sidebar Resume, or open the thread. */
  readonly actOnStatus: (sessionId: SessionSummary['id'], status: ThreadStatus) => void
  /** Open the row's peek (Space on a keyboard; a long press on a phone shows it as a sheet). */
  readonly peek: (sessionId: SessionSummary['id']) => void
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

/** The open thread as a row offers to subscribe it to that row's completions. */
export interface ThreadNotifyTarget {
  readonly subscriberSessionId: string
  readonly subscriberTitle: string
  readonly targetSessionId: string
  readonly choice: ThreadNotifyChoice
}

export interface ThreadRowProps {
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
  /** The project folder behind the workspace id, for a thread whose Session summary carries no cwd. */
  readonly workspacePath: string | undefined
  /** Saved project colour overrides: a palette tone or a custom colour (primitives so memoized rows keep prop equality). */
  readonly projectChipTone: number | undefined
  readonly projectChipColor: string | undefined
  /**
   * Set when the thread runs in its own jj workspace rather than in the project checkout (b:212a): the row shows a quiet
   * branch indicator and at most one state word, never the workspace's folder name, which only its tooltip carries.
   * Primitives, so the memoized row keeps its props equal across list renders.
   */
  readonly ownWorkspaceName: string | undefined
  readonly ownWorkspacePath: string | undefined
  readonly ownWorkspaceState: OwnWorkspaceStateKind | undefined
  readonly ownWorkspaceStateText: string | undefined
  readonly ownWorkspaceStateAt: number | undefined
  readonly machine: string | undefined
  readonly age: string
  /** Set only while the thread is muted or snoozed. */
  readonly mute: ThreadMute | undefined
  readonly attentionLabel: ThreadAttentionLabel | undefined
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
  /** The parent's subagent catalog ids in launch order (council round 22, item 12); undefined until it loads. */
  readonly childLaunchOrder?: readonly string[] | undefined
  readonly childrenOpen: boolean
  readonly allChildrenShown: boolean
  /** Set only when the open thread is one of this row's children, so other rows skip re-rendering. */
  readonly selectedChildId: SessionSummary['id'] | undefined
  readonly actions: RowActions
  /**
   * Status grouping only: the row's ADE status (glyph, detail, inline verb), with its subagents rolled up. Undefined
   * keeps the older dot-and-label row for the other groupings.
   */
  readonly workStatus?: ThreadStatus | undefined
  /**
   * Lead the row with its project's 16px mark (polish pass b:r4et): which project a thread belongs to reads at a glance.
   * Off under a project section, whose header carries the mark already.
   */
  readonly projectMark?: boolean | undefined
  /** A running turn's start and current step, for the live activity line; undefined while the thread does not run. */
  readonly liveTurn?: LiveTurnView | undefined
  /** Background jobs this thread runs now: a muted "1 job" chip, never Working (DESIGN.md R2). */
  readonly runningJobs?: number | undefined
  /** Each child's own status, for the nested subagent rows under a status-grouped parent. */
  readonly childStatuses?: ReadonlyMap<SessionSummary['id'], ThreadStatus> | undefined
  /** The `@handle` of the agent that started the thread, else the agent preset it runs, shown as a muted chip. */
  readonly agent?: string | undefined
  /** Set when another thread is open: this row offers to notify that thread when this one finishes. */
  readonly notifyTarget?: ThreadNotifyTarget | undefined
  /** How many threads are notified when this one finishes; 0 or undefined hides the badge. */
  readonly subscriberCount?: number | undefined
}

/**
 * A row's clock in whole units (round five B3): "1m 41s" reads "1m", "1h 04m" reads "1h", like the ages beside it. The
 * thread header keeps the precise clock.
 */
const wholeUnit = (elapsed: string): string => elapsed.split(' ')[0] ?? elapsed

const workStatusLabelKeys = {
  working: 'threadSidebarStateWorking',
  'needs-you': 'threadSidebarStateNeedsYou',
  failed: 'threadSidebarStateFailed',
  ready: 'threadSidebarStateReady',
  idle: 'threadSidebarStateIdle',
  done: 'threadSidebarStateDone',
} as const satisfies Record<WorkStatus, Parameters<ThreadSidebarTranslate>[0]>

const statusGroupLabelKeys = {
  pinned: 'threadSidebarPinned',
  'needs-you': 'threadSidebarStateNeedsYou',
  working: 'threadSidebarStateWorking',
  ready: 'threadSidebarStateReady',
  idle: 'threadSidebarStateIdle',
  draft: 'threadSidebarStateDrafts',
  done: 'threadSidebarStateDone',
} as const satisfies Record<ThreadStatusGroup, Parameters<ThreadSidebarTranslate>[0]>

const inlineVerbLabelKeys = {
  Answer: 'threadSidebarVerbAnswer',
  Approve: 'threadSidebarVerbApprove',
  Retry: 'threadSidebarVerbRetry',
  Resume: 'threadSidebarVerbResume',
  Land: 'threadSidebarVerbLand',
  // The approval verb already reads Review in every locale.
  Review: 'threadSidebarVerbApprove',
} as const satisfies Record<RowInlineVerb, Parameters<ThreadSidebarTranslate>[0]>

const NO_CHILDREN: readonly SessionSummary[] = []

/**
 * The agent preset a thread runs, from the Host's `agentPreset` projection; the deployment default reads as no agent.
 * A configured `@handle` comes first, from the agents plugin through `ThreadRowDecorators`.
 */
const BUILT_IN_PRESETS: ReadonlySet<string> = new Set(['default', 'standard', 'plan', 'ask', 'auto'])

const agentPresetOf = (session: SessionSummary): string | undefined => {
  const values = session.projectionValues
  if (values === undefined || !('agentPreset' in values)) return undefined
  const preset = values.agentPreset
  // The shipped presets are the mode a thread runs in (shown by the composer), not an agent.
  return typeof preset === 'string' && preset.length > 0 && !BUILT_IN_PRESETS.has(preset) ? preset : undefined
}

/**
 * A subagent's row title: the name its parent gave it (the `description` of the subagent call, kept as the child's
 * creation label), which is what its card and the mention list call it. Its Session title is the prompt it was sent.
 */
const subagentRowTitle = (session: SessionSummary): string => {
  const label = session.projectionValues?.subagent?.label?.trim()
  return label === undefined || label === '' ? session.displayTitle : label
}

const finishedSubagentsLabels = {
  show: 'threadSidebarFinishedSubagentsShow',
  collapse: 'threadSidebarFinishedSubagentsCollapse',
  hide: 'threadSidebarFinishedSubagentsHide',
} as const

/** The Filter panel's distance from the window's edges, and the least height it keeps when its trigger sits low. */
const FILTER_PANEL_COLLISION_PADDING = 8
const FILTER_PANEL_MIN_ROOM = 240
type FilterPanelRoomStyle = CSSProperties & { readonly '--filter-panel-room': string }

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

const SessionStatusDot = (props: {
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
  return <StatusDot className={dotClass} aria-label={unread ? props.unreadLabel : undefined} />
}

const ChildThreadList = (props: {
  readonly parentId: string
  readonly childThreads: readonly SessionSummary[]
  readonly finishedChildThreads: readonly SessionSummary[]
  /** The parent's catalog ids in launch order: the list reads launch order, failed last (council round 22, item 12). */
  readonly launchOrder?: readonly string[] | undefined
  readonly unreadSessionIds: ReadonlySet<SessionSummary['id']>
  readonly allShown: boolean
  readonly selectedChildId: SessionSummary['id'] | undefined
  readonly attentionLabels: ReadonlyMap<SessionSummary['id'], ThreadAttentionLabel>
  readonly rowStyle: RowStyle
  readonly actions: RowActions
  /** Status grouping: each child's ADE status replaces its dot and label. */
  readonly childStatuses?: ReadonlyMap<SessionSummary['id'], ThreadStatus> | undefined
}): JSX.Element => {
  const t = props.actions.translate
  const [finishedShown, setFinishedShown] = useState(false)
  // One child order on every subagent surface (council round 22, item 12): launch order, failed last.
  const { childStatuses, launchOrder } = props
  const childThreads = useMemo(
    () => launchOrdered({ children: props.childThreads, launchOrder, isFailed: child => childStatuses?.get(child.id)?.status === 'failed' }),
    [props.childThreads, launchOrder, childStatuses],
  )
  const finishedChildThreads = useMemo(
    () => launchOrdered({ children: props.finishedChildThreads, launchOrder, isFailed: child => childStatuses?.get(child.id)?.status === 'failed' }),
    [props.finishedChildThreads, launchOrder, childStatuses],
  )
  const { shown, hiddenCount } = visibleChildren({
    children: childThreads,
    limit: props.rowStyle.maxChildren,
    showAll: props.allShown,
    selectedId: props.selectedChildId,
  })
  const compact = props.rowStyle.density === 'compact'
  const multiSelectedChildIds = useThreadMultiSelectedIds(
    props.actions.multiSelection,
    [...props.childThreads, ...props.finishedChildThreads].map(child => child.id),
  )
  const lineClass = cn(
    // Touch: line 1 ends where the parent rows' time column does, clear of their menu button's (council round 4 B4).
    'dshx:pointer-coarse:pr-11',
    'dshx:flex dshx:w-full dshx:min-w-0 dshx:items-center dshx:gap-2 dshx:rounded-md dshx:px-2 dshx:text-left dshx:outline-none dshx:hover:bg-accent/60 dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50',
    compact ? 'dshx:h-6 dshx:text-xs' : 'dshx:h-7 dshx:text-sm',
  )
  const renderChild = (child: SessionSummary): JSX.Element => {
    const childStatus = props.childStatuses?.get(child.id)
    const attentionLabel = childStatus === undefined ? props.attentionLabels.get(child.id) : undefined
    // Line 2 names the model the subagent runs on (council round 17 B1.1), `[mark] gpt-6-luna` (a Needs-you or Failed child adds `· Needs you`), in the
    // attention meta's 12/16 secondary ink; its state word moves there from line 1. An unknown model draws no line 2.
    // Council round 18 B1.1: the word stays only where the glyph cannot say it (Needs you, Failed); a Working, Idle, Ready
    // or Done glyph already names its state, so line 2 gives the model the room.
    const route = SubagentRouteLabelModel.subagentRoute({
      route: child.projectionValues?.threadSidebarModelRoute,
      identity: child.projectionValues?.subagent,
    })
    // A Failed or Needs-you child says its state. A Failed child says "Failed", not the attention meta's "Turn failed": the
    // ✕ and the failed ink carry the rest, and the longer word cut the model to "claude-sonnet…" (council round 24, item 3).
    const stateWord =
      childStatus === undefined || (childStatus.status !== 'needs-you' && childStatus.status !== 'failed') ? undefined : t(workStatusLabelKeys[childStatus.status])
    const lineOneWord = route === undefined && stateWord !== undefined
    // "Turn failed" reads in the failed ink, as the parent's failed count does (council round 23, item 2).
    const stateInk = childStatus?.status === 'failed' ? 'dshx:text-destructive' : undefined
    return (
      <li key={child.id}>
        <button
          type="button"
          draggable
          className={cn(
            lineClass,
            // One look for "selected" in the list (council round 24, item 5): the root row's wash and its 1 px selected edge;
            // the phone list keeps its no-edge rule (round 17 B1.2).
            'dshx:data-[selected=true]:bg-selected-wash dshx:data-[selected=true]:selected-edge dshx:phone:data-[selected=true]:shadow-none',
            'dshx:relative dshx:data-[multi-selected=true]:bg-info/15 dshx:data-[multi-selected=true]:ring-1 dshx:data-[multi-selected=true]:ring-inset dshx:data-[multi-selected=true]:ring-info/40',
            // Two lines: line 1 keeps the row's height, line 2 its 16px, 2px apart from the row's edges.
            // Touch: 1px between them puts line 2 on the parent rows' 23pt title-to-meta pitch (council round 18 B1.3).
            route !== undefined && 'dshx:h-auto dshx:flex-col dshx:items-stretch dshx:gap-0 dshx:py-0.5 dshx:pointer-coarse:gap-px',
          )}
          data-thread-id={child.id}
          data-thread-main-action=""
          data-multi-selected={multiSelectedChildIds.has(child.id) ? 'true' : undefined}
          data-selected={child.id === props.selectedChildId}
          aria-current={child.id === props.selectedChildId ? 'page' : undefined}
          title={new Date(child.updatedAt).toLocaleString()}
          onClick={() => props.actions.open(child.id)}
          onDoubleClick={() => keepThreadTab(child.id)}
        >
          <span
            // Touch: 28px whatever the density, so line 2 lands on the parent rows' 23pt pitch (council round 18 B1.3).
            className={cn('dshx:flex dshx:w-full dshx:min-w-0 dshx:items-center dshx:gap-2', compact ? 'dshx:h-6' : 'dshx:h-7', 'dshx:pointer-coarse:h-7')}
            data-thread-child-head=""
          >
          <span className="dshx:inline-flex dshx:w-4 dshx:shrink-0 dshx:justify-center" data-thread-child-lead="">
          {childStatus === undefined ? (
            <SessionStatusDot
              session={child}
              unread={props.unreadSessionIds.has(child.id)}
              unreadLabel={t('threadSidebarUnread')}
              attentionLabel={attentionLabel}
              attentionColors={props.rowStyle.attentionColors}
            />
          ) : (
            <StatusGlyph
              status={childStatus.status}
              label={
                childStatus.status === 'ready' && props.unreadSessionIds.has(child.id) ? t('threadSidebarUnread') : t(workStatusLabelKeys[childStatus.status])
              }
            />
          )}
          </span>
          <span
            className={cn(
              'dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-foreground',
              (childStatus === undefined ? props.unreadSessionIds.has(child.id) : childStatus.status === 'ready') && 'dshx:font-semibold',
              childStatus?.status === 'done' && 'dshx:text-muted-foreground',
            )}
          >
            {subagentRowTitle(child)}
          </span>
          {!lineOneWord ? null : (
            <span className={cn('dshx:shrink-0 dshx:text-2xs dshx:font-medium dshx:text-muted-foreground', stateInk)} data-thread-child-state="">
              {stateWord}
            </span>
          )}
          {attentionLabel === undefined ? null : (
            <span
              className={cn(
                'dshx:shrink-0 dshx:text-2xs dshx:font-medium',
                ThreadAttentionPresentationModel.attentionLabelClass(attentionLabel, props.rowStyle.attentionColors),
              )}
            >
              {t(attentionLabel)}
            </span>
          )}
          {/* No age: a child's equals its parent's, and the title and the model need the room (council round 23, item 6). */}
          </span>
          {route === undefined ? null : (
            // Under the title: the glyph's 16px seat and line 1's 8px gap, then the model whole or truncated, then the word.
            <span className="dshx:flex dshx:h-4 dshx:min-w-0 dshx:items-center dshx:gap-1 dshx:pl-6 dshx:text-xs/4 dshx:text-muted-foreground" data-thread-child-meta="">
              <RouteModel provider={route.provider} model={route.model} seat className="dshx:shrink" />
              {stateWord === undefined ? null : (
                <>
                  <span aria-hidden="true" className="dshx:shrink-0">
                    ·
                  </span>
                  {/* A line still too narrow truncates the word first, then the model (round 24, item 3). */}
                  <span className={cn('dshx:min-w-0 dshx:shrink-[100] dshx:truncate', stateInk)} data-thread-child-state="">
                    {stateWord}
                  </span>
                </>
              )}
            </span>
          )}
        </button>
      </li>
    )
  }
  const moreToggle = hiddenCount > 0 || props.allShown
  const finishedToggle = finishedChildThreads.length > 0
  // The list's controls share one muted 12 px footer line after every child (council round 22, item 11): "Show less ·
  // Hide finished", never two full rows between the working children and the failed ones.
  const footerButton = cn(
    // The kit sheet draws the focus ring.
    'dshx:inline-flex dshx:h-6 dshx:shrink-0 dshx:items-center dshx:rounded-sm dshx:px-1 dshx:hover:text-foreground',
    'dshx:pointer-coarse:h-11',
  )
  return (
    <ul className="dshx:mb-1 dshx:ml-3.5 dshx:flex dshx:flex-col dshx:border-l dshx:pl-1.5" aria-label={t('threadSidebarChildThreads')}>
      {shown.map(renderChild)}
      {finishedShown ? finishedChildThreads.map(renderChild) : null}
      {moreToggle || finishedToggle ? (
        <li className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-0.5 dshx:px-1 dshx:text-xs dshx:text-muted-foreground" data-thread-child-footer="">
          {moreToggle ? (
            <button
              type="button"
              className={footerButton}
              aria-expanded={props.allShown}
              onClick={() => props.actions.toggleAllChildren(props.parentId)}
            >
              {props.allShown ? t('threadSidebarFewerChildren') : `${hiddenCount} ${t('threadSidebarMoreChildren')}`}
            </button>
          ) : null}
          {moreToggle && finishedToggle ? <span aria-hidden="true">·</span> : null}
          {finishedToggle ? (
            <button type="button" className={footerButton} aria-expanded={finishedShown} onClick={() => setFinishedShown(current => !current)}>
              {finishedShown ? t('threadSidebarHideFinishedChildren') : `${finishedChildThreads.length} ${t('threadSidebarFinishedChildren')}`}
            </button>
          ) : null}
        </li>
      ) : null}
    </ul>
  )
}

type ThreadContextMenuProps = Pick<
  ThreadRowProps,
  | 'session'
  | 'unread'
  | 'autoSettleOverride'
  | 'mute'
  | 'archived'
  | 'pinned'
  | 'parked'
  | 'settled'
  | 'section'
  | 'workspaceId'
  | 'workspaceTitle'
  | 'workspacePath'
  | 'actions'
  | 'notifyTarget'
> & { readonly children: JSX.Element }

/** One menu for the whole batch: every verb applies to each selected thread the verb can still change. */
const notifyChoiceLabelKeys = {
  off: 'threadSidebarNotifyChoiceOff',
  default: 'threadSidebarNotifyChoiceDefault',
  all: 'threadSidebarNotifyChoiceAll',
  outcomes: 'threadSidebarNotifyChoiceOutcomes',
  stuck: 'threadSidebarNotifyChoiceStuck',
  never: 'threadSidebarNotifyChoiceNever',
} as const satisfies Record<ThreadNotifyChoice, string>

/**
 * The submenu's rows, in reading order (fork fit of upstream qsypsxlt): follow the default level (named), a fixed level,
 * or Off. Upstream's Never (subscribed at the never level) notifies exactly as little as Off, so the menu offers Off
 * only and shows a pair stored at never as Off.
 */
const NOTIFY_MENU_CHOICES = ['default', 'all', 'outcomes', 'stuck', 'off'] as const satisfies readonly ThreadNotifyChoice[]
const notifyLevelLabelKeys = {
  all: 'threadSidebarNotifyChoiceAll',
  outcomes: 'threadSidebarNotifyChoiceOutcomes',
  stuck: 'threadSidebarNotifyChoiceStuck',
  never: 'threadSidebarNotifyChoiceOff',
} as const satisfies Record<Exclude<ThreadNotifyChoice, 'off' | 'default'>, string>

/** Off, follow the default level, or a fixed level for one pair; a batch shows no current choice. */
const NotifyChoiceMenu = (props: {
  /** The subscriber thread's title, named in the submenu label. */
  readonly subscriberTitle: string
  readonly choice: ThreadNotifyChoice | undefined
  /** The level a pair that follows the default gets (`subscriptionNoticeLevel`), named in that row. */
  readonly defaultLevel: Exclude<ThreadNotifyChoice, 'off' | 'default'>
  readonly onChoose: (choice: ThreadNotifyChoice) => void
  readonly t: ThreadSidebarTranslate
}): JSX.Element => (
  <ContextMenuSub>
    <ContextMenuSubTrigger data-testid="thread-sidebar-notify-level">
      <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
        <BellRingIcon aria-hidden="true" />
        {props.t('threadSidebarNotifyOnFinish')}
      </span>
    </ContextMenuSubTrigger>
    <ContextMenuSubContent className="dshx-root dshx:min-w-44 dshx:max-w-72">
      <ContextMenuLabel className="dshx:font-normal dshx:text-muted-foreground">
        {props.t('threadSidebarNotifyOnFinishFor', { title: props.subscriberTitle })}
      </ContextMenuLabel>
      <ContextMenuRadioGroup value={props.choice === 'never' ? 'off' : (props.choice ?? '')}>
        {NOTIFY_MENU_CHOICES.map(choice => (
          <ContextMenuRadioItem key={choice} value={choice} data-notify-choice={choice} onSelect={() => props.onChoose(choice)}>
            {choice === 'default'
              ? props.t('threadSidebarNotifyChoiceDefault', { level: props.t(notifyLevelLabelKeys[props.defaultLevel]) })
              : props.t(notifyChoiceLabelKeys[choice])}
          </ContextMenuRadioItem>
        ))}
      </ContextMenuRadioGroup>
    </ContextMenuSubContent>
  </ContextMenuSub>
)

/** A list key hint for a batch row, on a device that has the key. */
const batchKeys = (keys: string): { readonly keys?: string } => {
  const hint = ThreadMenuModel.keyHint(keys, coarsePointer())
  return hint === undefined ? {} : { keys: hint }
}

const BatchThreadMenuItems = (props: {
  readonly snapshot: BatchSelectionSnapshot
  readonly actions: RowActions
  readonly t: ThreadSidebarTranslate
}): JSX.Element => {
  const snapshot = props.snapshot
  const notifySubscriber = props.actions.batchNotifySubscriber()
  return (
    <>
      <ContextMenuLabel>{props.t('threadSidebarSelectedCount', { count: snapshot.ids.length })}</ContextMenuLabel>
      <ContextMenuSeparator />
      {snapshot.anyUnpinned ? (
        <ContextMenuItem {...batchKeys('P')} onSelect={() => props.actions.batchMutate('pin')}>
          <PinIcon aria-hidden="true" />
          {props.t('threadSidebarPin')}
        </ContextMenuItem>
      ) : null}
      {snapshot.anyPinned ? (
        <ContextMenuItem onSelect={() => props.actions.batchMutate('unpin')}>
          <PinOffIcon aria-hidden="true" />
          {props.t('threadSidebarUnpin')}
        </ContextMenuItem>
      ) : null}
      {snapshot.anyUnsettled ? (
        <ContextMenuItem {...batchKeys('E')} onSelect={() => props.actions.batchSetSettled(true)}>
          <CircleCheckIcon aria-hidden="true" />
          {props.t('threadSidebarSettle')}
        </ContextMenuItem>
      ) : null}
      {snapshot.anySettled ? (
        <ContextMenuItem onSelect={() => props.actions.batchSetSettled(false)}>
          <RotateCcwIcon aria-hidden="true" />
          {props.t('threadSidebarUnsettle')}
        </ContextMenuItem>
      ) : null}
      {snapshot.anyUnparked ? (
        <ContextMenuItem onSelect={() => props.actions.batchSetParked(true)}>
          <AlarmClockIcon aria-hidden="true" />
          {props.t('threadSidebarPark')}
        </ContextMenuItem>
      ) : null}
      {snapshot.anyParked ? (
        <ContextMenuItem onSelect={() => props.actions.batchSetParked(false)}>
          <PlayIcon aria-hidden="true" />
          {props.t('threadSidebarUnpark')}
        </ContextMenuItem>
      ) : null}
      <ContextMenuItem {...batchKeys('U')} onSelect={() => props.actions.batchMarkUnread()}>
        <MailIcon aria-hidden="true" />
        {props.t('threadSidebarMarkUnread')}
      </ContextMenuItem>
      <ContextMenuSub>
        <ContextMenuSubTrigger>
          <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
            <BellIcon aria-hidden="true" />
            {props.t('threadSidebarMute')}
          </span>
        </ContextMenuSubTrigger>
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
      <ContextMenuItem onSelect={() => props.actions.batchCopyLinks()}>
        <LinkIcon aria-hidden="true" />
        {props.t('threadSidebarCopyLinks')}
      </ContextMenuItem>
      {notifySubscriber === undefined ? null : (
        <NotifyChoiceMenu
          subscriberTitle={notifySubscriber.title}
          choice={undefined}
          defaultLevel={props.actions.notifyDefaultLevel()}
          onChoose={choice => props.actions.batchNotify(choice)}
          t={props.t}
        />
      )}
      <ContextMenuSeparator />
      {snapshot.anyLive ? (
        <ContextMenuItem onSelect={() => props.actions.batchMutate('archive')}>
          <ArchiveIcon aria-hidden="true" />
          {props.t('threadSidebarArchive')}
        </ContextMenuItem>
      ) : null}
      {snapshot.anyArchived ? (
        <ContextMenuItem onSelect={() => props.actions.batchMutate('unarchive')}>
          <ArchiveRestoreIcon aria-hidden="true" />
          {/* Two kinds of Restore can meet in one selection; this one says which it is. */}
          {props.t(snapshot.anySettled ? 'threadSidebarRestoreArchived' : 'threadSidebarRestore')}
        </ContextMenuItem>
      ) : null}
      <ContextMenuSeparator />
      <ContextMenuItem onSelect={() => props.actions.clearSelection()}>
        <XIcon aria-hidden="true" />
        {props.t('threadSidebarClearSelection')}
      </ContextMenuItem>
    </>
  )
}

const openRegisteredPanelAside = (panelId: string): void => {
  const registry = workbenchPanels()
  if (registry.get(panelId) === undefined) return
  window.dispatchEvent(new CustomEvent(PANEL_ASIDE_EVENT, { detail: { panelId }, cancelable: true }))
  registry.open(panelId)
}

/** Rows other plugins register for one thread's menu, in their order; nothing when none applies. */
const RegisteredThreadRowActions = (props: { readonly target: ThreadRowActionTarget }): JSX.Element | null => {
  const actions = useRegistry(ThreadRowActions)
  const shown = actions.filter(action => action.isAvailable?.(props.target) ?? true).toSorted((left, right) => (left.order ?? 0) - (right.order ?? 0))
  if (shown.length === 0) return null
  return (
    <>
      {shown.map(action => (
        <ContextMenuItem key={action.id} data-thread-row-action={action.id} onSelect={() => action.run(props.target)}>
          {action.icon === undefined ? <CircleDashedIcon aria-hidden /> : <action.icon aria-hidden />}
          {typeof action.label === 'string' ? action.label : action.label()}
        </ContextMenuItem>
      ))}
    </>
  )
}

/** A touch-first device (the phone rules apply under `pointer: coarse`); read once, it does not change mid-session. */
let coarsePointerMatch: boolean | undefined
const coarsePointer = (): boolean => {
  coarsePointerMatch ??= typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
  return coarsePointerMatch
}

/** A scratch thread's own folder is its Session cwd, or its project folder when the summary carries none. */
const scratchThread = (session: SessionSummary, workspacePath: string | undefined, workspaceTitle: string | undefined): boolean =>
  NoFolderWorkspace.isScratchWorkspace({ path: session.cwd ?? workspacePath ?? '', title: workspaceTitle ?? '' })

const ThreadMenuBody = (props: ThreadContextMenuProps): JSX.Element => {
  const { session, unread, archived, pinned, parked, settled, notifyTarget } = props
  const t = props.actions.translate
  const openAside = useAsideOpen()
  const wakeLockOn = useScreenWakeLock()
  const keepAwakeLabel = ThreadMenuModel.keepAwakeLabel({ coarsePointer: coarsePointer(), available: ScreenWakeLock.available, on: wakeLockOn })
  const registry = workbenchPanels()
  useSyncExternalStore(registry.subscribe, registry.list, registry.list)
  const sidePanelDefinitions = registry.listContextMenuPanels()
  const selection = props.actions.selection()
  if (selection.sessionIds.length > 1 && selection.sessionIds.includes(session.id)) {
    return <BatchThreadMenuItems snapshot={props.actions.batch()} actions={props.actions} t={t} />
  }
  const copy = (value: string, done: ThreadSidebarLabelKey): void => void props.actions.copy(value, t(done))
  const autoDone = (override: AutoSettleOverride, label: ThreadSidebarLabelKey): JSX.Element => (
    <ContextMenuRadioItem
      value={override}
      onSelect={event => {
        event.preventDefault()
        props.actions.setAutoSettleOverride(session.id, override)
      }}
    >
      {t(label)}
    </ContextMenuRadioItem>
  )
  // One menu for a thread (`thread-menu-model.ts`): the header's `⋯` renders the same layout, so this body only says
  // what each entry does for a row. On a phone it is the row's action sheet.
  const entries: ThreadMenuEntries = {
    pin: {
      kind: 'item',
      label: t(pinned ? 'threadSidebarUnpin' : 'threadSidebarPin'),
      keys: 'P',
      ...(pinned ? { icon: <PinOffIcon aria-hidden="true" /> } : undefined),
      onSelect: () => void props.actions.mutate(session.id, pinned ? 'unpin' : 'pin'),
    },
    done: {
      kind: 'item',
      label: t(settled ? 'threadSidebarUnsettle' : 'threadSidebarSettle'),
      keys: 'E',
      disabled: session.running,
      ...(settled ? { icon: <RotateCcwIcon aria-hidden="true" /> } : undefined),
      onSelect: () => props.actions.toggleSettled(session.id),
    },
    snooze: {
      kind: 'item',
      label: t(parked ? 'threadSidebarUnpark' : 'threadSidebarPark'),
      keys: 'H',
      disabled: session.running,
      ...(parked ? { icon: <PlayIcon aria-hidden="true" /> } : undefined),
      onSelect: () => props.actions.toggleParked(session.id),
    },
    restore: { kind: 'item', label: t('threadSidebarRestore'), onSelect: () => void props.actions.mutate(session.id, 'unarchive') },
    rename: { kind: 'item', label: t('threadSidebarRenameThread'), onSelect: () => props.actions.beginRename(session.id) },
    ...(openAside === null ? undefined : { 'side-panel': { kind: 'item', label: t('threadSidebarOpenInSidePanel'), onSelect: () => openAside(session.id) } }),
    // A draft nothing was sent in is not a thread to link to yet.
    ...(session.blank
      ? undefined
      : {
          'copy-link': {
            kind: 'item',
            label: t('threadSidebarCopyLink'),
            onSelect: () => copy(buildThreadUrl(window.location.href, session.id, props.workspaceId), 'threadSidebarLinkCopied'),
          },
        }),
    ...(sidePanelDefinitions.length === 0
      ? undefined
      : {
          'side-panel-views': {
            kind: 'sub',
            label: t('threadSidebarOpenPluginInSidePanel'),
            content: sidePanelDefinitions.map(definition => (
              <ContextMenuItem key={definition.id} onSelect={() => openRegisteredPanelAside(definition.id)}>
                {definition.title}
              </ContextMenuItem>
            )),
          },
        }),
    'continue-in': {
      kind: 'sub',
      label: t('threadSidebarContinueIn'),
      disabled: session.running,
      content: <ContinueInProjectItems t={t} continueIn={projectId => props.actions.continueIn(session.id, projectId)} Item={ContextMenuItem} />,
    },
    'copy-id': { kind: 'item', label: t('threadSidebarCopyId'), onSelect: () => copy(session.id, 'threadSidebarIdCopied') },
    mention: { kind: 'item', label: t('threadSidebarInsertMention'), onSelect: () => requestThreadMentionInsertion(session.id) },
    'follow-up': {
      kind: 'item',
      label: t('threadSidebarFollowUp'),
      disabled: props.workspaceId === undefined,
      onSelect: () => props.actions.followUp(session.id, props.workspaceId),
    },
    mute: {
      kind: 'sub',
      label: t(props.mute === undefined ? 'threadSidebarMute' : 'threadSidebarMuted'),
      ...(props.mute === undefined ? undefined : { icon: <BellOffIcon aria-hidden="true" /> }),
      contentClassName: 'dshx-root dshx:min-w-44',
      content: (
        <>
          {THREAD_MUTE_OPTIONS.map(option => (
            <ContextMenuItem key={option} onSelect={() => props.actions.mute(session.id, option)}>
              {t(muteOptionLabelKeys[option])}
            </ContextMenuItem>
          ))}
          <ContextMenuSeparator />
          <ContextMenuItem disabled={props.mute === undefined} onSelect={() => props.actions.unmute(session.id)}>
            {t('threadSidebarUnmute')}
          </ContextMenuItem>
        </>
      ),
    },
    'mark-unread': { kind: 'item', label: t('threadSidebarMarkUnread'), keys: 'U', disabled: unread, onSelect: () => props.actions.markUnread(session.id) },
    // Keep screen on (plan phone P27): one page-level Screen Wake Lock, offered only on a touch device that has it.
    ...(keepAwakeLabel === undefined
      ? undefined
      : { 'keep-awake': { kind: 'item', label: t(keepAwakeLabel), onSelect: () => void ScreenWakeLock.toggle() } }),
    ...(notifyTarget === undefined
      ? undefined
      : {
          notify: {
            kind: 'rows',
            rows: (
              <NotifyChoiceMenu
                subscriberTitle={notifyTarget.subscriberTitle}
                choice={notifyTarget.choice}
                defaultLevel={props.actions.notifyDefaultLevel()}
                onChoose={choice => props.actions.setNotify(notifyTarget, choice)}
                t={t}
              />
            ),
          },
        }),
    'auto-done': {
      kind: 'sub',
      label: t('threadSidebarAutoSettleBehavior'),
      contentClassName: 'dshx-root dshx:min-w-44',
      content: (
        <ContextMenuRadioGroup value={props.autoSettleOverride}>
          {autoDone('inherit', 'threadSidebarAutoSettleInherit')}
          {autoDone('enabled', 'threadSidebarAutoSettleEnabled')}
          {autoDone('disabled', 'threadSidebarAutoSettleDisabled')}
        </ContextMenuRadioGroup>
      ),
    },
    'move-to-group': {
      kind: 'sub',
      label: t('threadSidebarMoveToSection'),
      contentClassName: 'dshx-root dshx:min-w-44',
      content: SIDEBAR_SECTIONS.map(section => (
        <ContextMenuItem key={section} disabled={section === props.section} onSelect={() => props.actions.moveToSection(session.id, section)}>
          {t(sectionLabels[section])}
        </ContextMenuItem>
      )),
    },
    'referenced-by': {
      kind: 'sub',
      label: t('threadSidebarReferencedBy'),
      contentClassName: 'dshx-root dshx:min-w-56 dshx:max-w-72',
      content: <ThreadReferencesItems sessionId={session.id} t={t} openThread={props.actions.open} Item={ContextMenuItem} />,
    },
    ...(scratchThread(session, props.workspacePath, props.workspaceTitle)
      ? {
          'turn-into-project': {
            kind: 'item',
            label: t('threadSidebarTurnIntoProject'),
            onSelect: () => props.actions.turnIntoProject(session, props.workspacePath),
          },
        }
      : undefined),
    'row-actions': {
      kind: 'rows',
      rows: <RegisteredThreadRowActions target={{ sessionId: session.id, workspaceId: props.workspaceId, archived, running: session.running }} />,
    },
    archive: { kind: 'item', label: t('threadSidebarArchive'), disabled: session.running, onSelect: () => void props.actions.mutate(session.id, 'archive') },
  }
  return (
    <ThreadMenu
      kit={CONTEXT_MENU_KIT}
      entries={entries}
      archived={archived}
      phone={PhoneLayout.matches()}
      coarsePointer={coarsePointer()}
      labels={{ openIn: t('threadSidebarOpenIn'), copy: t('threadSidebarCopy'), more: t('threadSidebarMore') }}
    />
  )
}

/** The list's menu parts, for the shared thread menu. */
const CONTEXT_MENU_KIT: ThreadMenuKit = {
  Item: ContextMenuItem,
  Sub: ContextMenuSub,
  SubTrigger: ContextMenuSubTrigger,
  SubContent: ContextMenuSubContent,
  Separator: ContextMenuSeparator,
}

/** Right-click menu of one thread, shared by thread rows and the usage-limit rows. */
const ThreadContextMenu = (props: ThreadContextMenuProps): JSX.Element => (
  <ContextMenu>
    <ContextMenuTrigger asChild>{props.children}</ContextMenuTrigger>
    <ContextMenuContent
      className="dshx-root dshx:min-w-44"
      aria-label={props.actions.translate('threadSidebarContextMenu')}
      // The right-button release that ends the opening click lands on whatever item the menu placed under the pointer
      // (a long menu shifts up to fit the window), and Radix selects an item on a pointer-up it did not see go down.
      // Only a primary click, a tap or a key chooses an item; marking the event handled stops the item's handler.
      onPointerUpCapture={event => {
        if (event.button === 2) event.preventDefault()
      }}
    >
      <ThreadMenuBody {...props} />
    </ContextMenuContent>
  </ContextMenu>
)

/** Opens a row's right-click menu from a touch control, anchored under that control. */
const ThreadRowMenu = {
  open(row: HTMLElement | null, anchor: HTMLElement): void {
    if (row === null) return
    const rect = anchor.getBoundingClientRect()
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: rect.left, clientY: rect.bottom }))
  },
} as const

/**
 * The 16px project mark that leads a thread row: the project's own icon (favicon, `dsh.project.json` icon) or its
 * neutral monogram, from the Host's cached project-icon resolver. A thread outside any project keeps an empty box of the
 * same size so every title starts on one line. Never a status colour: the status glyph beside it is the only signal.
 */
/**
 * The project's identity tile on a row's second line (b:212a, round five T1): the kit's 16px `ProjectMark`, in the
 * colour picked for the project or its name's tone, so the colour sits on the tile and the name stays muted. With the
 * project colour preference off the tile takes the line's muted ink. It names the project itself when the name beside
 * it gave way to a reason.
 */
const RowProjectMark = memo(
  (props: {
    readonly name: string | undefined
    readonly tone: number | undefined
    readonly color: string | undefined
    readonly palette: ProjectColorPalette
    readonly coloured: boolean
    readonly labelled: boolean
  }): JSX.Element =>
    props.name === undefined ? (
      <span aria-hidden="true" className="dshx:inline-flex dshx:size-4 dshx:shrink-0" data-thread-project-mark="none" />
    ) : (
      <ProjectMark
        name={props.name}
        size="dense"
        tone={props.tone}
        color={props.coloured ? props.color : 'currentColor'}
        palette={props.palette}
        decorative={!props.labelled}
        data-thread-project-mark={props.name}
      />
    ),
)

/**
 * The quiet sign that a thread runs in its own workspace: a branch icon, at most one state word, and the folder name and
 * path in its tooltip only. A thread workspace is a detail of its thread, never a name of its own (b:212a).
 */
const OwnWorkspaceIndicator = (props: {
  readonly workspace: OwnWorkspaceView
  readonly showState: boolean
  readonly t: ThreadSidebarTranslate
}): JSX.Element => {
  const { workspace, t } = props
  const hint = t('threadSidebarOwnWorkspaceHint', { name: workspace.name, path: workspace.path ?? workspace.name })
  const state = props.showState ? workspace.state : undefined
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className="dshx:inline-flex dshx:min-w-0 dshx:shrink-0 dshx:items-center dshx:gap-1"
          data-thread-workspace-indicator=""
          data-workspace-name={workspace.name}
          data-workspace-state={state?.kind}
        >
          <GitBranchIcon aria-hidden="true" className="dshx:size-3 dshx:shrink-0" />
          <span className="dshx:sr-only">{t('threadSidebarOwnWorkspace')}</span>
          {state === undefined ? null : (
            <span
              className="dshx:whitespace-nowrap"
              data-testid={state.kind === 'landed' ? 'thread-sidebar-rebased-tag' : undefined}
              data-landed-at={state.kind === 'landed' && state.at !== undefined ? String(state.at) : undefined}
            >
              {state.text}
            </span>
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" className="dshx:max-w-96 dshx:break-all">
        {hint}
      </TooltipContent>
    </Tooltip>
  )
}

/** Memoized so a session update re-renders only its own row, not the whole list. Exported for its render test. */
export const ThreadRow = memo((props: ThreadRowProps): JSX.Element => {
  const { session, archived, pinned, parked, settled, rowStyle } = props
  const rowRef = useRef<HTMLElement | null>(null)
  const multiSelected = useThreadMultiSelected(props.actions.multiSelection, session.id)
  // Phone: swipe left for Done (settle), right for Pin (T1.3). Touch pointers only; desktop keeps drag-and-drop.
  // A long press shows the row's peek as a sheet (T6.1): the glance a keyboard gets from Space, with the row's menu
  // one tap further (its action sheet). It replaces the context menu trigger's own touch timer.
  const swipe = useRowSwipe(
    coarsePointer() && !props.renaming && !session.running,
    action => {
      if (action === 'done') props.actions.toggleSettled(session.id)
      else void props.actions.mutate(session.id, pinned ? 'unpin' : 'pin')
    },
    coarsePointer() && !props.renaming ? () => props.actions.peek(session.id) : undefined,
  )
  const swipeReveal = RowSwipeModel.revealed(swipe.offset)
  // Offscreen rows keep their content and layout box; only their menus and hover actions wait for the viewport.
  const nearViewport = useNearViewport(rowRef)
  const t = props.actions.translate
  const unread = props.unread
  const compact = rowStyle.density === 'compact'
  const childCount = props.childThreads.length + props.finishedChildThreads.length
  // Line 2 says where the thread runs (b:212a): the project's mark and name, then a quiet own-workspace indicator. Under
  // a project section the header names the project, so the row keeps only the indicator.
  const showMark = props.projectMark === true
  const showProject = rowStyle.project && props.projectMark === true
  const ownWorkspace: OwnWorkspaceView | undefined =
    props.ownWorkspaceName === undefined
      ? undefined
      : {
          name: props.ownWorkspaceName,
          path: props.ownWorkspacePath,
          state:
            props.ownWorkspaceState === undefined || props.ownWorkspaceStateText === undefined
              ? undefined
              : { kind: props.ownWorkspaceState, text: props.ownWorkspaceStateText, at: props.ownWorkspaceStateAt },
        }
  const showMachine = rowStyle.machine && props.machine !== undefined
  const showPath = rowStyle.path && session.cwd !== undefined && session.cwd.length > 0
  const workStatus = props.workStatus
  // A row that just became Needs you, Failed or Ready on screen holds that colour's tint for a moment (round two, item 15).
  const arrival = RowArrivalTintModel.useTint(session.id, workStatus?.status)
  // The status glyph keeps its own 16px seat on line 1; line 2's seat holds the project mark under it.
  const leadSeat = workStatus !== undefined || rowStyle.statusDot
  // The row's verb is an attention verb (round five B3): only a row that needs you or failed carries one. A Ready row's
  // Land lives in the thread header and the row menu, so the list's colour is left to the rows that need you.
  const inlineVerb = workStatus?.status === 'needs-you' || workStatus?.status === 'failed' ? workStatus.verb : undefined
  const showAgent = workStatus !== undefined && props.agent !== undefined
  // "Waiting on 1 subagent" already says what keeps the thread busy; a job chip beside it read as a second count of it.
  const waitingOnSubagents = workStatus?.status === 'working' && !session.running && props.childThreads.length > 0
  const jobCount = waitingOnSubagents ? 0 : (props.runningJobs ?? 0)
  // The same line also names how many it waits on, so the toggle keeps only its chevron (round five B1).
  const childCounterShown = !(waitingOnSubagents && workStatus?.detail !== undefined)
  // Why it needs you leads the second line, so the title keeps the first line to itself.
  const statusDetail =
    workStatus === undefined || (workStatus.status !== 'needs-you' && workStatus.status !== 'failed' && workStatus.detail === undefined)
      ? undefined
      : (workStatus.detail ?? t(workStatusLabelKeys[workStatus.status]))
  // The kind of ask a Needs-you row answers (Question or Approval), never its description: an approval's description
  // often restated the title (round five B2), and a question's excerpt is cut on one line.
  const ask = workStatus?.status === 'needs-you' ? AttentionSubtitleModel.askOf(workStatus.verb) : undefined
  const askKind = ask === undefined ? undefined : t(ask === 'question' ? 'threadSidebarAskQuestion' : 'threadSidebarAskApproval')
  // A working thread trades its static meta for what it is doing now (polish pass b:r4et): its step or the subagent
  // rollup, with the working shimmer. Under a status glyph the spinner and the group already say Working, so a turn
  // with no known step keeps the meta line (where it runs) instead of naming the state again; the dot-only groupings
  // keep the word. The elapsed time takes the first line's time slot, so the row shows one clock, not an age and a clock.
  const live = session.running && (workStatus === undefined || workStatus.status === 'working')
  const liveStep = live ? (workStatus?.detail ?? props.liveTurn?.step ?? (workStatus === undefined ? t('threadSidebarWorking') : undefined)) : undefined
  // An attention row's one line names the kind and then the project as its identity, `Question · [BA] billing-api`
  // (council round 13 B3): the kind of ask on a Needs-you row, the reason on a Failed one, on a desktop and a phone alike,
  // never a cut excerpt (round 12 B4). The project mark moves from the seat under the glyph into the line, before the name.
  const attentionKind = liveStep !== undefined || statusDetail === undefined ? undefined : workStatus?.status === 'failed' ? statusDetail : askKind
  const liveStartedAt = live ? props.liveTurn?.startedAt : undefined
  // The project name only when line 2 has nothing else to say: beside a reason or a step it was cut to "b…" (T1).
  const showProjectName = showProject && liveStep === undefined && statusDetail === undefined
  // A line that names a kind (the ask, the failure, a working reason) reads through the kit's AttentionMeta (council
  // round 14 B1): `[mark] project · kind`, the mark on the rail under the status glyph, the name whole or dropped,
  // never cut to a stub. Without the project preference the mark keeps its own seat and the line names only the kind.
  const metaKind = liveStep === undefined ? (attentionKind ?? statusDetail) : undefined
  // A children count draws its failed clause with the cross and the failed ink, as every surface does (council round
  // 23, item 2): `[BA] billing-api · 6 working · ✕ 1 failed`.
  const countParts = workStatus?.childCounts === undefined ? undefined : workCountParts(workStatus.childCounts, subagentCountWords(t))
  const metaCount = metaKind !== undefined && metaKind === workStatus?.detail && countParts !== undefined ? <WorkCountText parts={countParts} /> : undefined
  // A running parent's count keeps the shimmer on its routine clauses; the failed clause follows in its own ink.
  const liveCount = liveStep !== undefined && liveStep === workStatus?.detail ? countParts : undefined
  const liveProblems = liveCount?.filter(part => part.tone !== 'plain') ?? []
  const liveStepText =
    liveCount === undefined || liveProblems.length === 0
      ? liveStep
      : liveCount
          .filter(part => part.tone === 'plain')
          .map(part => part.text)
          .join(WORK_COUNT_SEPARATOR)
  const metaRail = metaKind !== undefined && showProject
  // A desktop attention row keeps the project's name before the kind: its status glyph and its verb already say the
  // kind, and the sidebar is too narrow for both beside the verb. The phone list has room for both, and a working
  // reason is the line's news, so those keep the kind.
  const metaKeep = attentionKind !== undefined && !coarsePointer() ? 'name' : 'kind'
  const metaLine =
    liveStep !== undefined ||
    (showMark && props.workspacePath !== undefined) ||
    showProject ||
    ownWorkspace !== undefined ||
    props.parentTitle !== undefined ||
    showMachine ||
    showPath ||
    childCount > 0 ||
    showAgent ||
    jobCount > 0 ||
    statusDetail !== undefined
  const headLine = rowStyle.title || rowStyle.time || rowStyle.statusDot || props.integrationQueuedAt !== undefined || (props.subscriberCount ?? 0) > 0
  // Line 1 is the title at full width and the time; the verb takes line 2's trailing edge (round five T1), beside the
  // subagent counter when there is one, at its own reserved width so the question keeps the rest of the line (C14).
  // A row with no second line keeps the verb at the first line's end.
  const verbSeat = inlineVerb === undefined ? undefined : metaLine ? 'meta' : 'head'
  // One layer of colour (council round 8 B3): the row keeps its Needs-you or Failed wash, so its verb is text in the
  // attention or danger foreground on a transparent fill, tinted only on hover and press. A Ready row's Land stays an
  // outline, so the ink primary is left to the page.
  const verbVariant = workStatus?.status === 'needs-you' ? 'attention-text' : workStatus?.status === 'failed' ? 'danger-text' : 'outline'
  // A Needs-you or Failed title may take two lines (13/18, 550): it is the row you act on, so it reads whole.
  const wrapTitle = workStatus?.status === 'needs-you' || workStatus?.status === 'failed'
  // Colour in the list (round five T2): Needs you and Failed hold a soft wash of their hue after the arrival tint fades.
  const rowWash = workStatus?.status === 'needs-you' || workStatus?.status === 'failed' ? workStatus.status : undefined
  const verbButton =
    inlineVerb === undefined || workStatus === undefined ? null : (
      <Button
        type="button"
        size="xs"
        variant={verbVariant}
        // Above the neighbouring rows, so its 44 px touch area is not covered by the row painted after it. On touch it is
        // 28px, the height of the row it sits in (round five B1).
        className="dshx:z-10 dshx:h-6 dshx:px-2 dshx:pointer-coarse:h-7"
        data-testid="thread-row-verb"
        data-verb={inlineVerb}
        onClick={() => props.actions.actOnStatus(session.id, workStatus)}
      >
        {t(inlineVerbLabelKeys[inlineVerb])}
      </Button>
    )
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
          <ArchiveRestoreIcon strokeWidth={1.5} size={14} />
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
          {pinned ? <IconPinFillRegular size={14} /> : <PinIcon strokeWidth={1.5} size={14} />}
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
          {/* Snooze is a clock, not a pause (council round 29, item 12). */}
          {parked ? <PlayIcon strokeWidth={1.5} size={14} /> : <AlarmClockIcon strokeWidth={1.5} size={14} />}
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
          {settled ? <PlayIcon strokeWidth={1.5} size={14} /> : <CircleCheckIcon strokeWidth={1.5} size={14} />}
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
        <ArchiveIcon strokeWidth={1.5} size={14} />
      </Button>,
    )
  }

  // The hover actions sit in the first line's time slot, over the time (kept in place, invisible), so line 1 never
  // reflows. `⋯` always shows there; each further action shows only once the row is measured and its button starts
  // clear of the resting title's last glyph (`HoverStripFit`, round 29 item 1), so a click on the title opens the
  // thread. The strip fades in on enter only (round 28, item 11): on mouse-out it goes at once, as the time comes back.
  const hoverActions = nearViewport
    ? props.rowActions.flatMap(action => {
        const element = renderRowAction(action)
        return element === null ? [] : [{ action, element }]
      })
    : []
  const stripSeats = nearViewport ? hoverActions.length + 1 : 0
  const fitStrip = (): void => {
    if (rowRef.current !== null && stripSeats > 1) HoverStripFit.apply(rowRef.current)
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
      workspaceTitle={props.workspaceTitle}
      workspacePath={props.workspacePath}
      actions={props.actions}
      notifyTarget={props.notifyTarget}
    >
      <article
        ref={rowRef}
        className={cn('dshx:group/row dshx:relative dshx:min-w-0', props.dragging && 'dshx:opacity-50')}
        data-thread-id={session.id}
        data-selected={props.selected}
        data-unread={unread ? '' : undefined}
        data-settled={props.settled ? '' : undefined}
        data-thread-section-row={props.section === undefined ? undefined : ''}
        onContextMenu={captureThreadMentionInsertion}
        data-row-gestures=""
        // The strip's seats are measured as the pointer enters the row, or focus moves into it (round 29, item 1).
        onMouseEnter={fitStrip}
        onFocusCapture={fitStrip}
        {...swipe.handlers}
      >
        {swipeReveal === undefined ? null : (
          <div
            aria-hidden="true"
            data-row-swipe-reveal={swipeReveal}
            className={cn(
              'dshx:absolute dshx:inset-0 dshx:flex dshx:items-center dshx:rounded-md dshx:bg-muted dshx:px-4 dshx:text-sm dshx:font-medium dshx:text-foreground',
              swipeReveal === 'done' ? 'dshx:justify-end' : 'dshx:justify-start',
            )}
          >
            {swipeReveal === 'done' ? t(settled ? 'threadSidebarUnsettle' : 'threadSidebarSwipeDone') : t(pinned ? 'threadSidebarUnpin' : 'threadSidebarPin')}
          </div>
        )}
        <div
          className={cn(
            'dshx:relative dshx:rounded-md dshx:group-data-[selected=true]/row:text-foreground dshx:pointer-coarse:touch-pan-y',
            // Hover deepens an attention row's wash (council round 28, item 10: ink at 3%, 8% in dark, AA held) instead
            // of trading it for the grey fill; a plain row takes the grey fill. Runtime tokens: the kit's `--color-*`
            // names are `@theme inline` and do not exist in the page.
            rowWash === undefined && 'dshx:hover:bg-accent/60 dshx:focus-within:bg-accent/60',
            rowWash === 'needs-you' &&
              'dshx:hover:bg-[color-mix(in_oklab,var(--dshx-wash-needs-you),var(--dsw-alias-label-primary)_3%)] dshx:focus-within:bg-[color-mix(in_oklab,var(--dshx-wash-needs-you),var(--dsw-alias-label-primary)_3%)] dshx:dark:hover:bg-[color-mix(in_oklab,var(--dshx-wash-needs-you),var(--dsw-alias-label-primary)_8%)] dshx:dark:focus-within:bg-[color-mix(in_oklab,var(--dshx-wash-needs-you),var(--dsw-alias-label-primary)_8%)]',
            rowWash === 'failed' &&
              'dshx:hover:bg-[color-mix(in_oklab,var(--dshx-wash-failed),var(--dsw-alias-label-primary)_3%)] dshx:focus-within:bg-[color-mix(in_oklab,var(--dshx-wash-failed),var(--dsw-alias-label-primary)_3%)] dshx:dark:hover:bg-[color-mix(in_oklab,var(--dshx-wash-failed),var(--dsw-alias-label-primary)_8%)] dshx:dark:focus-within:bg-[color-mix(in_oklab,var(--dshx-wash-failed),var(--dsw-alias-label-primary)_8%)]',
            // Selection is the quieter cue (round five B3): its low-chroma wash plus the leading accent bar. A Needs-you or
            // Failed row keeps its stronger attention wash when selected and takes only the bar.
            'dshx:group-data-[selected=true]/row:selected-marker',
            // A row led by its status glyph draws no pill, so the kit's selected edge (a neutral 1px inset, 3:1 on the
            // wash) outlines the wash (council round 12 B1): the wash alone measured 1.10:1 off the dark list.
            rowWash === undefined && 'dshx:group-data-[selected=true]/row:bg-selected-wash dshx:group-data-[selected=true]/row:selected-edge',
            // The phone list is a list you leave for the thread (council round 17 B1.2): its current row keeps the wash and
            // the 550 title, not the outline, which read as a focus ring on a phone.
            rowWash === undefined && 'dshx:phone:group-data-[selected=true]/row:shadow-none',
            swipe.offset === 0 ? 'dshx:transition-transform dshx:duration-150' : 'dshx:bg-(--dsw-specific-sidebar-fill)',
            swipe.offset === 0 && rowWash === 'needs-you' && 'dshx:bg-wash-needs-you',
            swipe.offset === 0 && rowWash === 'failed' && 'dshx:bg-wash-failed',
          )}
          data-row-wash={rowWash}
          // A selected Needs-you or Failed row keeps its attention wash, not the selected wash, so it keeps the pill as its
          // selection cue although it leads with a status glyph (council round 11 B3, kit A1).
          {...(rowWash === undefined ? {} : MARKER_KEEP)}
          style={swipe.offset === 0 ? undefined : { transform: `translateX(${String(swipe.offset)}px)` }}
        >
          {arrival.tint === undefined ? null : <RowArrivalTintModel.Tint key={arrival.tint.key} tint={arrival.tint} onEnd={arrival.end} />}
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
              data-work-status={workStatus?.status}
              className={cn(
                'dshx:@container/row dshx:relative dshx:flex dshx:w-full dshx:min-w-0 dshx:flex-col dshx:rounded-md dshx:text-left dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:disabled:cursor-default',
                // A press answers within 80ms (DESIGN.md › Motion), on a phone tap as on a click.
                'dshx:transition-[background-color] dshx:duration-(--dshx-duration-hover) dshx:active:bg-accent',
                compact ? 'dshx:gap-0.5 dshx:px-2 dshx:py-1.5' : 'dshx:gap-1 dshx:px-2.5 dshx:py-2.5',
                // The phone gutter (round nine B4): the row fills from 12px, its glyph starts at 24px (the leading side
                // only: the trailing side keeps the row menu's 44px column).
                'dshx:phone:pl-3',
                // Phone rows are a two-row grid (round five B1): [title | time ⋯] over [subtitle | verb], 6px apart, at
                // least 52pt tall, whatever the density preference, so the first Ready row shows above the tab bar.
                // Council round 18 B1.3: one pitch on every row, an 18px title line, 6px and a 16px line 2 (23pt centre to
                // centre); 6px padding fills the 52pt exactly, so line 2's centre is 14px above every row's bottom.
                'dshx:pointer-coarse:min-h-13 dshx:pointer-coarse:justify-center dshx:pointer-coarse:gap-1.5 dshx:pointer-coarse:py-1.5',
                // Touch: the row's actions menu button takes the top-right corner's column.
                'dshx:pointer-coarse:pr-11',
                'dshx:data-[multi-selected=true]:bg-info/15 dshx:data-[multi-selected=true]:ring-1 dshx:data-[multi-selected=true]:ring-inset dshx:data-[multi-selected=true]:ring-info/40',
              )}
              data-thread-id={session.id}
              data-thread-main-action=""
              data-multi-selected={multiSelected ? 'true' : undefined}
              aria-current={props.selected ? 'page' : undefined}
              title={new Date(session.updatedAt).toLocaleString()}
              onClick={() => props.actions.open(session.id)}
              onDoubleClick={() => keepThreadTab(session.id)}
            >
              {headLine ? (
                <span
                  className={cn(
                    'dshx:flex dshx:min-w-0 dshx:gap-2',
                    // A two-line title keeps the glyph and the time on its first line.
                    wrapTitle ? 'dshx:items-start' : 'dshx:items-center',
                    // A row without a second line keeps the verb on this one; on touch the verb also sits left of the
                    // row menu button.
                    verbSeat === 'head' && 'dshx:pr-17.5 dshx:pointer-coarse:pr-19',
                    // Without a time column, line 1 keeps one seat free for `⋯` (round 29, item 1).
                    stripSeats > 0 && !rowStyle.time && verbSeat !== 'head' && 'dshx:not-pointer-coarse:pr-6',
                  )}
                  data-thread-head=""
                >
                  {(() => {
                    const status =
                      workStatus !== undefined ? (
                        <StatusGlyph
                          status={workStatus.status}
                          // An unread Ready row keeps the accessible name the dot had, so "Unread" still finds it.
                          label={workStatus.status === 'ready' && unread ? t('threadSidebarUnread') : t(workStatusLabelKeys[workStatus.status])}
                        />
                      ) : rowStyle.statusDot ? (
                        <SessionStatusDot
                          session={session}
                          unread={unread}
                          unreadLabel={t('threadSidebarUnread')}
                          attentionLabel={props.attentionLabel}
                          attentionColors={rowStyle.attentionColors}
                        />
                      ) : null
                    // The glyph has its own seat (b:212a), where the project mark used to carry it as a corner badge: the
                    // mark moved to line 2. The seat is the kit's 20px rail seat, the glyph centred in it (council round
                    // 15 B1), so the status glyph and the project mark under it share one centre axis and the name
                    // starts under the title; the 16px glyph box sits inside it.
                    return status === null ? null : (
                      <span
                        className={cn(
                          'dshx:inline-flex dshx:h-4 dshx:w-[var(--attention-meta-rail-seat,20px)] dshx:shrink-0 dshx:items-center dshx:justify-center',
                          wrapTitle && 'dshx:mt-px',
                        )}
                        data-thread-lead=""
                        // A row led by its status glyph draws no marker pill beside it (council round 11 B3, kit A1): the
                        // selected wash and the 550 title carry the selection. An attention row keeps the pill through
                        // `MARKER_KEEP` on its fill.
                        {...LEADING_GLYPH_ATTRIBUTE}
                      >
                        {status}
                      </span>
                    )
                  })()}
                  {props.mute === undefined ? null : <MutedMarker mute={props.mute} t={t} />}
                  <span
                    data-thread-title=""
                    className={cn(
                      'dshx:min-w-0 dshx:flex-1 dshx:text-foreground',
                      wrapTitle
                        ? 'dshx:line-clamp-2 dshx:text-sm/[18px] dshx:font-[550] dshx:break-words'
                        : cn('dshx:truncate dshx:pointer-coarse:leading-[18px]', compact ? 'dshx:text-sm' : 'dshx:text-base'),
                      // Dark cockpit: in the status list only Ready rows are bold and Done rows are muted.
                      (workStatus === undefined ? unread : workStatus.status === 'ready') ? 'dshx:font-semibold' : 'dshx:group-data-[selected=true]/row:font-selected',
                      workStatus?.status === 'done' && 'dshx:text-muted-foreground',
                    )}
                  >
                    {rowStyle.title ? session.displayTitle : null}
                  </span>
                  {workStatus !== undefined || props.attentionLabel === undefined ? null : (
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
                  {props.subscriberCount === undefined || props.subscriberCount === 0
                    ? null
                    : withTooltip(
                        t('threadSidebarNotifySubscribersHint', { count: props.subscriberCount }),
                        <Badge
                          variant="secondary"
                          aria-label={t('threadSidebarNotifySubscribersHint', { count: props.subscriberCount })}
                          data-testid="thread-sidebar-subscribers-tag"
                        >
                          {t('threadSidebarNotifySubscribers', { count: props.subscriberCount })}
                        </Badge>,
                      )}
                  {rowStyle.time && verbSeat !== 'head' ? (
                    // The spinner and the live activity line say Working; the time stays colourless (DESIGN.md).
                    <span
                      className={cn(
                        'dshx:shrink-0 dshx:text-xs dshx:tabular-nums dshx:text-muted-foreground',
                        wrapTitle && 'dshx:mt-px',
                        // At least one seat wide, right-aligned, so the strip's `⋯` lies over the time, never the title.
                        stripSeats > 0 && 'dshx:not-pointer-coarse:min-w-6 dshx:not-pointer-coarse:text-right',
                        stripSeats > 0 &&
                          // Kept in place, so line 1 never reflows; the strip covers its slot (round 28, item 11).
                          'dshx:not-pointer-coarse:group-hover/row:invisible dshx:not-pointer-coarse:group-has-[[data-row-strip]:focus-within]/row:invisible',
                      )}
                      data-thread-time=""
                    >
                      {liveStartedAt === undefined ? props.age : <LiveElapsed active={nearViewport} since={liveStartedAt} format={wholeUnit} />}
                    </span>
                  ) : null}
                </span>
              ) : null}
              {metaLine ? (
                <span
                  className={cn(
                    'dshx:flex dshx:min-h-4 dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:text-muted-foreground',
                    // Room for the subagent counter at this line's end; the verb beside it holds its own width through
                    // the invisible copy at the line's end (council round 14 B1).
                    // Touch: the chevron alone is a 44pt toggle in the time column (council round 18 B1.3).
                    childCount > 0 && (childCounterShown ? (verbSeat === 'meta' ? 'dshx:pr-18' : 'dshx:pr-16') : 'dshx:pr-8 dshx:pointer-coarse:pr-11'),
                    // Touch: line 2 is 16px on every row (council round 18 B1.3), so every row keeps one title-to-meta
                    // pitch; the 28px verb centres on it from outside instead of stretching it to 28px.
                    'dshx:pointer-coarse:h-4 dshx:pointer-coarse:text-xs/4',
                  )}
                  data-thread-where=""
                >
                  {/* Line 2 is where the thread runs (b:212a): the project mark sits in the seat under the status glyph,
                      so the project name lines up with the title. Its 8px gap matches line 1's. */}
                  {!metaRail && (leadSeat || showMark) ? (
                    <span
                      data-thread-mark-seat=""
                      className="dshx:mr-0.5 dshx:inline-flex dshx:w-[var(--attention-meta-rail-seat,20px)] dshx:shrink-0 dshx:justify-center"
                    >
                      {showMark ? (
                        <RowProjectMark
                          name={props.workspaceTitle}
                          tone={props.projectChipTone}
                          color={props.projectChipColor}
                          palette={rowStyle.projectPalette}
                          coloured={rowStyle.projectColor}
                          labelled={!showProjectName}
                        />
                      ) : null}
                    </span>
                  ) : null}
                  {metaKind === undefined ? null : (
                    // The kind stays whole; the name beside the rail's mark is whole or gone (the kit measures it), so a
                    // narrow column never shows "billing…". 12/16 in the secondary ink, the title being the row's ink.
                    // The rail's 20px seat and 8px gap match line 1's glyph seat and gap, so the name starts under the title.
                    <AttentionMeta
                      data-testid="thread-row-status-kind"
                      markSeat={metaRail ? 'rail' : 'inline'}
                      project={metaRail ? props.workspaceTitle : undefined}
                      kind={metaKind}
                      kindContent={metaCount}
                      keep={metaKeep}
                      data-keep={metaKeep}
                      mark={{
                        tone: props.projectChipTone,
                        color: rowStyle.projectColor ? props.projectChipColor : 'currentColor',
                        palette: rowStyle.projectPalette,
                        'data-thread-project-mark': props.workspaceTitle,
                      }}
                    />
                  )}
                  {liveStepText === undefined ? null : (
                    <LiveActivityLine
                      active={nearViewport}
                      // With the time column off, the clock stays beside the step.
                      startedAt={rowStyle.time ? undefined : liveStartedAt}
                      step={liveStepText}
                      after={liveProblems.length === 0 ? undefined : <WorkCountText leadingSeparator parts={liveProblems} className="dshx:-ml-1 dshx:shrink-0" />}
                      className="dshx:min-w-0 dshx:flex-1"
                    />
                  )}
                  {showProjectName ? (
                    // Muted: the tile carries the project's colour (round five T1). The first text to give way on a
                    // short row: it truncates, then hides, before the mark does.
                    <span className="dshx:min-w-0 dshx:shrink dshx:truncate dshx:@max-[11rem]/row:hidden" data-testid="thread-row-project">
                      {props.workspaceTitle ?? t('threadSidebarUnassigned')}
                    </span>
                  ) : null}
                  {ownWorkspace === undefined ? null : <OwnWorkspaceIndicator workspace={ownWorkspace} showState={liveStep === undefined} t={t} />}
                  {jobCount === 0 ? null : (
                    <span className="dshx:shrink-0 dshx:rounded-sm dshx:bg-muted dshx:px-1 dshx:text-muted-foreground" data-thread-jobs="">
                      {plural(t, 'threadSidebarRunningJobs', jobCount)}
                    </span>
                  )}
                  {showAgent ? (
                    <span className="dshx:shrink-0 dshx:truncate dshx:max-w-[35%]" data-testid="thread-row-agent">
                      @{props.agent}
                    </span>
                  ) : null}
                  {props.parentTitle === undefined || liveStep !== undefined ? null : (
                    <span className="dshx:min-w-0 dshx:truncate">
                      {t('threadSidebarChildOf')} {props.parentTitle}
                    </span>
                  )}
                  {showMachine && liveStep === undefined ? (
                    <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1">
                      <MonitorIcon className="dshx:size-3 dshx:shrink-0" aria-hidden="true" />
                      <span className="dshx:truncate">{props.machine}</span>
                    </span>
                  ) : null}
                  {showPath && liveStep === undefined ? (
                    <span className="dshx:min-w-0 dshx:truncate" title={session.cwd}>
                      {session.cwd}
                    </span>
                  ) : null}
                  {verbSeat === 'meta' && inlineVerb !== undefined ? (
                    // The verb's seat, sized to the verb (council round 14 B1): an invisible copy of its label in the
                    // button's xs metrics. The verb itself sits outside this button (a button cannot hold one); its
                    // corner is 8px further out than this line's end (its label ends where the age does, council round
                    // 17 B1.2; touch: beside a counter 4px), so the copy gives that back. Only its width counts: it keeps
                    // the line's 16px, so line 2 never grows.
                    <span
                      aria-hidden="true"
                      data-verb-reserve=""
                      className={cn(
                        'dshx:invisible dshx:inline-flex dshx:h-4 dshx:shrink-0 dshx:items-center dshx:px-2 dshx:text-xs/4 dshx:font-medium dshx:whitespace-nowrap',
                        childCount > 0 ? 'dshx:-mr-2 dshx:pointer-coarse:-mr-1' : 'dshx:-mr-2',
                      )}
                    >
                      {t(inlineVerbLabelKeys[inlineVerb])}
                    </span>
                  ) : null}
                </span>
              ) : null}
            </button>
          )}
          {childCount > 0 || (verbSeat === 'meta' && !props.renaming) ? (
            // Line 2's trailing edge: the verb, then the subagent counter. The 24px verb centres on line 2 (6px under a
            // comfortable row, 2px under a compact one); touch moves it left of the row menu button's column. The verb's
            // label and the chevron's glyph both sit 8px inside this box, so it stands 8px outside the row's padding:
            // the age, the verb and the chevron end on one edge (council round 17 B1.2).
            <div
              data-thread-row-end=""
              data-verb-seat={verbSeat === 'meta' ? 'meta' : undefined}
              className={cn(
                'dshx:absolute dshx:flex dshx:items-center dshx:gap-1',
                compact ? 'dshx:right-0' : 'dshx:right-0.5',
                verbSeat !== 'meta' || props.renaming
                  ? // Touch: a chevron alone leaves the row menu's column (council round 18 B1.3: the two stacked in one
                    // 44pt square); it ends the time column on line 2, where a verb sits, centred on that line.
                    'dshx:bottom-1 dshx:pointer-coarse:right-11 dshx:pointer-coarse:bottom-0'
                  : // Touch: the verb's label ends where the time above it does (round nine B5: its 8px padding reaches into
                    // the row menu's column), and its 28px centres on line 2 (14px above the row's bottom, council round
                    // 18 B1.3), so it never meets the time (round five B1). Beside a subagent counter the counter ends the
                    // line, left of that column.
                    cn(
                      compact ? 'dshx:bottom-0.5' : 'dshx:bottom-1.5',
                      'dshx:pointer-coarse:bottom-0',
                      childCount > 0 ? 'dshx:pointer-coarse:right-11' : 'dshx:pointer-coarse:right-9',
                    ),
              )}
            >
              {verbSeat === 'meta' && !props.renaming ? verbButton : null}
              {childCount > 0 ? (
            <button
              type="button"
              data-thread-children-toggle=""
              // 24 px tall, the chevron in its own 24 px seat; the kit gives a raw button its 44 px hit area on touch.
              // Touch (council round 18 B1.3): 28px like the verb and at least 44pt wide, so its hit area ends where the
              // row menu's column starts instead of reaching into it.
              className="dshx:flex dshx:h-6 dshx:items-center dshx:gap-1 dshx:rounded-md dshx:pl-1.5 dshx:text-xs dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:pointer-coarse:h-7 dshx:pointer-coarse:min-w-11 dshx:pointer-coarse:justify-end"
              aria-expanded={props.childrenOpen}
              aria-label={`${t(props.childrenOpen ? 'threadSidebarHideChildren' : 'threadSidebarShowChildren')} (${childCount})`}
              onClick={() => props.actions.toggleChildren(session.id, props.childrenOpen)}
            >
              {childCounterShown ? (
              <span className="dshx:flex dshx:-space-x-0.5" aria-hidden="true">
                {props.childThreads.slice(0, 3).map(child => {
                  const attentionLabel = props.childAttentionLabels.get(child.id)
                  return (
                    <StatusDot
                      key={child.id}
                      className={cn(
                        'dshx:ring-1 dshx:ring-background',
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
              ) : null}
              {childCounterShown ? <span className="dshx:tabular-nums dshx:font-medium">{childCount}</span> : null}
              {/* A real chevron in a 24 px seat (round five B3), not a 12 px caret: it turns over when the sub-rows open. */}
              {/* Touch: the seat reaches 8px past the toggle so the glyph (4px seat inset, 4px of its own) ends on the time's
                  edge; drawn only, so the overhang takes no taps from the row menu beside it. */}
              <span
                className="dshx:pointer-events-none dshx:inline-flex dshx:size-6 dshx:items-center dshx:justify-center dshx:pointer-coarse:-mr-2"
                data-children-chevron=""
                aria-hidden="true"
              >
                <ChevronDownIcon
                  className={cn('dshx:size-4 dshx:transition-transform dshx:duration-(--dshx-duration-hover)', props.childrenOpen && 'dshx:rotate-180')}
                  strokeWidth={1.5}
                />
              </span>
            </button>
              ) : null}
            </div>
          ) : null}
          {props.renaming || (verbSeat !== 'head' && !nearViewport) ? null : (
            // The first line's corner: the hover actions in the time slot. A verb on a one-line row shares it, and the
            // actions then open to its left, so neither ever covers the other.
            <div
              data-testid="thread-row-overlay"
              data-verb-seat={verbSeat === 'head' ? 'head' : undefined}
              className={cn(
                'dshx:absolute dshx:top-1 dshx:right-1.5 dshx:flex dshx:items-center',
                // Touch: the row's actions menu button takes the top-right corner, so the verb moves left of it.
                verbSeat === 'head' && 'dshx:pointer-coarse:right-11',
              )}
            >
              {verbSeat === 'head' ? verbButton : null}
              {nearViewport ? (
                <div
                  data-testid="thread-row-actions"
                  data-row-strip=""
                  className={cn(
                    'dshx:pointer-events-none dshx:absolute dshx:flex dshx:gap-0.5 dshx:opacity-0 dshx:transition-none dshx:group-hover/row:transition-opacity dshx:group-hover/row:pointer-events-auto dshx:group-hover/row:opacity-100 dshx:focus-within:pointer-events-auto dshx:focus-within:opacity-100 dshx:pointer-coarse:hidden',
                    verbSeat !== 'head'
                      ? 'dshx:-top-0.5 dshx:right-0'
                      : // Beside a first-line verb the strip takes the seat line 1 gives it left of the verb, as every row's
                        // strip does in the time slot: nothing floats over the title.
                        'dshx:top-1/2 dshx:right-full dshx:mr-1 dshx:-translate-y-1/2',
                  )}
                >
                  {hoverActions.map(({ action, element }) => (
                    // Hidden until `HoverStripFit` measures the row and finds the seat clear of the title; `⋯` keeps it.
                    <span
                      key={action}
                      data-strip-seat=""
                      // Every verb but Open in side panel changes the thread: it keeps a seat's distance from the title.
                      data-strip-changes={action === 'aside' ? undefined : ''}
                      className="dshx:hidden dshx:data-[strip-on]:contents"
                    >
                      {element}
                    </span>
                  ))}
                  {/* Every other verb of the row: the same menu a right-click opens. */}
                  {withTooltip(
                    t('threadSidebarContextMenu'),
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={t('threadSidebarContextMenu')}
                      aria-haspopup="menu"
                      onClick={event => ThreadRowMenu.open(rowRef.current, event.currentTarget)}
                    >
                      <OverflowGlyph />
                    </Button>,
                  )}
                </div>
              ) : null}
            </div>
          )}
          {nearViewport && !props.renaming ? (
            // Touch has no hover and iOS WebKit fires no contextmenu on a long press: this button opens the row's own
            // actions menu (the right-click menu, which also holds every hover action) at the button.
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              data-testid="thread-row-menu"
              aria-label={t('threadSidebarContextMenu')}
              aria-haspopup="menu"
              // The row's only menu on a phone, so it stays; in the tertiary ink it no longer reads as row content
              // beside the age (council round 17 B1.2). Council round 18 B1.3: a 44pt seat flush with the row's edge (its
              // hit area no longer overflows the row), its glyph on one axis down the list, centred on line 1.
              className="dshx:absolute dshx:top-1 dshx:right-1 dshx:hidden dshx:text-(--dsw-alias-label-tertiary) dshx:pointer-coarse:inline-flex dshx:pointer-coarse:top-px dshx:pointer-coarse:right-0 dshx:pointer-coarse:w-11"
              onClick={event => ThreadRowMenu.open(rowRef.current, event.currentTarget)}
            >
              <OverflowGlyph />
            </Button>
          ) : null}
        </div>
        {childCount > 0 && props.childrenOpen ? (
          <ChildThreadList
            parentId={session.id}
            childThreads={props.childThreads}
            finishedChildThreads={props.finishedChildThreads}
            launchOrder={props.childLaunchOrder}
            unreadSessionIds={props.unreadSessionIds}
            allShown={props.allChildrenShown}
            selectedChildId={props.selectedChildId}
            attentionLabels={props.childAttentionLabels}
            rowStyle={rowStyle}
            actions={props.actions}
            childStatuses={props.childStatuses}
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

const NO_GROUPED_THREADS: readonly SidebarGroupedThread[] = []

const groupedThreadKey = (thread: SidebarGroupedThread): string =>
  thread.kind === 'local' ? thread.session.id : `remote:${thread.remote.runtimeId}:${thread.remote.sessionId}`

const groupedThreadId = (thread: SidebarGroupedThread): string => (thread.kind === 'local' ? thread.session.id : thread.remote.sessionId)

const EMPTY_UNSENT_DRAFTS: Readonly<Record<string, SessionDraft>> = Object.freeze({})

const EMPTY_HOISTED_SESSIONS: readonly SessionSummary[] = []
const NO_VIEW_MENU_THREAD_IDS: readonly string[] = []
const EMPTY_HOISTED_USAGE_LIMIT_ROWS: readonly UsageLimitRow<SessionSummary>[] = []
const ABSENT_CURRENT_SESSION_ID: ObservableSnapshot<string | undefined> = {
  getSnapshot: () => undefined,
  subscribe: () => () => undefined,
}

/** How long after a press in the list (or a menu) a list change counts as the user's own and skips the hold. */
const USER_CHANGE_WINDOW_MS = 3_000

/** The id a grouped row holds its place by: a local thread's Session, or a remote thread's runtime and Session. */
const heldGroupedThreadId = (
  thread:
    | { readonly kind: 'local'; readonly session: SessionSummary }
    | { readonly kind: 'remote'; readonly remote: { readonly runtimeId: string; readonly sessionId: string } },
): string => (thread.kind === 'local' ? thread.session.id : `${thread.remote.runtimeId}:${thread.remote.sessionId}`)

const ThreadSidebarContent = (props: ThreadSidebarProps): JSX.Element => {
  const surface = props.surface ?? 'sidebar'
  const isBoard = surface === 'board'
  // Both surfaces can be mounted at once: URL ownership, notifications, attention polling and the auto-archive/settle
  // scans stay with the sidebar mount, so one session change is never handled twice.
  const isPrimarySurface = !isBoard
  const plugin = usePlugin()
  const hostSessionState = props.useSessions(HostSnapshotsModel.selectStableSessionListState)
  const subscribeDrafts = useCallback((listener: () => void) => props.drafts?.subscribe(listener) ?? (() => undefined), [props.drafts])
  const readDrafts = useCallback(() => props.drafts?.getSnapshot() ?? EMPTY_UNSENT_DRAFTS, [props.drafts])
  const unsentDrafts = useSyncExternalStore(subscribeDrafts, readDrafts, readDrafts)
  const translateDraft = props.tSidebar
  const presentedUnsentRows = useRef(new WeakMap<SessionSummary, SessionSummary>())
  const sessionState = useMemo(() => {
    const byId = presentUnsentRows({
      byId: hostSessionState.byId,
      drafts: unsentDrafts,
      newChatLabel: translateDraft('threadSidebarNewChat'),
      draftLabel: preview => translateDraft('threadSidebarUnsentDraft', { preview }),
      presented: presentedUnsentRows.current,
    })
    return byId === hostSessionState.byId ? hostSessionState : { ...hostSessionState, byId }
  }, [hostSessionState, unsentDrafts, translateDraft])
  const sessionStatus = props.useSessionStatus(HostSnapshotsModel.selectStableSessionStatus)
  const workspaceState = props.useWorkspaces(state => state)
  // Every workspace frame re-emits all items and id lists as new objects; derivations key on content.
  const workspaceItems = HostSnapshotsModel.selectStableWorkspaceItems(workspaceState.items)
  const threadDirectories = useThreadDirectories(workspaceItems)
  const archivedIdList = useStableValue(workspaceState.archivedSessionIds, HostSnapshotsModel.sameIds)
  const pinnedIdList = useStableValue(workspaceState.pinnedSessionIds, HostSnapshotsModel.sameIds)
  const { preferences, updatePreferences, storageWarning, boardViewOnHost, setSelectedThreadId, pickThread, threadTitle } = useSidebarState()
  // Read by a preset delete's Undo, which may run after other preset writes.
  const preferencesRef = useRef(preferences)
  preferencesRef.current = preferences
  const stageShowsPage = useStageCovered()
  const attention = useThreadAttention({ enabled: sessionState.phase === 'ready' })
  const failedTurns = useFailedTurns({ enabled: sessionState.phase === 'ready' })
  const agentHandleOf = useRowAgentHandles()
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
  const accountsApi = useApi(aiAccountsApi)
  const quotaContinuationEvents = useApiEvent(aiAccountsApi, 'quotaContinuationsChanged', () => {
    void queryClient.invalidateQueries({ queryKey: usageLimitQueryKey })
  })
  const usageLimitQuery = useQuery({
    queryKey: usageLimitQueryKey,
    queryFn: ({ signal }) => accountsApi.quotaContinuations(undefined, { signal }),
    refetchInterval: query =>
      usageLimitRefetchInterval({
        primarySurface: isPrimarySurface,
        ownerMissing: isApiOwnerMissing(query.state.error),
        errored: query.state.status === 'error',
        eventsLive: quotaContinuationEvents === 'live',
        waiting: query.state.data?.continuations.some(continuation => continuation.state === 'waiting') === true,
      }),
    retry: false,
  })
  useEffect(() => {
    const refresh = (): void => void queryClient.invalidateQueries({ queryKey: usageLimitQueryKey })
    window.addEventListener(QUOTA_CONTINUATION_UPDATED_EVENT, refresh)
    return () => window.removeEventListener(QUOTA_CONTINUATION_UPDATED_EVENT, refresh)
  }, [queryClient])
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
  const [multiSelection] = useState(createThreadMultiSelectionStore)
  useLayoutEffect(() => multiSelection.set(threadSelection.sessionIds), [multiSelection, threadSelection.sessionIds])
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [viewsManagerOpen, setViewsManagerOpen] = useState(false)
  // The thread list's Filter panel; closed by the footer's places and by the prompts it opens.
  const [filterOpen, setFilterOpen] = useState(false)
  // The room below the Filter trigger (council round 30, item 7): the desktop panel is capped at it, so a taller state
  // (More open) scrolls inside instead of Radix shifting the panel up off its trigger; measured on open and on resize.
  const filterTriggerRef = useRef<HTMLButtonElement | null>(null)
  const [filterPanelRoom, setFilterPanelRoom] = useState<number | null>(null)
  useLayoutEffect(() => {
    if (!filterOpen) return
    const measure = (): void => {
      const trigger = filterTriggerRef.current
      if (trigger !== null) setFilterPanelRoom(Math.max(FILTER_PANEL_MIN_ROOM, window.innerHeight - trigger.getBoundingClientRect().top - FILTER_PANEL_COLLISION_PADDING))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [filterOpen])
  const [presetPrompt, setPresetPrompt] = useState<PresetNamePrompt | null>(null)
  const [presetToDelete, setPresetToDelete] = useState<{ readonly id: string; readonly label: string } | null>(null)
  const [threadToScrollTo, setThreadToScrollTo] = useState<string | null>(null)
  const threadViewSettings = preferences.threadViews
  const listThreadView = ThreadViewPreferencesModel.activeThreadView(threadViewSettings)
  // The Board view follows the user across devices (E9) once the Host's settings hold it; an older Host keeps it here.
  const localBoardViewSettings = storedThreadBoardView.useValue() ?? DEFAULT_THREAD_BOARD_VIEW
  const boardViewSettings = boardViewOnHost ? preferences.boardView : localBoardViewSettings
  const setBoardView = (next: ThreadBoardViewSettings): void => {
    if (boardViewOnHost) updatePreferences({ boardView: next })
    else storedThreadBoardView.set(next)
  }
  // Filter presets (b:xpvk): the list shows the active preset's filters, or the draft once the user changed one.
  const listThreadFilters = useMemo(() => ThreadViewPreferencesModel.currentThreadViewFilters(threadViewSettings), [threadViewSettings])
  const threadView = isBoard ? ThreadBoardViewModel.columnsOf(boardViewSettings) : listThreadFilters
  const activeWorkspaceFilter = isBoard ? boardViewSettings.projectFilter : preferences.workspaceFilter
  const localProjectsForRemoteThreads = useMemo(
    () =>
      SidebarOrganization.projectWorkspaces({ workspaces: workspaceItems, threadDirectories }).map(workspace => ({
        workspaceId: workspace.workspaceId,
        path: workspace.path,
      })),
    [threadDirectories, workspaceItems],
  )
  const remoteThreads = useRemoteSidebarThreads(props.wide !== false, localProjectsForRemoteThreads)
  const remoteThreadArchive = useRemoteThreadArchive()
  const remoteRunningSessionIds = useMemo(
    () => new Set(remoteThreads.filter(thread => thread.running).map(thread => SessionId(thread.sessionId))),
    [remoteThreads],
  )
  /** The archived set comes from each owning runtime: a remote Session is never a member of this Host's registry. */
  const remoteArchivedSessionIds = useMemo(
    () => new Set(remoteThreads.filter(thread => thread.archived).map(thread => SessionId(thread.sessionId))),
    [remoteThreads],
  )
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
  /**
   * A scratch thread's own folder becomes a project: the Session already lives there, so registering it gives the row a
   * project title of its own instead of the shared No folder label. The Host chooses a title no other project holds.
   */
  const turnThreadIntoProject = async (session: SessionSummary, folder: string | undefined): Promise<void> => {
    const cwd = session.cwd ?? folder
    if (cwd === undefined) return
    try {
      const project = await props.projectRegister({ path: cwd, title: session.title?.trim() || session.displayTitle })
      setNotice({ tone: 'success', message: props.tSidebar('threadSidebarTurnedIntoProject', { title: project.title }) })
      void queryClient.invalidateQueries({ queryKey: ['workspace-folder-picker'] })
      void queryClient.invalidateQueries({ queryKey: ['jj-integration', 'projects'] })
    } catch {
      setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarTurnIntoProjectFailure') })
    }
  }
  useEffect(() => {
    if (notice === null) return
    return scheduleSuccessNoticeDismissal(notice, updateNotice)
  }, [notice, updateNotice])
  // Only the page-load route: a list remounted by the rail must not treat the URL it last wrote as a navigation.
  const [route, dispatchRoute] = useReducer(ThreadRouteModel.reduceThreadRoute, undefined, () =>
    ThreadRouteModel.initialThreadRoute(typeof window === 'undefined' || !isPrimarySurface ? null : pageLoadThreadRoute.pending(window.location.href)),
  )
  const previousStatus = useRef<Readonly<Record<string, ThreadInteractionStatus>> | null>(null)
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
  // Project attribution reads only ids and folders; a streaming turn republishes the list without changing either.
  const folderRowsById = useStableValue(sessionState.byId, sameFolderRows)
  const workspaceBySession = useMemo(
    () =>
      SidebarOrganization.workspaceForSessions({
        workspaces: workspaceItems,
        sessions: sessionsForAutoArchive(sessionState.ids, folderRowsById),
        threadDirectories,
      }),
    [folderRowsById, sessionState.ids, threadDirectories, workspaceItems],
  )
  /** The workspace a Session really lives in, for the deep link; grouping keeps using the project attribution. */
  const realWorkspaceBySession = useMemo(() => {
    const result = SidebarOrganization.sessionWorkspaceIds(workspaceItems)
    // Local blank identities are not attached on the Host until typing begins.
    for (const draft of Object.values(unsentDrafts)) {
      if (!result.has(draft.sessionId) && draft.workspaceId !== undefined) result.set(draft.sessionId, draft.workspaceId)
    }
    return result
  }, [workspaceItems, unsentDrafts])
  const archivedSessionIds = useMemo(() => setIncludes(archivedIdList), [archivedIdList])
  const pinnedSessionIds = useMemo(() => setIncludes(pinnedIdList), [pinnedIdList])
  const settledSessionIds = useMemo(() => setIncludes(preferences.settledSessionIds), [preferences.settledSessionIds])
  const defaultProjectTitle = props.tSidebar('threadSidebarDefaultProject')
  const displayWorkspaces = useMemo(
    () =>
      SidebarOrganization.projectWorkspaces({ workspaces: workspaceItems, threadDirectories }).map(workspace => ({
        id: workspace.workspaceId,
        title: workspace.title.length > 0 ? workspace.title : defaultProjectTitle,
      })),
    [defaultProjectTitle, threadDirectories, workspaceItems],
  )
  /** Project folder per workspace id: the project row's icon is resolved from it on the Host. */
  const workspacePathById = useMemo(() => new Map<string, string>(workspaceItems.map(workspace => [workspace.workspaceId, workspace.path])), [workspaceItems])
  const identityPaths = useMemo(() => [...new Set([...workspacePathById.values()])].sort(), [workspacePathById])
  const lifecycleApi = useApi(projectLifecycleApi)
  const projectIdentities = useQuery({
    queryKey: ['workspace-folder-picker', 'project-identities', identityPaths.join('\n')],
    enabled: identityPaths.length > 0,
    queryFn: ({ signal }) => lifecycleApi.projectIdentities({ paths: identityPaths }, { signal }),
    staleTime: 5 * 60_000,
    retry: false,
  })
  /**
   * Repository identity per workspace id, so two checkouts of one repository are one project row. The Host answers from
   * a cached inspection; a workspace the read does not know falls back to its own id and stays its own row.
   */
  const projectKeys = useMemo(() => {
    const keys = new Map<string, string>()
    for (const identity of projectIdentities.data?.identities ?? []) {
      const workspace = workspaceItems.find(item => item.path === identity.path)
      if (workspace !== undefined) keys.set(workspace.workspaceId, identity.key)
    }
    return keys
  }, [projectIdentities.data, workspaceItems])
  /** Titles by workspace id, so a row does not rescan every workspace on each render. */
  const workspaceTitleById = useMemo(() => new Map<string, string>(displayWorkspaces.map(workspace => [workspace.id, workspace.title])), [displayWorkspaces])
  /** The jj thread workspace each Session works in, for the row's one state word (b:212a). */
  const jjThreadBySession = useMemo(() => {
    const map = new Map<string, OwnWorkspaceThread>()
    for (const repository of jjRepositories.data?.repositories ?? [])
      for (const thread of repository.threads) for (const id of thread.sessionIds) map.set(id, thread)
    return map
  }, [jjRepositories.data])
  const integrationQueuedAtBySessionId = useMemo(
    () => indexQueuedIntegrationSessions((jjRepositories.data?.repositories ?? []).flatMap(repository => repository.threads)),
    [jjRepositories.data],
  )
  // Both indexes look up a few ids (rebased jj threads, settled threads); folding every listed row into them on each
  // list publish was most of the sidebar's allocation while a turn streams.
  const listedSessionIds = useMemo(() => new Set<string>(sessionState.ids), [sessionState.ids])
  const rowsById: Readonly<Record<string, SessionSummary | undefined>> = sessionState.byId
  const rebasedIndex = useMemo(() => {
    const threads = (jjRepositories.data?.repositories ?? []).flatMap(repository => repository.threads)
    const states = new Map<string, RebasedSessionState>()
    for (const thread of threads) {
      if (thread.rebasedAt === undefined) continue
      for (const sessionId of thread.sessionIds) {
        const session = listedSessionIds.has(sessionId) ? rowsById[sessionId] : undefined
        if (session === undefined) continue
        const status = sessionStatus.get(session.id)
        states.set(session.id, {
          id: session.id,
          running: session.running,
          pendingInteraction: status === undefined ? undefined : status.pendingInteraction !== undefined,
          updatedAt: session.updatedAt,
        })
      }
    }
    return indexRebasedThreadSessions({
      threads,
      sessions: states,
      archivedSessionIds,
      pinnedSessionIds,
      settledSessionIds,
      now,
      delayMs: threadDelayMs(preferences.rebasedThreadSettleDelay),
    })
  }, [
    archivedSessionIds,
    jjRepositories.data,
    listedSessionIds,
    now,
    pinnedSessionIds,
    preferences.rebasedThreadSettleDelay,
    rowsById,
    sessionStatus,
    settledSessionIds,
  ])
  const settledSessionStates = useMemo(() => {
    const states = new Map<string, SettledSessionState>()
    for (const sessionId of preferences.settledSessionIds) {
      const session = listedSessionIds.has(sessionId) ? rowsById[sessionId] : undefined
      if (session === undefined) continue
      const status = sessionStatus.get(session.id)
      states.set(session.id, {
        running: session.running,
        pendingInteraction: status === undefined ? undefined : status.pendingInteraction !== undefined,
        updatedAt: session.updatedAt,
      })
    }
    return states
  }, [listedSessionIds, preferences.settledSessionIds, rowsById, sessionStatus])
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
      archiveSession: sessionId =>
        archiveSessionProp(sessionId).then(
          () => 'archived' as const,
          (error: unknown) => {
            if (SidebarOrganization.isMissingSessionRefusal(error)) return 'missing' as const
            throw error
          },
        ),
      getCandidateSessionIds: () => archiveScan.current,
    }),
    [archiveSessionProp],
  )
  const {
    requestScan,
    refreshCandidates,
    running: autoArchiveRunning,
  } = useAutoArchive({
    client: archiveClient,
    enabled: isPrimarySurface && settledArchiveEnabled,
    intervalMs: preferences.scanIntervalMinutes * 60_000,
    onSettled: settled => {
      // A Session the Host no longer has stays due forever, so it would be re-sent on every list mount.
      if (settled.missingSessionIds.length > 0)
        updatePreferences(
          SettledThreadsModel.unsettle({ settledSessionIds: preferences.settledSessionIds, settledAt: preferences.settledAt }, settled.missingSessionIds),
        )
      refreshCandidates('all')
    },
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
  const currentSessionSource = props.currentSessionId ?? ABSENT_CURRENT_SESSION_ID
  const currentSessionId = useSyncExternalStore(currentSessionSource.subscribe, currentSessionSource.getSnapshot, currentSessionSource.getSnapshot)
  const selectedSession = useMemo(() => HostSnapshotsModel.currentSessionOf(sessions, currentSessionId), [sessions, currentSessionId])
  const selectedSessionId = selectedSession?.id
  const subscriptions = useThreadSubscriptions()
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
  // Read at confirm time: the dialog's list is a snapshot, the archive acts on what still qualifies.
  const draftSessionsRef = useRef(draftSessions)
  draftSessionsRef.current = draftSessions
  const [draftsOpen, setDraftsOpen] = useState(false)
  const [draftsCleaning, setDraftsCleaning] = useState(false)
  const hostConnection = useHostConnection()
  // A cleanup verb runs only on loaded, current data: never while the list is pending or DSH is away.
  const draftsCleanable = sessionState.phase === 'ready' && hostConnection === 'online'
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
  const recoverySettled = (settled: RecoveryOperationsSettled): void => {
    void queryClient.invalidateQueries({ queryKey: restartRecoveryQueryKey })
    const failedSessionIds = settled.results
      .filter(result => result.status !== 'accepted')
      .flatMap(result => {
        const session = sessions.find(candidate => candidate.id === result.key)
        return session === undefined ? [] : [session.id]
      })
    if (settled.tag === 'recovery-dismiss') {
      if (failedSessionIds.length === 0) return
      setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarActionFailure') })
      return
    }
    if (settled.tag === 'recovery-row') {
      setNotice(
        failedSessionIds.length === 0
          ? { tone: 'success', message: props.tSidebar('threadSidebarResumeSent', { count: 1 }) }
          : { tone: 'danger', message: props.tSidebar('threadSidebarActionFailure') },
      )
      return
    }
    setNotice(
      failedSessionIds.length === 0
        ? { tone: 'success', message: props.tSidebar('threadSidebarResumeSent', { count: settled.results.length }) }
        : failedResumeNotice({
            message: props.tSidebar('threadSidebarResumePartial', { sent: settled.results.length - failedSessionIds.length, failed: failedSessionIds.length }),
            actionLabel: props.tSidebar('threadSidebarOpenFailedResume'),
            failedSessionIds,
            openThread,
          }),
    )
    // A batch may have resumed quota continuations, whose group reads its own durable list.
    void queryClient.invalidateQueries({ queryKey: usageLimitQueryKey })
  }
  const usageLimitSettled = (settled: RecoveryOperationsSettled): void => {
    void queryClient.invalidateQueries({ queryKey: usageLimitQueryKey })
    const failedKeys = settled.results.filter(result => result.status !== 'accepted').map(result => result.key)
    if (settled.tag === 'usage-limit-change') {
      if (failedKeys.length === 0) return
      setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarActionFailure') })
      return
    }
    if (failedKeys.length === 0) setNotice({ tone: 'success', message: props.tSidebar('threadSidebarResumeSent', { count: 1 }) })
    else if (settled.results[0]?.status === 'rejected') setNotice({ tone: 'warning', message: props.tSidebar('threadSidebarUsageLimitSuperseded') })
    else setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarActionFailure') })
  }
  const usageLimitOperations = useRecoveryOperations({ onSettled: usageLimitSettled })
  const recoveryOperations = useRecoveryOperations({ onSettled: recoverySettled })
  const resumeBusySessionIds = recoveryOperations.busyKeys
  const resumeAllBusy = recoveryOperations.running
  const continuationBySessionId = useMemo(() => new Map(usageLimitRows.map(row => [row.session.id, row.continuation])), [usageLimitRows])
  const usageLimitBusyIds = useMemo(() => {
    const busy = new Set(usageLimitOperations.busyKeys)
    for (const row of usageLimitRows) if (resumeBusySessionIds.has(row.session.id)) busy.add(row.continuation.continuationId)
    return busy
  }, [resumeBusySessionIds, usageLimitOperations.busyKeys, usageLimitRows])
  const resumeUsageLimitThread = (input: { readonly continuationId: string }): void => {
    usageLimitOperations.run({
      tag: 'usage-limit-row',
      operations: [
        {
          key: input.continuationId,
          run: ({ signal }) => accountsApi.resumeQuotaContinuation({ continuationId: input.continuationId }, { signal }),
        },
      ],
    })
  }
  const changeUsageLimitRecovery = (input: {
    readonly continuationId: string
    readonly duration?: UsageLimitSnooze
    readonly sessionId?: string
    readonly enabled?: boolean
    readonly dismiss?: boolean
  }): void => {
    usageLimitOperations.run({
      tag: 'usage-limit-change',
      operations: [
        {
          key: input.continuationId,
          run: async ({ signal }) => {
            if (input.dismiss === true) await accountsApi.dismissQuotaContinuation({ continuationId: input.continuationId }, { signal })
            if (input.duration !== undefined)
              await accountsApi.snoozeQuotaContinuation({ continuationId: input.continuationId, duration: input.duration }, { signal })
            if (input.enabled !== undefined && input.sessionId !== undefined) {
              await accountsApi.setQuotaContinuationAutoRetry(
                { continuationId: input.continuationId, sessionId: input.sessionId, enabled: input.enabled },
                { signal },
              )
              window.dispatchEvent(new Event(QUOTA_CONTINUATION_UPDATED_EVENT))
            }
            return { accepted: true }
          },
        },
      ],
    })
  }
  const resumeRecoverySession = (sessionId: SessionSummary['id']): void => {
    recoveryOperations.run({
      tag: 'recovery-row',
      operations: [{ key: sessionId, run: ({ signal }) => recoveryApi.resume({ sessionId }, { signal }) }],
    })
  }
  const dismissRecoverySession = (sessionId: SessionSummary['id']): void => {
    recoveryOperations.run({
      tag: 'recovery-dismiss',
      operations: [{ key: `dismiss:${sessionId}`, run: ({ signal }) => recoveryApi.dismiss({ sessionId }, { signal }).then(() => ({ accepted: true })) }],
    })
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
      const request = event instanceof CustomEvent ? Schema.decodeUnknownResult(threadTabFocusEventSchema)(event.detail) : undefined
      if (request !== undefined && Result.isSuccess(request)) setThreadToScrollTo(request.success.sessionId)
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
  const attentionAvailable = attention.available
  const sinceYouLeftPending = useRef<string | null>(null)
  const sinceYouLeftSelected = useRef<string | undefined>(undefined)
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
    // Watching a thread finish acknowledges that turn; it never clears a mark the user made on purpose just now. A
    // destination page over the stage (the Inbox, on a phone the whole screen) means the thread is not being watched.
    if (selectedAttention.finishedAt !== null) {
      if (!stageShowsPage) acknowledgeAttention(selectedSessionId, selectedAttention.version)
    } else if (justSelected) acknowledgeManualUnread(selectedSessionId, selectedAttention.version)
  }, [acknowledgeAttention, acknowledgeManualUnread, isPrimarySurface, selectedAttention, selectedSessionId, stageShowsPage])
  // Opening a thread clears its record (above, or never on a phone, whose Threads tab is not the primary surface): hand
  // Chat the unseen range on the open itself, on every surface, so it can draw "Since you left". A turn the user then
  // watches finish is acknowledged, never handed over. A thread opened before the first attention snapshot arrived (a
  // page load on its URL) is handed over when the snapshot arrives. Handing the same record over twice is harmless.
  useEffect(() => {
    const justSelected = sinceYouLeftSelected.current !== selectedSessionId
    sinceYouLeftSelected.current = selectedSessionId
    if (selectedSessionId === undefined) return
    if (justSelected && !attentionAvailable) sinceYouLeftPending.current = selectedSessionId
    const firstSnapshot = attentionAvailable && sinceYouLeftPending.current === selectedSessionId
    if (attentionAvailable) sinceYouLeftPending.current = null
    if (selectedAttention !== undefined && (justSelected || firstSnapshot) && !stageShowsPage) noteSinceYouLeft(selectedAttention)
  }, [attentionAvailable, selectedAttention, selectedSessionId, stageShowsPage])
  threadTitle.current = sessionId => sessionState.byId[sessionId]?.displayTitle

  const selectThread = (sessionId: SessionSummary['id'], options: { readonly linked?: boolean } = {}): void => {
    if (sessionId !== selectedSessionId) startInteraction('thread switch', { attributes: { 'dshx.thread.source': 'sidebar' } })
    pickThread(sessionId)
    const opened = attention.records.get(sessionId)
    // A phone's Threads list unmounts as the thread opens, so the selection effect never sees it: hand the unseen range
    // to Chat here, on the tap itself (the effect hands the same record over again on a desktop; that is harmless).
    if (opened !== undefined) noteSinceYouLeft(opened)
    if (opened !== undefined && shouldClearUnreadOnReselect({ requestedSessionId: sessionId, selectedSessionId }))
      attention.clearUnread(sessionId, opened.version)
    if (isPrimarySurface) pageLoadThreadRoute.settle()
    dispatchRoute({ type: 'select' })
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
      void (async () => {
        try {
          await props.unarchiveSession(sessionId)
        } catch {
          setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarActionFailure') })
          return
        }
        selectThread(sessionId, options)
      })()
      return
    }
    selectThread(sessionId, options)
  }
  const openThreadRef = useRef(openThread)
  openThreadRef.current = openThread

  useEffect(() => {
    if (!isPrimarySurface) return
    // The phone history layers announce the `history.back()` they run for their own bookkeeping (closing a level the app
    // already closed). That popstate lands on an entry without the thread and is not a navigation: reading it dropped a
    // page-load link while the list was still loading.
    let selfPops = 0
    const onSelfPop = (): void => {
      selfPops += 1
    }
    const onPopState = (): void => {
      if (selfPops > 0) {
        selfPops -= 1
        return
      }
      dispatchRoute({
        type: 'navigate',
        sessionId: readThreadUrl(window.location.href)?.sessionId ?? null,
        selectedSessionId: selectedSession?.id ?? null,
      })
    }
    window.addEventListener(PHONE_HISTORY_SELF_POP_EVENT, onSelfPop)
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener(PHONE_HISTORY_SELF_POP_EVENT, onSelfPop)
      window.removeEventListener('popstate', onPopState)
    }
  }, [isPrimarySurface, selectedSession?.id])

  useEffect(() => {
    if (!isPrimarySurface || sessionState.phase !== 'ready') return
    // A route opened in another path (an archived thread restored first) settles as soon as the list shows it.
    if (route.status === 'opening') {
      if (route.sessionId === selectedSessionId) dispatchRoute({ type: 'settle', selectedSessionId })
      return
    }
    const request = ThreadRouteModel.pendingThreadRoute(route)
    if (request === null) return
    pageLoadThreadRoute.settle()
    const target = sessions.find(session => session.id === request.sessionId)
    if (target === undefined) {
      setNotice({ tone: 'warning', message: props.tSidebar('threadSidebarLinkNotFound') })
      window.history.replaceState(window.history.state, '', clearThreadUrl(window.location.href))
      dispatchRoute({ type: 'missing' })
      return
    }
    if (selectedSessionId === target.id) {
      dispatchRoute({ type: 'settle', selectedSessionId })
      return
    }
    dispatchRoute({ type: 'open' })
    openThreadRef.current(target.id, { linked: request.source === 'page-load' })
  }, [archivedSessionIds, isPrimarySurface, props, route, selectedSessionId, sessions, sessionState.phase, setNotice])

  useEffect(() => {
    if (!isPrimarySurface || selectedSession === undefined) return
    const projected = ThreadRouteModel.threadUrlRoute({ state: route, selectedSessionId: selectedSession.id })
    if (projected.suppressionStale) dispatchRoute({ type: 'clear-suppression' })
    if (projected.sessionId === null) return
    const workspaceId =
      realWorkspaceBySession.get(selectedSession.id) ?? SidebarOrganization.workspaceForLineage(selectedSession, sessionState.byId, workspaceBySession)
    const next = buildThreadUrl(window.location.href, selectedSession.id, workspaceId)
    if (next !== window.location.href) window.history.replaceState(window.history.state, '', next)
  }, [isPrimarySurface, realWorkspaceBySession, route, selectedSession, sessionState.byId, workspaceBySession])

  const changePreferences = useCallback(
    (patch: Partial<SidebarPreferences>): void => {
      updatePreferences(patch)
    },
    [updatePreferences],
  )

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
                <StatusDot className={ThreadAttentionPresentationModel.attentionColorDotClass(color)} />
                <span className="dshx:truncate">{colorLabel}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup
                value={color}
                onValueChange={value => {
                  const checked = Schema.decodeUnknownResult(attentionColorSchema)(value)
                  if (Result.isFailure(checked)) return
                  changePreferences({ attentionColors: { ...preferences.attentionColors, [colorKey]: checked.success } })
                }}
              >
                {attentionColorOptions.map(option => (
                  <DropdownMenuRadioItem key={option} value={option}>
                    <StatusDot className={ThreadAttentionPresentationModel.attentionColorDotClass(option)} />
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
    void (async () => {
      if (await mutateThreads(targetIds, operation)) setThreadSelection(EMPTY_THREAD_SELECTION)
    })()
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
   * Archive the confirmed empty drafts that still qualify and forget the thread workspaces that hold nothing but
   * drafts. Each id is re-checked at confirm time (a draft prompted since the dialog opened is skipped), the toast
   * offers Undo (unarchive), and jj-integration still refuses a workspace with unlanded revisions or uncommitted
   * edits, so a folder that turns out to hold work stays.
   * @param confirmed - the drafts the confirmation named.
   */
  const cleanUpDrafts = async (confirmed: readonly SessionSummary['id'][]): Promise<void> => {
    if (draftsCleaning || !draftsCleanable) return
    setDraftsCleaning(true)
    try {
      const current = draftSessionsRef.current
      const stillDrafts = new Set(DraftThreadsModel.stillDraftIds({ confirmed, sessions: current }))
      const drafts = current.filter(draft => stillDrafts.has(draft.id))
      if (drafts.length === 0) {
        setNotice({ tone: 'success', message: props.tSidebar('threadSidebarDraftsNoneLeft') })
        return
      }
      const plan = DraftThreadsModel.planCleanup({ drafts, workspaces: workspaceItems, threadDirectories })
      const archivedIds: SessionSummary['id'][] = []
      for (const sessionId of plan.sessionIds) {
        try {
          await props.archiveSession(sessionId)
          archivedIds.push(sessionId)
        } catch {
          // One refused archive must not stop the rest of the cleanup.
        }
      }
      for (const path of plan.workspacePaths) await jjThreads.discard({ path, force: false }).catch(() => undefined)
      const cleaned = { tone: 'success' as const, message: plural(props.tSidebar, 'threadSidebarDraftsCleaned', archivedIds.length) }
      if (archivedIds.length === 0) {
        setNotice(cleaned)
      } else {
        let undoInFlight = false
        setNotice({
          ...cleaned,
          actionLabel: props.tSidebar('threadSidebarUndo'),
          durationMs: preferences.archiveUndoDurationSeconds * 1_000,
          onAction: () => {
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
                message: props.tSidebar(undoFailed ? 'threadSidebarActionFailure' : 'threadSidebarUndone'),
              })
            })()
          },
        })
      }
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

  const notifyThread = (
    category: ThreadNotificationCategory,
    eventId: string,
    sessionId: SessionSummary['id'] | null,
    title: string,
    fallbackBody: string,
    message?: string,
  ): UserNotificationPageOutcome => {
    const categoryPreferences = preferences.notificationCategories[category]
    if (storedNotificationsMuted.get() === true) return 'snoozed'
    const route = ThreadNotificationModel.notificationRoute({
      categories: preferences.notificationCategories,
      category,
      systemPermissionGranted: plugin.notifications.permission() === 'granted',
    })
    if (route === 'category-off') return 'category-off'
    if (sessionId !== null && isMuteActive(mutedThreads[sessionId], readNow())) return 'thread-muted'
    const session = sessionId === null ? undefined : sessionState.byId[sessionId]
    if (sessionId !== null && (session === undefined || !SidebarOrganization.isAttentionSessionIncluded(session, preferences.includeSubagentAttention)))
      return 'subagent-hidden'
    if (!route.inApp && !route.system && !route.sound) return route.systemRequested ? 'system-permission' : 'category-off'
    if (!ThreadNotificationModel.claimThreadNotification(eventId)) return 'duplicate'
    // Already open in this focused window: claimed, so other tabs stay quiet too; the Host history still records it.
    if (sessionId !== null && ViewedThreadModel.isWatched({ ...ViewedThreadModel.windowAttention(), sessionId, viewedSessionId: selectedSessionId }))
      return 'watched-thread'
    const open = sessionId === null ? undefined : () => openThread(sessionId)
    if (route.inApp) {
      dispatchNoticeQueue({
        type: 'enqueue-notification',
        notice: {
          tone: notificationNoticeTones[category],
          message: message ?? `${title}: ${session?.displayTitle ?? fallbackBody}`,
          durationMs: preferences.notificationDurationSeconds * 1_000,
          ...(open !== undefined && { actionLabel: props.tSidebar('threadSidebarNotificationOpenThread'), onAction: open }),
        },
      })
    }
    if (route.system && !plugin.notifications.notify({ title, body: fallbackBody, ...(open !== undefined && { onClick: open }) }))
      setNotice({ tone: 'warning', message: props.tSidebar('threadSidebarNotificationsUnavailable') })
    if (categoryPreferences.sound) ThreadNotificationAudioModel.play(categoryPreferences.soundPreset, categoryPreferences.volume)
    return 'shown'
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
   * Settle or unsettle one remote row. A mirrored Session's settled state is this sidebar's own preference, so only
   * its sets change: settling a local thread also unpins it, and that Host verb belongs to the owning runtime.
   */
  const applyRemoteSettled = (sessionId: SessionSummary['id'], shouldSettle: boolean): void => {
    if (shouldSettle && remoteRunningSessionIds.has(sessionId)) {
      setNotice({ tone: 'warning', message: props.tSidebar('threadSidebarRunningNotice') })
      return
    }
    const status = { settledSessionIds: preferences.settledSessionIds, settledAt: preferences.settledAt }
    if (shouldSettle) {
      changePreferences(
        SettledThreadsModel.settleAndUnpark({
          status,
          parkedSessionIds: preferences.parkedSessionIds,
          sessionIds: [sessionId],
          now: readNow(),
        }),
      )
    } else changePreferences(SettledThreadsModel.unsettle(status, [sessionId]))
    setNotice(shouldSettle ? { tone: 'success', message: props.tSidebar('threadSidebarSettledNotice') } : null)
  }

  const toggleRemoteSettled = (sessionId: SessionSummary['id']): void => {
    applyRemoteSettled(sessionId, !settledSessionIds.has(sessionId))
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
    if (isBoard) setBoardView(ThreadBoardViewModel.update(boardViewSettings, { collapsedSections: nextCollapsedSections }))
    changePreferences(isBoard ? nextPreferences : { ...nextPreferences, collapsedSections: [...nextCollapsedSections] })
    if (failed) setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarActionFailure') })
    else if (!plan.archive) setNotice(null)
  }

  /**
   * Archive or restore one mirrored thread on the runtime that owns it. The reply carries that runtime's new archived
   * set, so the cached row moves at once; a runtime that refuses a running thread says why.
   */
  const setRemoteThreadArchived = (thread: RemoteSidebarThread, archived: boolean): void => {
    if (thread.running) {
      setNotice({ tone: 'warning', message: props.tSidebar('threadSidebarRunningNotice') })
      return
    }
    void (async () => {
      const outcome = await remoteThreadArchive({ runtimeId: thread.runtimeId, sessionId: thread.sessionId, archived })
      setNotice(outcome.ok ? null : { tone: 'danger', message: outcome.message })
    })()
  }

  /**
   * Drop a remote row into another status section. A mirrored Session answers the whole plan a local drop uses:
   * parked, settled and the idle override key by Session id here, and archive or restore runs through multi-host on
   * the runtime that owns the Session. Pin stays a Host verb the sidebar only mirrors, so Pinned is not offered.
   */
  const moveRemoteThreadToSection = (sessionId: SessionSummary['id'], section: SidebarSection): void => {
    const plan = SidebarOrganization.remoteSectionDropPlan(section)
    if (plan === null) return
    const thread = remoteThreads.find(candidate => candidate.sessionId === sessionId)
    if (thread === undefined) return
    if ((plan.archive || plan.park || plan.settle) && remoteRunningSessionIds.has(sessionId)) {
      setNotice({ tone: 'warning', message: props.tSidebar('threadSidebarRunningNotice') })
      return
    }
    if (plan.archive) setRemoteThreadArchived(thread, true)
    if (plan.unarchive && thread.archived) setRemoteThreadArchived(thread, false)
    const nextParked = new Set(preferences.parkedSessionIds)
    if (plan.park) nextParked.add(sessionId)
    if (plan.unpark) nextParked.delete(sessionId)
    const status = { settledSessionIds: preferences.settledSessionIds, settledAt: preferences.settledAt }
    const idleSectionOverrides = { ...preferences.idleSectionOverrides }
    if (plan.idleOverride === null) delete idleSectionOverrides[sessionId]
    else idleSectionOverrides[sessionId] = { section: plan.idleOverride, at: readNow() }
    const nextCollapsedSections = collapsedSections.filter(item => item !== section)
    const nextPreferences = {
      parkedSessionIds: [...nextParked],
      ...(plan.settle ? SettledThreadsModel.settle(status, [sessionId], readNow()) : plan.unsettle ? SettledThreadsModel.unsettle(status, [sessionId]) : {}),
      idleSectionOverrides,
    }
    if (isBoard) setBoardView(ThreadBoardViewModel.update(boardViewSettings, { collapsedSections: nextCollapsedSections }))
    changePreferences(isBoard ? nextPreferences : { ...nextPreferences, collapsedSections: [...nextCollapsedSections] })
    setNotice(null)
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
    // Status groups fold Done by default, so they store Done's open marker instead of its key (thread-status.ts).
    const nextCollapsedGroups = key.startsWith(STATUS_GROUP_KEY_PREFIX)
      ? [...ThreadStatusModel.toggle(key, collapsedGroups)]
      : toggleCollapsedGroup(collapsedGroups, key)
    if (isBoard) setBoardView(ThreadBoardViewModel.update(boardViewSettings, { collapsedGroups: nextCollapsedGroups }))
    else changePreferences({ collapsedGroups: nextCollapsedGroups })
  }

  const toggleSection = (section: SidebarSection): void => {
    const nextCollapsedSections = SidebarPreferencesModel.toggleCollapsedSection(collapsedSections, section)
    if (isBoard) setBoardView(ThreadBoardViewModel.update(boardViewSettings, { collapsedSections: nextCollapsedSections }))
    else changePreferences({ collapsedSections: nextCollapsedSections })
  }

  // Archiving outranks settled: an archived thread keeps no settled status, so restoring it comes back usable
  // instead of waiting for the archive delay that already fired. Covers every archive path, the Agent's included.
  useEffect(() => {
    if (!isPrimarySurface) return
    const archivedStillSettled = SettledThreadsModel.archivedStillSettled({
      settledSessionIds: preferences.settledSessionIds,
      archivedSessionIds,
      autoArchiveRunning,
    })
    if (archivedStillSettled.length === 0) return
    const status = { settledSessionIds: preferences.settledSessionIds, settledAt: preferences.settledAt }
    changePreferences(SettledThreadsModel.unsettle(status, archivedStillSettled))
  }, [archivedSessionIds, autoArchiveRunning, changePreferences, isPrimarySurface, preferences.settledAt, preferences.settledSessionIds])

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
  // The Host scans on its own (`auto-settle-host.ts`). Only a Host from before that scan, which does not serve this
  // API, leaves the browser to settle threads; while the answer is pending nothing scans, so the two never race.
  const hostAutoSettle = useApiQuery(threadSidebarAutoSettleApi, 'status', { input: {}, enabled: isPrimarySurface })
  const browserOwnsAutoSettle = isApiOwnerMissing(hostAutoSettle.error)
  useAutoSettle({
    client: autoSettleClient,
    enabled: isPrimarySurface && browserOwnsAutoSettle && autoSettleEnabled,
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

  // The selected row is never drawn under the list's bottom fade (round nine B6): a New thread lands in Drafts, at the
  // list's end. When the selected row reaches into the fade zone the fade turns off for it; nothing scrolls, so no row
  // slides under a sticky group head. The user's next scroll brings the fade back.
  useEffect(() => {
    const area = scrollAreaRef.current
    if (area === null) return
    const frame = requestAnimationFrame(() => ListFade.sync(area, selectedSessionId, ListFade.height(window.matchMedia('(pointer: coarse)').matches)))
    return () => cancelAnimationFrame(frame)
  }, [selectedSessionId])

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
  /** The rows a source shows: the list's and each Filter preset's count share it (round 29, item 2). */
  const threadEntriesForSource = useCallback(
    (sourceFilter: ThreadSourceFilter) => {
      if (sourceFilter === 'subagents') {
        return [...childThreadEntries, ...sectionEntries.filter(entry => ThreadViewModel.matchesSourceFilter(entry.session, 'subagents'))]
      }
      if (sourceFilter === 'main') return sectionEntries.filter(entry => ThreadViewModel.matchesSourceFilter(entry.session, 'main'))
      return sectionEntries
    },
    [childThreadEntries, sectionEntries],
  )
  const sourceFilteredThreadEntries = useMemo(() => threadEntriesForSource(threadView.sourceFilter), [threadEntriesForSource, threadView.sourceFilter])
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
      void (async () => {
        try {
          await attention.migrate(entries)
        } catch {
          return
        }
        legacyNotificationPreferences.remove()
      })()
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
  // The open thread included: an approval it waits on is Needs you on every surface (unslop round four, D3).
  const approvalNeededRows = useMemo(
    () =>
      ApprovalRows.select({
        sessions: attentionSessions,
        pendingInteractionKindFor: sessionId => sessionStatus.get(sessionId)?.pendingInteraction?.kind,
        mutedSessionIds,
        archivedSessionIds,
        settledSessionIds,
        matchesWorkspace: session =>
          activeWorkspaceFilter === null ||
          (SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession) ?? '') === activeWorkspaceFilter,
      }),
    [archivedSessionIds, settledSessionIds, attentionSessions, mutedSessionIds, activeWorkspaceFilter, sessionState.byId, sessionStatus, workspaceBySession],
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
  // The ADE status grouping (plan §4.3, §4.7): each row's status is a projection of the inbox plus the attention this
  // sidebar already classifies, with subagents rolled up into their parent.
  const stateGrouping = threadView.groupBy === 'state'
  // Rows keep the status glyphs (and their detail line) when grouped by project, so a project section still says what
  // needs you; only the status grouping sorts and sections by them.
  const statusGlyphs = stateGrouping || threadView.groupBy === 'project'
  const inbox = useInboxThreadSignals({ enabled: statusGlyphs && sessionState.phase === 'ready' })
  /**
   * Resume one row however it stopped: its inbox verb (quota, another provider), its stored quota continuation when the
   * inbox is absent, or the turn a previous Host process left open.
   */
  const resumeAttentionSession = async (sessionId: SessionSummary['id'], abortSignal: AbortSignal): Promise<{ readonly accepted: boolean }> => {
    const target = ResumeAttentionModel.targetOf({
      sessionId,
      signal: inbox.signals.get(sessionId),
      continuation: continuationBySessionId.get(sessionId),
    })
    if (target.kind === 'inbox') return inbox.act(target.itemId, 'Resume').then(outcome => ({ accepted: outcome.ok }))
    if (target.kind === 'quota') return accountsApi.resumeQuotaContinuation({ continuationId: target.continuationId }, { signal: abortSignal })
    return recoveryApi.resume({ sessionId: target.sessionId }, { signal: abortSignal })
  }
  /** Every Resume all in the list: one batch keyed by thread, so a mixed Needs you group resumes in one notice. */
  const resumeAllAttention = (rows: readonly SessionSummary[]): void => {
    recoveryOperations.run({
      tag: 'recovery-batch',
      operations: rows.map(row => ({ key: row.id, run: ({ signal }) => resumeAttentionSession(row.id, signal) })),
    })
  }
  // The roll-up's detail lines in this plugin's words, one dictionary per line (C5).
  const rollupCopy = useMemo(
    (): ThreadStatusCopy => ({
      subagentsNeedYou: count => plural(tSidebar, 'threadSidebarSubagentsNeedYou', count),
      subagentsFailed: count => plural(tSidebar, 'threadSidebarSubagentsFailed', count),
      childrenWorking: counts => workCountLabel(counts, subagentCountWords(tSidebar)),
    }),
    [tSidebar],
  )
  // One Host read every 3 s for every working row's step and start, only while one runs (polish pass b:r4et).
  const runningRowIds = useMemo(() => sectionEntries.filter(entry => entry.session.running).map(entry => entry.session.id), [sectionEntries])
  const liveTurns = useLiveTurns(runningRowIds, sessionState.phase === 'ready')
  // What an approval asks, for the row's detail line: the command its live step names (`git push --force…`); the glyph and
  // the Review verb say it waits for an approval (round five B4).
  const waitingDetailById = useMemo(() => {
    const details = new Map<SessionSummary['id'], string>()
    for (const session of approvalNeededRows) {
      const interaction = sessionStatus.get(session.id)?.pendingInteraction
      const detail = ApprovalDetail.of(
        { kind: interaction?.kind, step: liveTurns.get(session.id)?.step, reason: ApprovalDetail.reasonOf(interaction) },
        subject => subject,
      )
      if (detail !== undefined) details.set(session.id, detail)
    }
    return details
  }, [approvalNeededRows, liveTurns, sessionStatus])
  // Each subagent's own status (its row, tab, header and palette) and the one its parent rolls up (round 21 D4).
  const { childStatusById, childRollupStatusById } = useMemo(() => {
    const statuses = new Map<SessionSummary['id'], ThreadStatus>()
    const rollups = new Map<SessionSummary['id'], ThreadStatus>()
    if (!statusGlyphs) return { childStatusById: statuses, childRollupStatusById: rollups }
    for (const entry of [...childThreadEntries, ...detachedThreadEntries]) {
      const failedTurn = failedTurns.get(entry.session.id)
      const { row, rollup } = ThreadStatusModel.childStatusOf({
        running: entry.session.running,
        pinned: false,
        archived: archivedSessionIds.has(entry.session.id),
        settled: settledSessionIds.has(entry.session.id),
        unread: attention.records.has(entry.session.id),
        labels: attentionLabelsBySession.get(entry.session.id) ?? [],
        inbox: inbox.signals.get(entry.session.id),
        failedTurn: failedTurn === undefined ? undefined : { at: failedTurn.failedAt, reason: failedTurn.reason },
        activityAt: entry.activity.updatedAt,
        settledAt: preferences.settledAt[entry.session.id],
        now,
      })
      statuses.set(entry.session.id, row)
      rollups.set(entry.session.id, rollup)
    }
    return { childStatusById: statuses, childRollupStatusById: rollups }
  }, [
    archivedSessionIds,
    attention.records,
    attentionLabelsBySession,
    childThreadEntries,
    detachedThreadEntries,
    failedTurns,
    inbox.signals,
    now,
    preferences.settledAt,
    settledSessionIds,
    statusGlyphs,
  ])
  const threadStatusById = useMemo(() => {
    const statuses = new Map<SessionSummary['id'], ThreadStatus>()
    if (!statusGlyphs) return statuses
    for (const entry of sectionEntries) {
      const childRows = threadTree.childrenByRoot.get(entry.session.id) ?? NO_CHILDREN
      const children = childRows.flatMap(child => {
        const status = childRollupStatusById.get(child.id)
        return status === undefined ? [] : [status]
      })
      // The detail line names the children whose own turn failed (`6 working · 1 failed`); the status leaves them out.
      const failedChildren = childRows.filter(child => childStatusById.get(child.id)?.status === 'failed').length
      // Top-level rows only: a subagent's failed turn is its parent's tool result, which the parent's own turn answers.
      const failedTurn = failedTurns.get(entry.session.id)
      statuses.set(
        entry.session.id,
        ThreadStatusModel.statusOf(
          {
            running: entry.session.running,
            pinned: pinnedSessionIds.has(entry.session.id),
            // Nothing sent yet: the row is listed (the journey of a saved draft finds it), under Drafts, not Idle.
            draft: entry.session.blank,
            archived: archivedSessionIds.has(entry.session.id),
            settled: settledSessionIds.has(entry.session.id),
            unread: attention.records.has(entry.session.id),
            labels: attentionLabelsBySession.get(entry.session.id) ?? [],
            inbox: inbox.signals.get(entry.session.id),
            waitingDetail: waitingDetailById.get(entry.session.id),
            failedTurn: failedTurn === undefined ? undefined : { at: failedTurn.failedAt, reason: failedTurn.reason },
            stoppedTurn: ThreadStatusModel.stoppedTurnOf(attention.records.get(entry.session.id)),
            unlanded: jjThreadBySession.get(entry.session.id)?.unlanded.length,
            activityAt: entry.activity.updatedAt,
            settledAt: preferences.settledAt[entry.session.id],
            now,
          },
          children,
          rollupCopy,
          failedChildren,
        ),
      )
    }
    return statuses
  }, [
    archivedSessionIds,
    attention.records,
    attentionLabelsBySession,
    childRollupStatusById,
    childStatusById,
    rollupCopy,
    failedTurns,
    inbox.signals,
    jjThreadBySession,
    now,
    pinnedSessionIds,
    waitingDetailById,
    preferences.settledAt,
    sectionEntries,
    settledSessionIds,
    statusGlyphs,
    threadTree,
  ])
  // The one Working count (unslop S3): the rows whose status is Working, subagents rolled up into their parent. The
  // "Working (N)" group lists exactly these rows, and the status strip, the tab title and the Working preset read the
  // same set, so a thread that waits for an answer (Needs you, though its turn still runs) is counted nowhere.
  const projectedWorkingIds = useMemo(() => {
    const statuses = new Map<string, WorkStatus>()
    if (statusGlyphs) {
      for (const [sessionId, status] of childStatusById) statuses.set(sessionId, status.status)
      for (const [sessionId, status] of threadStatusById) statuses.set(sessionId, status.status)
    }
    return WorkingThreadsProjection.ids([...sectionEntries, ...detachedThreadEntries], {
      statusOf: sessionId => statuses.get(sessionId),
      waiting: waitingSessionIds,
    })
  }, [childStatusById, detachedThreadEntries, sectionEntries, statusGlyphs, threadStatusById, waitingSessionIds])
  const projectedWorkingCount = projectedWorkingIds.size
  useEffect(() => {
    if (!isPrimarySurface || sessionState.phase !== 'ready') return
    WorkingThreadsProjection.publish(projectedWorkingCount)
  }, [isPrimarySurface, projectedWorkingCount, sessionState.phase])
  // The strip falls back to its own count once no list publishes.
  useEffect(() => (isPrimarySurface ? () => WorkingThreadsProjection.publish(null) : undefined), [isPrimarySurface])
  // The one status per thread, rolled up (DESIGN.md R2): the tab, the header and the palette read what this row shows.
  useEffect(() => {
    if (!isPrimarySurface || sessionState.phase !== 'ready') return
    if (!statusGlyphs) {
      threadWorkStatusStore.publish(null)
      return
    }
    // An attention row's kind travels with its status, so the palette says Approval, Question or Turn failed as the row
    // does (council round 15 B3).
    const words = {
      question: tSidebar('threadSidebarAskQuestion'),
      approval: tSidebar('threadSidebarAskApproval'),
      failed: tSidebar(workStatusLabelKeys.failed),
    }
    const projected = new Map<string, ThreadWorkStatus>()
    for (const statuses of [childStatusById, threadStatusById]) {
      for (const [sessionId, status] of statuses) {
        projected.set(sessionId, { status: status.status, detail: status.detail, kind: AttentionSubtitleModel.kindOf(status, words) })
      }
    }
    threadWorkStatusStore.publish(projected)
  }, [childStatusById, isPrimarySurface, sessionState.phase, statusGlyphs, threadStatusById, tSidebar])
  useEffect(() => (isPrimarySurface ? () => threadWorkStatusStore.publish(null) : undefined), [isPrimarySurface])
  const workingThreadCountsBySource = useMemo(
    () => ({
      all: projectedWorkingCount,
      main: sectionEntries.filter(entry => projectedWorkingIds.has(entry.session.id) && ThreadViewModel.matchesSourceFilter(entry.session, 'main')).length,
      subagents: [
        ...childThreadEntries,
        ...detachedThreadEntries,
        ...sectionEntries.filter(entry => ThreadViewModel.matchesSourceFilter(entry.session, 'subagents')),
      ].filter(entry => entry.session.running).length,
    }),
    [childThreadEntries, detachedThreadEntries, projectedWorkingCount, projectedWorkingIds, sectionEntries],
  )
  // Background jobs per thread for the rows' muted chip; a job never makes its thread Working.
  const runningJobs = RunningJobsModel.useCounts(sessionState.phase === 'ready')
  const transitionClock = useRef(ThreadStatusModel.createTransitionClock())
  const groupSettler = useRef(ThreadStatusModel.createGroupSettler())
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
  const [viewMenuOpenId, setViewMenuOpenId] = useState<string | null>(null)
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
  /** Whether a row of the list matches a view's statuses: the list's and each Filter preset's count share it. */
  const matchesListStatus = useCallback(
    (entry: (typeof sourceFilteredThreadEntries)[number], view: Pick<ThreadViewPreferences, 'statusFilters' | 'sourceFilter'>): boolean =>
      ThreadViewModel.matchesStatusFilter({
        filters: view.statusFilters,
        // A subagent row reports its own state; a root row reports its children's, so a finished child keeps its
        // parent in the view that names that label.
        labels: attentionLabelsByRow.get(entry.session.id) ?? [],
        unread: attention.records.has(entry.session.id),
        running: view.sourceFilter === 'subagents' ? entry.activity.running : currentWorkingThreadIds.has(entry.session.id),
        inactive: inactiveThreadIds.has(entry.session.id),
        archived: archivedSessionIds.has(entry.session.id),
        settled: settledSessionIds.has(entry.session.id),
        muted: mutedSessionIds.has(entry.session.id),
      }),
    [archivedSessionIds, attention.records, attentionLabelsByRow, currentWorkingThreadIds, inactiveThreadIds, mutedSessionIds, settledSessionIds],
  )
  const visibleThreadEntries = useMemo(() => {
    const listView = { statusFilters: threadView.statusFilters, sourceFilter: threadView.sourceFilter }
    return sourceFilteredThreadEntries.filter(entry => matchesListStatus(entry, listView))
  }, [matchesListStatus, sourceFilteredThreadEntries, threadView.sourceFilter, threadView.statusFilters])
  // Each preset's rows, as the list would show them (round 29, item 2): counted only while the Filter panel is open,
  // since matching every row per preset on each render was the sidebar's hottest loop while a turn streams.
  const presetTallies = useMemo(() => {
    const tallies = new Map<string, number>()
    if (!filterOpen) return tallies
    for (const view of threadViewSettings.views) {
      if (view.enabled) tallies.set(view.id, threadEntriesForSource(view.sourceFilter).filter(entry => matchesListStatus(entry, view)).length)
    }
    return tallies
  }, [filterOpen, matchesListStatus, threadEntriesForSource, threadViewSettings.views])
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
  // The board shows only columns: recovery threads stay in their status column instead of a group above it. The status
  // grouping does the same: interrupted and usage-limited threads are Needs you rows with a Resume verb.
  const hoistedInterruptedRows = isBoard || stateGrouping ? EMPTY_HOISTED_SESSIONS : statusFilteredInterruptedRows
  const hoistedNeedsResumeRows = isBoard || stateGrouping ? EMPTY_HOISTED_SESSIONS : statusFilteredNeedsResumeRows
  const hoistedUsageLimitRows = isBoard || stateGrouping ? EMPTY_HOISTED_USAGE_LIMIT_ROWS : statusFilteredUsageLimitRows
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
  const filteredRemoteThreads = useMemo(
    () =>
      RemoteThreadInventoryModel.filter({
        threads: remoteThreads,
        filters: threadView.statusFilters,
        sourceFilter: threadView.sourceFilter,
        settledSessionIds,
        mutedSessionIds,
      }),
    [mutedSessionIds, remoteThreads, settledSessionIds, threadView.sourceFilter, threadView.statusFilters],
  )
  const visibleRemoteThreads = useMemo(() => (separatesRemoteThreads ? [] : filteredRemoteThreads), [filteredRemoteThreads, separatesRemoteThreads])
  const remoteRowsBySection = useMemo(() => {
    const rows = new Map<SidebarSection, RemoteSidebarThread[]>(SIDEBAR_SECTIONS.map(section => [section, []]))
    for (const thread of visibleRemoteThreads) {
      const section = SidebarOrganization.sectionForSession({
        session: { id: SessionId(thread.sessionId), running: thread.running, updatedAt: thread.updatedAt },
        archivedSessionIds: remoteArchivedSessionIds,
        pinnedSessionIds,
        parkedSessionIds,
        settledSessionIds,
        idleSectionOverrides: preferences.idleSectionOverrides,
        now,
        idleMinutes: preferences.idleMinutes,
      })
      rows.get(section)?.push(thread)
    }
    for (const entries of rows.values()) entries.sort((left, right) => right.updatedAt - left.updatedAt)
    return rows
  }, [
    now,
    parkedSessionIds,
    pinnedSessionIds,
    preferences.idleMinutes,
    preferences.idleSectionOverrides,
    remoteArchivedSessionIds,
    settledSessionIds,
    visibleRemoteThreads,
  ])
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
    rows.set('pinned', rows.get('pinned')?.sort((left, right) => pinnedIdList.indexOf(left.id) - pinnedIdList.indexOf(right.id)) ?? [])
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
    pinnedIdList,
  ])
  // Built per list change, not per render: a section's merged and sorted rows are also the windowed list's input.
  const sectionThreadsBySection = useMemo(() => {
    const threads = new Map<SidebarSection, SidebarGroupedThread[]>()
    for (const section of SIDEBAR_SECTIONS) {
      const sectionRows: SidebarGroupedThread[] = [
        ...(rowsBySection.get(section) ?? []).map((session): SidebarGroupedThread => ({
          kind: 'local',
          session,
          updatedAt: activityAtBySessionId.get(session.id) ?? session.updatedAt,
        })),
        ...(remoteRowsBySection.get(section) ?? []).map((remote): SidebarGroupedThread => ({ kind: 'remote', remote, updatedAt: remote.updatedAt })),
      ]
      if (section !== 'pinned') sectionRows.sort((left, right) => right.updatedAt - left.updatedAt)
      threads.set(section, sectionRows)
    }
    return threads
  }, [activityAtBySessionId, remoteRowsBySection, rowsBySection])
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
  const commitSectionOrder = (fromShownIndex: number, toShownIndex: number): void => {
    if (fromShownIndex === toShownIndex) return
    changePreferences({
      sectionOrder: SidebarOrganization.reorderSections({ savedOrder: orderedSections, shownSections, fromShownIndex, toShownIndex }),
    })
  }
  // The machine is created once, so its commands read the handlers of the latest render through one holder.
  const dragCommands = useRef<ThreadDragCommands>({ moveToSection: () => undefined, commitSectionOrder: () => undefined })
  dragCommands.current = {
    moveToSection: input => {
      if (input.kind === 'remote') moveRemoteThreadToSection(SessionId(input.sessionId), input.section)
      else void moveThreadsToSection(SessionId(input.sessionId), input.section)
    },
    commitSectionOrder: input => commitSectionOrder(input.from, input.to),
  }
  const [drag, sendDrag, dragActor] = useMachine(threadDragMachine, {
    input: {
      moveToSection: input => dragCommands.current.moveToSection(input),
      commitSectionOrder: input => dragCommands.current.commitSectionOrder(input),
    },
  })
  const activeRowDrag = drag.matches('rows') ? drag.context.row : null
  const activeRowDropSection = drag.matches('rows') ? drag.context.dropSection : null
  const activeSectionDrag = drag.matches('section') ? drag.context.section : null
  const sectionHeaderCenters = (): number[] =>
    shownSections.map((_, position) => {
      const rect = sectionHeaderRefs.current[position]?.getBoundingClientRect()
      return rect === undefined ? Number.POSITIVE_INFINITY : rect.top + rect.height / 2
    })
  // A dropped row lands in a section that is already on screen: revealing the empty ones during the gesture would
  // re-parent the dragged row, and the browser cancels a native drag whose source node moves.
  const renderedSections = useMemo(
    () =>
      activeSectionDrag === null
        ? shownSections
        : SidebarOrganization.reorderSections({
            savedOrder: orderedSections,
            shownSections,
            fromShownIndex: activeSectionDrag.from,
            toShownIndex: activeSectionDrag.to,
          }).filter(section => shownSections.includes(section)),
    [shownSections, orderedSections, activeSectionDrag],
  )
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
    const draggingRow = (): boolean => dragActor.getSnapshot().matches('rows')
    /** The section a landing row may enter: a remote row only reaches the sections whose drop plan is preference-only. */
    const dropSectionFor = (section: SidebarSection): SidebarSection | null => {
      const row = dragActor.getSnapshot().context.row
      if (row === null || row.kind === 'local') return section
      return SidebarOrganization.remoteSectionDropPlan(section) === null ? null : section
    }
    const onDragStart = (event: DragEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) return
      const remoteRow = target.closest<HTMLElement>('article[data-remote-thread-id][data-remote-thread-section-row]')
      const row = remoteRow ?? target.closest<HTMLElement>('article[data-thread-id][data-thread-section-row]')
      if (row === null || threadSurfaceOf(row) !== surface) return
      const section = row.closest<HTMLElement>('[data-thread-section]')?.dataset.threadSection
      const sessionId = remoteRow === null ? row.dataset.threadId : remoteRow.dataset.remoteThreadSessionId
      if (!isSidebarSection(section) || sessionId === undefined) return
      // A remote row gets no mention drag: its id resolves on the runtime that owns the Session, not in this composer.
      if (remoteRow !== null && event.dataTransfer !== null) event.dataTransfer.effectAllowed = 'move'
      sendDrag({ type: 'row.start', row: { kind: remoteRow === null ? 'local' : 'remote', sessionId: SessionId(sessionId), section } })
    }
    const onDragOver = (event: DragEvent): void => {
      if (!draggingRow()) return
      const target = sectionAt(event.clientX, event.clientY)
      const landing = target !== null && threadSurfaceOf(target.element) === surface ? target.section : null
      const next = landing === null ? null : dropSectionFor(landing)
      if (next === null) {
        sendDrag({ type: 'row.over', section: null })
        return
      }
      // Without preventDefault the browser refuses the drop and no `drop` event ever fires.
      event.preventDefault()
      if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
      sendDrag({ type: 'row.over', section: next })
    }
    const onDrop = (event: DragEvent): void => {
      if (!draggingRow()) return
      const target = sectionAt(event.clientX, event.clientY)
      const landing = target !== null && threadSurfaceOf(target.element) === surface ? target.section : null
      const droppedOn = landing === null ? null : dropSectionFor(landing)
      if (droppedOn === null) {
        sendDrag({ type: 'row.end' })
        return
      }
      event.preventDefault()
      sendDrag({ type: 'row.drop', section: droppedOn })
    }
    const onDragEnd = (): void => {
      sendDrag({ type: 'row.end' })
    }
    window.addEventListener('dragstart', onDragStart, true)
    window.addEventListener('dragover', onDragOver, true)
    window.addEventListener('drop', onDrop, true)
    window.addEventListener('dragend', onDragEnd, true)
    return () => {
      window.removeEventListener('dragstart', onDragStart, true)
      window.removeEventListener('dragover', onDragOver, true)
      window.removeEventListener('drop', onDrop, true)
      window.removeEventListener('dragend', onDragEnd, true)
    }
  }, [dragActor, sendDrag, surface])
  const liveGroupedThreadEntries = useMemo(() => {
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
    if (threadView.groupBy === 'state') {
      const pinnedOrder = new Map(pinnedIdList.map((sessionId, index) => [sessionId, index]))
      const statusEntries = entries.map(entry => {
        const thread = entry.thread
        const sessionId = thread.kind === 'local' ? thread.session.id : `${thread.remote.runtimeId}:${thread.remote.sessionId}`
        const status =
          (thread.kind === 'local' ? (threadStatusById.get(thread.session.id) ?? childStatusById.get(thread.session.id)) : undefined) ??
          ThreadStatusModel.statusOf({
            running: thread.kind === 'local' ? thread.session.running : thread.remote.running,
            pinned: thread.kind === 'local' && pinnedSessionIds.has(thread.session.id),
            archived: false,
            settled: false,
            unread: false,
            labels: [],
            inbox: undefined,
            activityAt: entry.activityAt,
            settledAt: undefined,
            now,
          })
        const pinnedIndex = thread.kind === 'local' ? pinnedOrder.get(thread.session.id) : undefined
        // A turn-end burst moves the row once, after its new group held for a moment; its glyph updates at once.
        const group = groupSettler.current.groupOf(sessionId, status.group)
        const settled = group === status.group ? status : { ...status, group }
        const statusEntry = { thread, status: settled, cameBackAt: transitionClock.current(sessionId, group, status.since, now) }
        return pinnedIndex === undefined ? statusEntry : { ...statusEntry, pinnedIndex }
      })
      return ThreadStatusModel.groupEntries(statusEntries).map(group => ({
        key: group.key,
        label: tSidebar(statusGroupLabelKeys[group.group]),
        showHeader: true,
        projectId: undefined,
        checkoutCount: 1,
        threads: group.threads,
      }))
    }
    const workspaceTitles = new Map<string, string>(displayWorkspaces.map(workspace => [workspace.id, workspace.title]))
    for (const thread of visibleRemoteThreads) {
      if (thread.workspaceId !== undefined && thread.workspaceTitle !== undefined) workspaceTitles.set(thread.workspaceId, thread.workspaceTitle)
    }
    return ThreadViewModel.groupEntries({
      groupBy: threadView.groupBy,
      entries,
      workspaceTitles,
      projectKeys,
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
  }, [
    attentionIds,
    childStatusById,
    displayWorkspaces,
    now,
    pinnedSessionIds,
    projectKeys,
    tSidebar,
    threadStatusById,
    threadView.groupBy,
    visibleRemoteThreads,
    visibleThreadEntries,
    pinnedIdList,
  ])
  // A row whose group change waits to settle moves once it held: look again then.
  useEffect(() => {
    const wakeAt = groupSettler.current.wakeAt()
    if (wakeAt === undefined) return
    const timer = setTimeout(() => setNow(Date.now()), Math.max(0, wakeAt - Date.now()))
    return () => clearTimeout(timer)
  }, [liveGroupedThreadEntries])
  // While the pointer is over the list or focus is in it, rows hold their places (plan Q2 T2.2); see held-groups.ts.
  const [heldGroups, setHeldGroups] = useState<HeldGroups | null>(null)
  const holding = useRef({ hover: false, focus: false })
  const latestGroups = useRef(liveGroupedThreadEntries)
  latestGroups.current = liveGroupedThreadEntries
  // A hold taken before the list loaded, or of no rows at all, has nothing to keep in place: the first rows are not
  // "updates".
  const listLoaded = sessionState.phase === 'ready' && workspaceState.phase === 'ready'
  const effectiveHold = listLoaded && heldGroups !== null && heldGroups.groups.some(group => group.ids.length > 0) ? heldGroups : null
  const groupedThreadEntries = useMemo(
    () => HeldGroupsModel.apply(liveGroupedThreadEntries, effectiveHold, heldGroupedThreadId),
    [effectiveHold, liveGroupedThreadEntries],
  )
  const heldUpdates = HeldGroupsModel.pending(liveGroupedThreadEntries, effectiveHold, heldGroupedThreadId)
  const holdOrder = (reason: 'hover' | 'focus', on: boolean): void => {
    if (isBoard) return
    holding.current = { ...holding.current, [reason]: on }
    if (on)
      setHeldGroups(current =>
        current !== null && current.groups.some(group => group.ids.length > 0) ? current : HeldGroupsModel.capture(latestGroups.current, heldGroupedThreadId),
      )
    else if (!holding.current.hover && !holding.current.focus) setHeldGroups(null)
  }
  // The hold is for changes that arrive on their own (a thread finishing). A change the user just made (a menu verb, a
  // key, a new chat from a project header) applies at once: for a moment after a press in the list or a menu, a live
  // change re-captures the hold instead of waiting behind the pill.
  const userActedAt = useRef(0)
  useEffect(() => {
    const onAct = (event: Event): void => {
      const target = event.target instanceof Element ? event.target : null
      if (target === null) return
      if (scrollAreaRef.current?.contains(target) === true || target.closest('[role="menu"], [role="dialog"], [role="alertdialog"], [role="listbox"]') !== null)
        userActedAt.current = Date.now()
    }
    window.addEventListener('pointerdown', onAct, true)
    window.addEventListener('keydown', onAct, true)
    return () => {
      window.removeEventListener('pointerdown', onAct, true)
      window.removeEventListener('keydown', onAct, true)
    }
  }, [])
  useEffect(() => {
    if (Date.now() - userActedAt.current > USER_CHANGE_WINDOW_MS) return
    setHeldGroups(current => (current === null ? null : HeldGroupsModel.capture(liveGroupedThreadEntries, heldGroupedThreadId)))
  }, [liveGroupedThreadEntries])
  // A different grouping, view or filter has different groups: the hold never carries across it.
  const viewSignature = JSON.stringify(threadView)
  useEffect(() => {
    setHeldGroups(current => (current === null ? null : HeldGroupsModel.capture(latestGroups.current, heldGroupedThreadId)))
  }, [viewSignature, activeWorkspaceFilter])
  const showHeldUpdates = (): void =>
    setHeldGroups(holding.current.hover || holding.current.focus ? HeldGroupsModel.capture(latestGroups.current, heldGroupedThreadId) : null)
  /** Rows of a status group whose inline verb is Resume, so the group header can offer one bulk verb. */
  const statusGroupResumableSessions = useMemo(() => {
    const byGroupKey = new Map<string, readonly SessionSummary[]>()
    if (threadView.groupBy !== 'state') return byGroupKey
    for (const group of groupedThreadEntries) {
      if (group.threads.length === 0) continue
      const resumable = ResumeAttentionModel.resumableRowsOf({
        rows: group.threads.flatMap(entry => (entry.kind === 'local' ? [entry.session] : [])),
        statusOf: session => threadStatusById.get(session.id) ?? childStatusById.get(session.id),
      })
      if (resumable.length > 0) byGroupKey.set(group.key, resumable)
    }
    return byGroupKey
  }, [childStatusById, groupedThreadEntries, threadStatusById, threadView.groupBy])

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
      preferences.projectColorPalette,
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
    // Productivity pass Q5 (T5.5): the picker's last entries add a project instead of filtering.
    if (value === ADD_FOLDER || value === NEW_PROJECT) {
      ProjectAddFlow.open(value === NEW_PROJECT ? 'create' : 'browse')
      return
    }
    setSettingsOpen(false)
    const projectFilter = value === ALL_PROJECTS ? null : value === UNASSIGNED_PROJECT ? '' : value
    if (isBoard) setBoardView(ThreadBoardViewModel.update(boardViewSettings, { projectFilter }))
    else changePreferences({ workspaceFilter: projectFilter })
  }

  // Offered only where the flow's owner (workspace-folder-picker's dialog) is mounted; it answers ProjectAddFlow.open.
  const projectAddAvailable = ProjectAddFlow.available()
  const projectOptions: readonly ComboboxOption[] = [
    { value: ALL_PROJECTS, label: props.tSidebar('threadSidebarAllProjects') },
    { value: UNASSIGNED_PROJECT, label: props.tSidebar('threadSidebarUnassigned') },
    ...displayWorkspaces.map(workspace => ({ value: workspace.id, label: workspace.title })),
    ...(projectAddAvailable
      ? [
          {
            value: ADD_FOLDER,
            label: props.tSidebar('threadSidebarAddFolder'),
            group: props.tSidebar('threadSidebarAddProject'),
            keywords: ['open folder', 'register', 'add workspace'],
          },
          {
            value: NEW_PROJECT,
            label: props.tSidebar('threadSidebarNewProject'),
            group: props.tSidebar('threadSidebarAddProject'),
            keywords: ['create project', 'init', 'new repository'],
          },
        ]
      : []),
  ]

  const projectFilterLabel = projectOptions.find(option => option.value === projectFilterValue)?.label ?? props.tSidebar('threadSidebarAllProjects')
  const showGroupControl = isBoard || threadViewSettings.showGroupControl
  const showFilterControl = isBoard || threadViewSettings.showFilterControl

  const updateThreadView = (patch: Partial<ThreadViewPreferences>): void => {
    if (isBoard) {
      setBoardView(ThreadBoardViewModel.update(boardViewSettings, patch))
      return
    }
    // A filter change leaves the preset as saved and keeps a draft beside it: the trigger reads "(edited)" until the
    // user saves the changes or applies a preset again (b:xpvk).
    changePreferences({ threadViews: ThreadViewPreferencesModel.editThreadViewFilters(threadViewSettings, patch) })
  }
  // The Settings write is asynchronous; a failure surfaces through the shared storage warning.
  const saveThreadViewSettings = (settings: ThreadViewSettings): boolean => {
    changePreferences({ threadViews: ThreadViewPreferencesModel.updateThreadViewSettings(settings) })
    return true
  }
  const updateThreadViewControls = (patch: Partial<Pick<ThreadViewSettings, 'showGroupControl' | 'showFilterControl'>>): void => {
    saveThreadViewSettings({ ...threadViewSettings, ...patch })
  }
  const presetsOn = threadViewSettings.showPresets
  const presetEdited = presetsOn && ThreadViewPreferencesModel.isThreadViewEdited(threadViewSettings, preferences.workspaceFilter)
  /** Apply a preset: its filters, and its project scope when it names one. Applying the active one again drops edits. */
  const selectThreadViewPreset = (viewId: string): void => {
    if (viewId === threadViewSettings.activeViewId && !ThreadViewPreferencesModel.isThreadViewEdited(threadViewSettings, preferences.workspaceFilter)) return
    const applied = ThreadViewPreferencesModel.applyThreadViewPreset(threadViewSettings, viewId)
    const threadViews = ThreadViewPreferencesModel.updateThreadViewSettings(applied.settings)
    changePreferences(applied.workspaceFilter === undefined ? { threadViews } : { threadViews, workspaceFilter: applied.workspaceFilter })
  }
  const savePresetChanges = (viewId: string = listThreadView.id): void => {
    saveThreadViewSettings(ThreadViewPreferencesModel.saveCurrentFiltersToPreset(threadViewSettings, viewId, preferences.workspaceFilter))
  }
  const submitPresetName = (prompt: PresetNamePrompt, name: string): void => {
    setPresetPrompt(null)
    if (prompt.mode === 'rename') {
      saveThreadViewSettings(ThreadViewPreferencesModel.renameThreadView(threadViewSettings, prompt.viewId, name))
      return
    }
    if (threadViewSettings.views.length >= MAX_THREAD_VIEWS) {
      setNotice({ tone: 'warning', message: props.tSidebar('threadSidebarPresetFull', { count: MAX_THREAD_VIEWS }) })
      return
    }
    saveThreadViewSettings(
      ThreadViewPreferencesModel.createPresetFromCurrent(threadViewSettings, {
        id: ThreadViewPreferencesModel.newThreadViewId(),
        name,
        workspaceFilter: preferences.workspaceFilter,
      }),
    )
    setNotice({ tone: 'success', message: props.tSidebar('threadSidebarPresetSaved', { name }), durationMs: 3_000 })
  }
  // Delete keeps the removed preset for Undo, which puts it back where it was (and makes it active again if it was).
  const deletePreset = (viewId: string): void => {
    setPresetToDelete(null)
    const position = threadViewSettings.views.findIndex(view => view.id === viewId)
    const view = threadViewSettings.views[position]
    if (view === undefined) return
    const wasActive = view.id === listThreadView.id
    const removed = ThreadViewPreferencesModel.removeThreadView(threadViewSettings, viewId)
    if (removed === threadViewSettings) return
    saveThreadViewSettings(removed)
    const label = threadViewPresetLabel(view, props.tSidebar)
    setNotice({
      tone: 'success',
      message: props.tSidebar('threadSidebarPresetDeleted', { name: label }),
      actionLabel: props.tSidebar('threadSidebarUndo'),
      durationMs: preferences.archiveUndoDurationSeconds * 1_000,
      onAction: () => {
        setNotice(null)
        const current = preferencesRef.current.threadViews
        if (current.views.some(candidate => candidate.id === view.id) || current.views.length >= MAX_THREAD_VIEWS) return
        const restored = ThreadViewPreferencesModel.insertThreadView(current, view, position)
        saveThreadViewSettings(wasActive ? { ...restored, activeViewId: view.id } : restored)
      },
    })
  }
  const cyclePreset = (direction: -1 | 1): false | undefined => {
    if (!presetsOn) return false
    const next = ThreadViewPreferencesModel.adjacentThreadViewId(threadViewSettings, direction)
    if (next === undefined || next === listThreadView.id) return false
    selectThreadViewPreset(next)
    return undefined
  }
  // The status strip's Working item opens the list on its Working view.
  useEffect(() => {
    if (!isPrimarySurface) return
    const onShowWorking = (): void => selectThreadViewPreset(WORKING_VIEW_ID)
    window.addEventListener(SHOW_WORKING_THREADS_EVENT, onShowWorking)
    return () => window.removeEventListener(SHOW_WORKING_THREADS_EVENT, onShowWorking)
  })
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

  /** A row's inline verb: `RowVerb.actionOf` decides what it does. */
  const actOnStatus = (sessionId: SessionSummary['id'], status: ThreadStatus): void => {
    const action = RowVerb.actionOf(status, { recovering: recoverySessionIds.has(sessionId), landConfirm: props.confirmLand !== undefined })
    if (action.kind === 'open') {
      openThread(sessionId)
      return
    }
    if (action.kind === 'confirm-land') {
      if (props.confirmLand?.(sessionId) !== true) openThread(sessionId)
      return
    }
    if (action.kind === 'resume') {
      void resumeRecoverySession(sessionId)
      return
    }
    const act = async (): Promise<void> => {
      try {
        const outcome = await inbox.act(action.itemId, action.verb)
        setNotice({ tone: outcome.ok ? 'success' : 'warning', message: outcome.message })
      } catch {
        setNotice({ tone: 'danger', message: props.tSidebar('threadSidebarVerbFailed') })
      }
    }
    void act()
  }
  const asideOpener = useAsideOpen()
  const latestRowActions = useRef({
    actOnStatus,
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
    turnThreadIntoProject,
    notifyThread,
    setNotify: (target: ThreadNotifyTarget, choice: ThreadNotifyChoice) =>
      subscriptions.setNotify({ subscriberSessionId: target.subscriberSessionId, targetSessionIds: [target.targetSessionId], choice }),
    batchNotifySubscriber: () => (subscriptions.available && selectedSession !== undefined ? { title: selectedSession.displayTitle } : undefined),
    batchNotify: (choice: ThreadNotifyChoice) => {
      if (selectedSession === undefined) return
      subscriptions.setNotify({ subscriberSessionId: selectedSession.id, targetSessionIds: selectionRef.current.sessionIds, choice })
    },
    props,
    sessionsById: sessionState.byId,
    preferences,
    changePreferences,
  })
  latestRowActions.current = {
    actOnStatus,
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
    turnThreadIntoProject,
    notifyThread,
    setNotify: (target: ThreadNotifyTarget, choice: ThreadNotifyChoice) =>
      subscriptions.setNotify({ subscriberSessionId: target.subscriberSessionId, targetSessionIds: [target.targetSessionId], choice }),
    batchNotifySubscriber: () => (subscriptions.available && selectedSession !== undefined ? { title: selectedSession.displayTitle } : undefined),
    batchNotify: (choice: ThreadNotifyChoice) => {
      if (selectedSession === undefined) return
      subscriptions.setNotify({ subscriberSessionId: selectedSession.id, targetSessionIds: selectionRef.current.sessionIds, choice })
    },
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
        icon: <PinIcon strokeWidth={1.5} size={16} />,
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
  // The peek's state is declared below the row actions; rows reach it through this ref.
  const openPeek = useRef<(sessionId: string) => void>(() => undefined)
  // One stable object for every row; it reads the latest closures so memoized rows never go stale.
  const rowActions = useMemo<RowActions>(() => {
    return {
      open: sessionId => latestRowActions.current.openThread(sessionId),
      selection: () => latestRowActions.current.selection(),
      multiSelection,
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
      turnIntoProject: (session, folder) => void latestRowActions.current.turnThreadIntoProject(session, folder),
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
      actOnStatus: (sessionId, status) => latestRowActions.current.actOnStatus(sessionId, status),
      peek: sessionId => openPeek.current(sessionId),
      setNotify: (target, choice) => latestRowActions.current.setNotify(target, choice),
      batchNotifySubscriber: () => latestRowActions.current.batchNotifySubscriber(),
      batchNotify: choice => latestRowActions.current.batchNotify(choice),
      notifyDefaultLevel: () => latestRowActions.current.preferences.subscriptionNoticeLevel,
      translate: (...args) => latestRowActions.current.props.tSidebar(...args),
    }
  }, [multiSelection])

  // Kept for this component's lifetime: the per-parent child rows must outlive a render to stay identical.
  const childRowCacheRef = useRef<ThreadChildRowCache | null>(null)
  childRowCacheRef.current ??= createThreadChildRowCache()
  const childRowCache = childRowCacheRef.current
  const launchOrderCache = useRef(new Map<SessionSummary['id'], readonly string[]>())

  const orderedVisibleThreadIds = (list: HTMLElement): string[] => ThreadListNavigationModel.visibleRows(list).map(row => row.id)

  const lookahead = (sessionIds: readonly string[]): void => {
    if (props.onNavigationLookahead === undefined) return
    const lookaheadSessions = sessionIds.flatMap(sessionId => {
      const session = sessionState.byId[SessionId(sessionId)]
      return session === undefined ? [] : [session.id]
    })
    props.onNavigationLookahead(lookaheadSessions)
  }

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
      onLookahead: lookahead,
    })
  }

  // Keyboard triage of the list (plan Q2 T2.2): the shortcut layer's list keys act on the focused row, or on every
  // selected row, through the same batch verbs as the row menu; Z takes the last one back.
  const listUndo = useRef<(() => void) | null>(null)
  const latestAttention = useRef(attention)
  latestAttention.current = attention
  const [peekId, setPeekId] = useState<string | null>(null)
  openPeek.current = sessionId => setPeekId(sessionId)
  const listTargets = (): readonly string[] => {
    const selected = selectionRef.current.sessionIds.filter(sessionId => sessionState.byId[SessionId(sessionId)] !== undefined)
    if (selected.length > 0) return selected
    const list = scrollAreaRef.current
    const focused = list === null ? undefined : ThreadListNavigationModel.focusedRowId(list)
    return focused === undefined ? [] : [focused]
  }
  const withTargets = (sessionIds: readonly string[], run: () => void): void => {
    selectionRef.current = { sessionIds: [...sessionIds], anchorId: sessionIds[0] }
    run()
  }
  // Undo runs renders later, when these closures' own state is stale; it calls the newest batch verbs instead.
  const latestBatch = useRef({ batchSetSettled, batchSetParked, batchMutate, batchMute, batchUnmute })
  latestBatch.current = { batchSetSettled, batchSetParked, batchMutate, batchMute, batchUnmute }
  /** Each list verb on explicit threads, returning its undo; keys, the palette's thread rows and Z share them. */
  const threadVerbs = {
    done: (sessionIds: readonly string[]): (() => void) => {
      const settled = sessionIds.every(sessionId => settledSessionIds.has(SessionId(sessionId)))
      withTargets(sessionIds, () => batchSetSettled(!settled))
      return () => withTargets(sessionIds, () => latestBatch.current.batchSetSettled(settled))
    },
    park: (sessionIds: readonly string[]): (() => void) => {
      const parked = sessionIds.every(sessionId => parkedSessionIds.has(sessionId))
      withTargets(sessionIds, () => batchSetParked(!parked))
      return () => withTargets(sessionIds, () => latestBatch.current.batchSetParked(parked))
    },
    pin: (sessionIds: readonly string[]): (() => void) => {
      const pin = sessionIds.some(sessionId => !pinnedSessionIds.has(SessionId(sessionId)))
      withTargets(sessionIds, () => batchMutate(pin ? 'pin' : 'unpin'))
      return () => withTargets(sessionIds, () => latestBatch.current.batchMutate(pin ? 'unpin' : 'pin'))
    },
    mute: (sessionIds: readonly string[]): (() => void) => {
      const muted = sessionIds.some(sessionId => mutedSessionIds.has(SessionId(sessionId)))
      withTargets(sessionIds, () => (muted ? batchUnmute() : batchMute('forever')))
      return () => withTargets(sessionIds, () => (muted ? latestBatch.current.batchMute('forever') : latestBatch.current.batchUnmute()))
    },
    unread: (sessionIds: readonly string[]): (() => void) => {
      withTargets(sessionIds, batchMarkUnread)
      return () => {
        const entries = sessionIds.flatMap(sessionId => {
          const record = latestAttention.current.records.get(sessionId)
          return record === undefined ? [] : [{ sessionId, version: record.version }]
        })
        if (entries.length > 0) latestAttention.current.clearUnreadMany(entries)
      }
    },
  }
  const listVerb = (apply: (sessionIds: readonly string[]) => () => void): false | undefined => {
    const sessionIds = listTargets()
    if (sessionIds.length === 0) return false
    const list = scrollAreaRef.current
    const before =
      list === null
        ? undefined
        : { orderedIds: ThreadListNavigationModel.visibleRows(list).map(row => row.id), focusedId: ThreadListNavigationModel.focusedRowId(list) }
    listUndo.current = apply(sessionIds)
    // Done or Snooze moves the focused row away: focus the next row, never the page body (D15).
    if (list !== null && before !== undefined) ThreadListNavigationModel.keepFocusInList(list, before)
    return undefined
  }
  const moveListFocus = (direction: 1 | -1, extend: boolean): false | undefined => {
    const list = scrollAreaRef.current
    if (list === null) return false
    setPeekId(null)
    return ThreadListNavigationModel.move({
      list,
      direction,
      extend,
      selection: selectionRef.current,
      onSelectionChange: setThreadSelection,
      onLookahead: lookahead,
    })
      ? undefined
      : false
  }
  const onRowButton = (trigger: CommandTrigger | undefined): boolean => {
    const target = trigger?.event?.target
    return target instanceof Element && target.closest(THREAD_MAIN_BUTTON_SELECTOR) !== null
  }
  const peekSignal = peekId === null ? undefined : inbox.signals.get(peekId)
  const listRegion = (): HTMLDivElement | null => scrollAreaRef.current
  useCommands(isBoard ? undefined : plugin, [
    {
      id: '@dshfiles/thread-sidebar.list-next',
      title: tSidebar('threadSidebarKeyNext'),
      keys: ['J'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region: listRegion,
      run: () => moveListFocus(1, false),
    },
    {
      id: '@dshfiles/thread-sidebar.list-previous',
      title: tSidebar('threadSidebarKeyPrevious'),
      keys: ['K'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region: listRegion,
      run: () => moveListFocus(-1, false),
    },
    {
      id: '@dshfiles/thread-sidebar.list-extend-down',
      title: tSidebar('threadSidebarKeyExtendDown'),
      keys: ['Shift+J'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region: listRegion,
      run: () => moveListFocus(1, true),
    },
    {
      id: '@dshfiles/thread-sidebar.list-extend-up',
      title: tSidebar('threadSidebarKeyExtendUp'),
      keys: ['Shift+K'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region: listRegion,
      run: () => moveListFocus(-1, true),
    },
    {
      id: '@dshfiles/thread-sidebar.list-select',
      title: tSidebar('threadSidebarKeySelect'),
      keys: ['X'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region: listRegion,
      run: () => {
        const list = scrollAreaRef.current
        const focused = list === null ? undefined : ThreadListNavigationModel.focusedRowId(list)
        if (focused === undefined) return false
        setThreadSelection(ThreadSelectionModel.toggle(selectionRef.current, focused))
        return undefined
      },
    },
    {
      id: '@dshfiles/thread-sidebar.list-open',
      title: tSidebar('threadSidebarKeyOpen'),
      keys: ['Enter'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region: listRegion,
      run: trigger => {
        const list = scrollAreaRef.current
        const focused = list === null ? undefined : ThreadListNavigationModel.focusedRowId(list)
        const session = focused === undefined ? undefined : sessionState.byId[SessionId(focused)]
        if (session === undefined || !onRowButton(trigger)) return false
        openThread(session.id)
        return undefined
      },
    },
    {
      id: '@dshfiles/thread-sidebar.list-done',
      title: tSidebar('threadSidebarKeyDone'),
      keys: ['E'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region: listRegion,
      run: () => listVerb(threadVerbs.done),
    },
    {
      id: '@dshfiles/thread-sidebar.list-park',
      title: tSidebar('threadSidebarKeyPark'),
      keys: ['H'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region: listRegion,
      run: () => listVerb(threadVerbs.park),
    },
    {
      id: '@dshfiles/thread-sidebar.list-pin',
      title: tSidebar('threadSidebarKeyPin'),
      keys: ['P'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region: listRegion,
      run: () => listVerb(threadVerbs.pin),
    },
    {
      id: '@dshfiles/thread-sidebar.list-mute',
      title: tSidebar('threadSidebarKeyMute'),
      keys: ['M'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region: listRegion,
      run: () => listVerb(threadVerbs.mute),
    },
    {
      id: '@dshfiles/thread-sidebar.list-unread',
      title: tSidebar('threadSidebarKeyUnread'),
      keys: ['U'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region: listRegion,
      run: () => listVerb(threadVerbs.unread),
    },
    {
      id: '@dshfiles/thread-sidebar.list-undo',
      title: tSidebar('threadSidebarKeyUndo'),
      keys: ['Z'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region: listRegion,
      run: () => {
        const undo = listUndo.current
        listUndo.current = null
        if (undo === null) setNotice({ tone: 'success', message: tSidebar('threadSidebarNothingToUndo') })
        else {
          undo()
          setNotice({ tone: 'success', message: tSidebar('threadSidebarUndone') })
        }
      },
    },
    {
      id: '@dshfiles/thread-sidebar.list-peek',
      title: tSidebar('threadSidebarKeyPeek'),
      keys: ['Space'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region: listRegion,
      run: trigger => {
        const list = scrollAreaRef.current
        const focused = list === null ? undefined : ThreadListNavigationModel.focusedRowId(list)
        if (focused === undefined || !onRowButton(trigger)) return false
        setPeekId(current => (current === focused ? null : focused))
        return undefined
      },
    },
    {
      id: '@dshfiles/thread-sidebar.list-new-thread',
      title: tSidebar('threadSidebarKeyNewThread'),
      keys: ['C'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      region: listRegion,
      // New thread belongs to the palette (it owns the web chord too); the list only asks for it.
      run: () => (plugin.commands.run('@dshfiles/command-palette.new-thread') ? undefined : false),
    },
    {
      id: '@dshfiles/thread-sidebar.list-peek-choice',
      title: tSidebar('threadSidebarKeyPeek'),
      keys: ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      enabled: peekSignal?.choices !== undefined,
      region: listRegion,
      run: trigger => {
        const choice = peekSignal?.choices?.[Number(trigger?.keys) - 1]
        if (peekSignal === undefined || choice === undefined) return false
        void inbox.act(peekSignal.itemId, 'Answer', choice.id)
        setPeekId(null)
        return undefined
      },
    },
    // Filter presets (b:xpvk): `[` and `]` step through the enabled presets, wrapping. 1–9 already answer in the peek
    // and G is the destination chord, so the bracket pair is the free list key (Q2 keymap).
    {
      id: '@dshfiles/thread-sidebar.list-preset-previous',
      title: tSidebar('threadSidebarPresetPrevious'),
      keys: ['['],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      enabled: presetsOn,
      region: listRegion,
      run: () => cyclePreset(-1),
    },
    {
      id: '@dshfiles/thread-sidebar.list-preset-next',
      title: tSidebar('threadSidebarPresetNext'),
      keys: [']'],
      scope: 'list',
      section: 'Lists',
      hidden: true,
      enabled: presetsOn,
      region: listRegion,
      run: () => cyclePreset(1),
    },
  ])
  const peekSession = peekId === null ? undefined : sessionState.byId[SessionId(peekId)]
  const peekReply = useLastReply(peekSession === undefined ? undefined : props.retainPeek, peekSession?.id)
  const peekStatus = peekSession === undefined ? undefined : (threadStatusById.get(peekSession.id) ?? childStatusById.get(peekSession.id))
  const peekWorkspace =
    peekSession === undefined
      ? undefined
      : (jjRepositories.data?.repositories ?? []).flatMap(repository => repository.threads).find(thread => thread.sessionIds.includes(peekSession.id))
  // Whether the pending revisions can land now: unknown until jj has checked, and nothing to say without any.
  const peekLanding = ((): readonly string[] => {
    if (peekWorkspace === undefined || peekWorkspace.unlanded.length === 0) return []
    if (peekWorkspace.canRebase === true) return [tSidebar('threadSidebarPeekCanLand')]
    if (peekWorkspace.canRebase === false) return [tSidebar('threadSidebarPeekBlocked')]
    return []
  })()
  const peekFacts =
    peekSession === undefined
      ? []
      : [
          ...(peekSession.running ? [tSidebar('threadSidebarPeekWorking')] : []),
          ...(peekWorkspace === undefined || peekWorkspace.unlanded.length === 0
            ? []
            : [tSidebar('threadSidebarPeekPending', { count: peekWorkspace.unlanded.length })]),
          ...((peekWorkspace?.behindCount ?? 0) > 0 ? [tSidebar('threadSidebarPeekBehind', { count: peekWorkspace?.behindCount ?? 0 })] : []),
          ...peekLanding,
        ]
  // ⌘K on a focused or selected row lists that thread's verbs first (plan Q2 T2.4). The palette takes focus when it
  // opens, so the row the user was on is remembered until focus lands somewhere that is neither the list nor a dialog.
  const lastListRow = useRef<string | null>(null)
  useEffect(() => {
    if (!isPrimarySurface) return
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      const list = scrollAreaRef.current
      if (target === null || list === null) return
      if (list.contains(target)) lastListRow.current = ThreadListNavigationModel.focusedRowId(list) ?? lastListRow.current
      else if (target.closest('[role="dialog"]') === null) lastListRow.current = null
    }
    window.addEventListener('focusin', onFocusIn, true)
    return () => window.removeEventListener('focusin', onFocusIn, true)
  }, [isPrimarySurface])
  const paletteTargets = (): readonly string[] => {
    const selected = selectionRef.current.sessionIds.filter(sessionId => sessionState.byId[SessionId(sessionId)] !== undefined)
    if (selected.length > 0) return selected
    const row = lastListRow.current
    if (row !== null && sessionState.byId[SessionId(row)] !== undefined) return [row]
    return selectedSessionId === undefined || sessionState.byId[selectedSessionId]?.blank === true ? [] : [selectedSessionId]
  }
  const paletteState = useRef({
    targets: paletteTargets,
    verbs: threadVerbs,
    open: openThread,
    byId: sessionState.byId,
    settledSessionIds,
    pinnedSessionIds,
    parkedSessionIds,
    mutedSessionIds,
    tSidebar,
  })
  paletteState.current = {
    targets: paletteTargets,
    verbs: threadVerbs,
    open: openThread,
    byId: sessionState.byId,
    settledSessionIds,
    pinnedSessionIds,
    parkedSessionIds,
    mutedSessionIds,
    tSidebar,
  }
  useEffect(() => {
    if (!isPrimarySurface) return
    const live = () => paletteState.current
    const heading = (): string => {
      const state = live()
      const targets = state.targets()
      const first = targets[0] === undefined ? undefined : state.byId[SessionId(targets[0])]
      return targets.length > 1
        ? state.tSidebar('threadSidebarPaletteActionsForMany', { count: targets.length })
        : state.tSidebar('threadSidebarPaletteActionsFor', { title: first?.displayTitle ?? '' })
    }
    const every = (has: (sessionId: string) => boolean): boolean => live().targets().every(has)
    const run = (verb: keyof typeof threadVerbs) => () => {
      const state = live()
      const targets = state.targets()
      if (targets.length > 0) listUndo.current = state.verbs[verb](targets)
    }
    const available = () => live().targets().length > 0
    const action = (id: string, label: () => string, keys: readonly string[], verb: keyof typeof threadVerbs) => ({
      id: `@dshfiles/thread-sidebar/thread-action/${id}`,
      group: 'thread' as const,
      heading,
      label,
      keys,
      isAvailable: available,
      run: run(verb),
    })
    return PaletteBridge.addActions([
      {
        id: '@dshfiles/thread-sidebar/thread-action/open',
        group: 'thread',
        heading,
        label: () => live().tSidebar('threadSidebarKeyOpen'),
        keys: ['Enter'],
        isAvailable: () => live().targets().length === 1,
        run: () => {
          const target = live().targets()[0]
          if (target !== undefined) live().open(SessionId(target))
        },
      },
      action(
        'done',
        () => live().tSidebar(every(id => live().settledSessionIds.has(SessionId(id))) ? 'threadSidebarUnsettle' : 'threadSidebarSettle'),
        ['E'],
        'done',
      ),
      action('pin', () => live().tSidebar(every(id => live().pinnedSessionIds.has(SessionId(id))) ? 'threadSidebarUnpin' : 'threadSidebarPin'), ['P'], 'pin'),
      action('park', () => live().tSidebar(every(id => live().parkedSessionIds.has(id)) ? 'threadSidebarUnpark' : 'threadSidebarPark'), ['H'], 'park'),
      action(
        'mute',
        () =>
          live().tSidebar(
            live()
              .targets()
              .some(id => live().mutedSessionIds.has(SessionId(id)))
              ? 'threadSidebarUnmute'
              : 'threadSidebarMute',
          ),
        ['M'],
        'mute',
      ),
      action('unread', () => live().tSidebar('threadSidebarMarkUnread'), ['U'], 'unread'),
    ])
  }, [isPrimarySurface])
  // ⌘K "Filter: ‹preset›" rows (b:xpvk): one per enabled preset, re-registered only when the presets' ids or names change.
  const presetPaletteState = useRef({ apply: selectThreadViewPreset, activeId: listThreadView.id, edited: presetEdited })
  presetPaletteState.current = { apply: selectThreadViewPreset, activeId: listThreadView.id, edited: presetEdited }
  const presetPaletteEntries = presetsOn
    ? threadViewSettings.views.filter(view => view.enabled).map(view => [view.id, threadViewPresetLabel(view, tSidebar)] as const)
    : []
  // The actions re-register only when an id or label changes; the effect reads the entries the key was made from.
  const presetPaletteKey = presetsOn ? JSON.stringify(presetPaletteEntries) : ''
  const presetPaletteLatest = useRef(presetPaletteEntries)
  presetPaletteLatest.current = presetPaletteEntries
  useEffect(() => {
    if (!isPrimarySurface || presetPaletteKey === '') return
    const presets = presetPaletteLatest.current
    return PaletteBridge.addActions(
      presets.map(([id, label]) => ({
        id: `@dshfiles/thread-sidebar/filter-preset/${id}`,
        group: 'command' as const,
        label: tSidebar('threadSidebarPresetPalette', { name: label }),
        aliases: ['filter', 'preset', 'view', label],
        isSelected: () => presetPaletteState.current.activeId === id && !presetPaletteState.current.edited,
        run: () => presetPaletteState.current.apply(id),
      })),
    )
  }, [isPrimarySurface, presetPaletteKey, tSidebar])
  const peekAnchor =
    peekId === null
      ? null
      : (scrollAreaRef.current?.querySelector<HTMLElement>(`${THREAD_MAIN_BUTTON_SELECTOR}[data-thread-id="${CSS.escape(peekId)}"]`) ?? null)

  const handleSelectionClickCapture = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // The click a pointer drag produces on release belongs to the drag, not to the row it started on.
    if (dragActor.getSnapshot().context.suppressed === 'row') {
      sendDrag({ type: 'suppression.consume' })
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

  // A child target reveals its parent row: the child list is part of that row once it is mounted.
  const revealThreadId = useMemo(() => {
    if (threadToScrollTo === null) return undefined
    for (const [rootId, children] of threadTree.childrenByRoot) if (children.some(child => child.id === threadToScrollTo)) return rootId
    return threadToScrollTo
  }, [threadToScrollTo, threadTree])
  const virtualRowsProps = {
    scrollElement: scrollAreaRef,
    // The open thread stays mounted wherever it moved, so arrow-key switching can put focus back on it.
    pinnedThreadIds: [activeRowDrag?.sessionId, selectedSession?.id],
    revealThreadId,
    // A row and its 6px gap (round five T1).
    estimateSize: rowStyle.density === 'compact' ? 40 : 56,
    enabled: !isBoard,
  }
  const savedProjectChipOf = useSavedProjectChip()
  // The command palette paints project marks with the colours these rows use (round two, item 13).
  useEffect(() => {
    if (!isPrimarySurface) return
    return PaletteBridge.addProjectColors(PaletteProjectColorsModel.sourceOf({ savedChipOf: savedProjectChipOf, palette: preferences.projectColorPalette }))
  }, [isPrimarySurface, preferences.projectColorPalette, savedProjectChipOf])
  // Each parent's subagent catalog in launch order, the same array while it is unchanged so the row's memo holds.
  const childLaunchOrder = (parentId: SessionSummary['id']): readonly string[] | undefined => {
    const catalog = sessionState.projectionsBySession[parentId]?.values.subagentCatalog
    if (catalog === undefined) return undefined
    const next = [...catalog].sort((left, right) => left.createdAt - right.createdAt).map(entry => entry.id)
    const cached = launchOrderCache.current.get(parentId)
    if (cached !== undefined && cached.length === next.length && cached.every((id, index) => id === next[index])) return cached
    launchOrderCache.current.set(parentId, next)
    return next
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
    const ownWorkspace = OwnWorkspaceModel.of({
      registered: realWorkspaceId === undefined || realWorkspaceId === workspaceId ? undefined : workspacePathById.get(realWorkspaceId),
      cwd: session.cwd,
      thread: jjThreadBySession.get(session.id),
      rebasedAt: rebasedIndex.rebasedAtBySessionId.get(session.id),
      t: tSidebar,
      threadDirectories,
    })
    const workspacePath = workspaceId === undefined ? undefined : workspacePathById.get(workspaceId)
    const savedProjectChip = workspacePath === undefined ? undefined : savedProjectChipOf(workspacePath)
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
        dragging={activeRowDrag?.sessionId === session.id}
        selected={selectedSession?.id === session.id}
        parentTitle={lineage.parentTitle}
        workspaceId={workspaceId}
        workspaceTitle={workspaceId === undefined ? undefined : workspaceTitleById.get(workspaceId)}
        workspacePath={workspacePath}
        projectChipTone={savedProjectChip?.tone}
        projectChipColor={savedProjectChip?.color}
        ownWorkspaceName={ownWorkspace?.name}
        ownWorkspacePath={ownWorkspace?.path}
        ownWorkspaceState={ownWorkspace?.state?.kind}
        ownWorkspaceStateText={ownWorkspace?.state?.text}
        ownWorkspaceStateAt={ownWorkspace?.state?.at}
        machine={machine}
        age={formatAge(session.updatedAt)}
        mute={mutedSessionIds.has(session.id) ? mutedThreads[session.id] : undefined}
        attentionLabel={rowAttentionLabel}
        integrationQueuedAt={integrationQueuedAtBySessionId.get(session.id)}
        needsResume={recoverySessionIds.has(session.id)}
        resumeBusy={resumeBusySessionIds.has(session.id)}
        renaming={renamingSessionId === session.id}
        childAttentionLabels={inlineAttentionLabels}
        rowStyle={rowStyle}
        rowActions={rowActionButtons}
        childThreads={childRow.live}
        finishedChildThreads={childRow.finished}
        childLaunchOrder={childLaunchOrder(session.id)}
        childrenOpen={shouldOpenChildThreadList({ children: childRow.listed, override: childrenOpenOverrides.get(session.id) })}
        allChildrenShown={expandedParents.has(session.id)}
        selectedChildId={childRow.selectedChildId}
        actions={rowActions}
        workStatus={statusGlyphs ? (threadStatusById.get(session.id) ?? childStatusById.get(session.id)) : undefined}
        childStatuses={statusGlyphs ? childStatusById : undefined}
        agent={statusGlyphs ? (agentHandleOf(session.id) ?? agentPresetOf(session)) : undefined}
        // A project section's header already carries the mark; elsewhere every row leads with its project's mark.
        projectMark={threadView.groupBy !== 'project'}
        liveTurn={session.running ? liveTurns.get(session.id) : undefined}
        runningJobs={runningJobs.get(session.id)}
        notifyTarget={
          !subscriptions.available || selectedSession === undefined || selectedSession.id === session.id
            ? undefined
            : {
                subscriberSessionId: selectedSession.id,
                subscriberTitle: selectedSession.displayTitle,
                targetSessionId: session.id,
                choice: subscriptions.choiceOf({ subscriberSessionId: selectedSession.id, targetSessionId: session.id }),
              }
        }
        subscriberCount={subscriptions.available ? subscriptions.notifiersOf(session.id).length : undefined}
      />
    )
  }
  const remoteThreadRowLabels = useMemo(
    (): RemoteThreadRowLabels => ({
      settle: tSidebar('threadSidebarSettle'),
      unsettle: tSidebar('threadSidebarUnsettle'),
      park: tSidebar('threadSidebarPark'),
      unpark: tSidebar('threadSidebarUnpark'),
      archive: tSidebar('threadSidebarArchive'),
      restore: tSidebar('threadSidebarRestore'),
      moveToSection: tSidebar('threadSidebarMoveToSection'),
      copyId: tSidebar('threadSidebarCopyId'),
      contextMenu: tSidebar('threadSidebarContextMenu'),
      sectionLabels: {
        pinned: tSidebar(sectionLabels.pinned),
        active: tSidebar(sectionLabels.active),
        parked: tSidebar(sectionLabels.parked),
        settled: tSidebar(sectionLabels.settled),
        inactive: tSidebar(sectionLabels.inactive),
        archived: tSidebar(sectionLabels.archived),
      },
    }),
    [tSidebar],
  )
  const renderRemoteThreadRow = (thread: RemoteSidebarThread, section?: SidebarSection): JSX.Element => {
    const sessionId = SessionId(thread.sessionId)
    return (
      <RemoteThreadItem
        key={`${thread.runtimeId}:${thread.sessionId}`}
        runtimeId={thread.runtimeId}
        sessionId={thread.sessionId}
        label={thread.title}
        cwd={thread.cwd}
        hostName={thread.hostName}
        workspaceTitle={thread.workspaceTitle}
        connected={thread.connected}
        running={thread.running}
        settled={settledSessionIds.has(sessionId)}
        parked={parkedSessionIds.has(sessionId)}
        archived={thread.archived}
        selected={selectedSession?.id === sessionId}
        compact={rowStyle.density === 'compact'}
        age={formatAge(thread.updatedAt)}
        section={section}
        dropSections={SidebarOrganization.remoteDropSections}
        labels={remoteThreadRowLabels}
        dragging={activeRowDrag?.kind === 'remote' && activeRowDrag.sessionId === sessionId}
        onOpen={() => (props.openRemoteSession === undefined ? props.openRemoteThreads?.() : props.openRemoteSession(thread.sessionId))}
        onToggleSettled={() => toggleRemoteSettled(sessionId)}
        onToggleParked={() => toggleParked(sessionId)}
        onSetArchived={archived => setRemoteThreadArchived(thread, archived)}
        onMoveToSection={next => moveRemoteThreadToSection(sessionId, next)}
        // The copied id names the Session on its own runtime; a link built here would point at this origin and drop the host.
        onCopyId={() => void rowActions.copy(thread.sessionId, props.tSidebar('threadSidebarIdCopied'))}
      />
    )
  }

  useEffect(() => {
    if (!isPrimarySurface || sessionState.phase !== 'ready') return
    // Only a pending interaction can start a transition; rows without one read as absent from the previous record.
    const currentStatusEntries: { sessionId: SessionId; status: ThreadInteractionStatus }[] = []
    for (const session of sessions) {
      const pending = sessionStatus.get(session.id)?.pendingInteraction
      if (pending !== undefined)
        currentStatusEntries.push({ sessionId: session.id, status: { pendingInteractionKey: pending.key, pendingInteractionKind: pending.kind } })
    }
    const currentStatus: Readonly<Record<string, ThreadInteractionStatus>> = Object.fromEntries(
      currentStatusEntries.map((entry): [string, ThreadInteractionStatus] => [entry.sessionId, entry.status]),
    )
    const transitions = ThreadNotificationModel.threadInteractionTransitions(previousStatus.current, currentStatusEntries)
    previousStatus.current = currentStatus
    for (const sessionId of transitions.approvalNeeded) {
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
      if (record.finishedAt === null || record.finishedSeq === null) continue
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

  // The Filter menu's View section (productivity pass Q5, T5.3): the active view, and
  // the threads it matches for Mark view read / unread.
  const headerExtras = useSyncExternalStore(ListHeaderExtras.subscribe, ListHeaderExtras.get, () => ListHeaderExtras.empty)
  const activeViewTab = viewTabs.find(tab => tab.view.id === listThreadView.id)
  // The trigger's accessible name after "Filter: ": the active preset ("Needs you (edited)"), or with presets off the
  // filters themselves, as before b:xpvk.
  const activePresetLabel = activeViewTab?.label ?? props.tSidebar('threadSidebarAllThreads')
  const filterTriggerName = !presetsOn
    ? activeFilterSummary
    : presetEdited
      ? props.tSidebar('threadSidebarPresetEdited', { name: activePresetLabel })
      : activePresetLabel
  const activeViewThreadIds =
    activeViewTab === undefined
      ? []
      : threadViewAttentionEntries
          .filter(entry =>
            ThreadViewModel.matchesAttentionView(entry, { filters: activeViewTab.view.statusFilters, sourceFilter: activeViewTab.view.sourceFilter }),
          )
          .map(entry => entry.thread.id)
  const clearActiveViewUnread = (): void => {
    const entries = activeViewThreadIds.flatMap(sessionId => {
      const record = attention.records.get(sessionId)
      return record === undefined ? [] : [{ sessionId, version: record.version }]
    })
    if (entries.length > 0) attention.clearUnreadMany(entries)
  }
  const markActiveViewUnread = (): void => {
    const sessionIds = activeViewThreadIds.filter(sessionId => !attention.records.has(sessionId))
    if (sessionIds.length > 0) attention.markUnreadMany(sessionIds)
  }
  const listFiltered = listThreadView.id !== ALL_THREADS_VIEW_ID || activeFilterLabels.length > 0 || presetEdited

  // `notify_user`: the agent's own message, routed through its own “Agent messages” category.
  const userNotifications = useApi(userNotificationApi)
  useApiEvent(userNotificationApi, 'sent', notification => {
    if (!isPrimarySurface) return
    const linked = notification.sessionId === null ? undefined : sessionState.byId[SessionId(notification.sessionId)]
    const body = notification.body === '' ? notification.title : notification.body
    const outcome = latestRowActions.current.notifyThread(
      AGENT_MESSAGE_NOTIFICATION_CATEGORY,
      `user:${notification.id}`,
      linked?.id ?? null,
      notification.title,
      body,
      `${notification.title}: ${body}`,
    )
    // The Host tells the agent whether the user saw it; a Host from before acknowledge simply never asks.
    void userNotifications.acknowledge({ id: notification.id, outcome }).catch(() => undefined)
  })

  const isTransientNotice =
    notice !== null && (notice.tone === 'success' || notice.durationMs !== undefined || (notice.actionLabel !== undefined && notice.onAction !== undefined))
  const noticeAlert =
    notice === null ? null : (
      <SidebarNoticeAlert
        notice={notice}
        className={noticeClass}
        transient={isTransientNotice}
        notification={isThreadNotification}
        dismissLabel={props.tSidebar(isThreadNotification ? 'threadSidebarDismissNotification' : 'threadSidebarDismissAlert')}
        onDismiss={() => setNotice(null)}
      />
    )

  // The list's one Filter menu: beside the project picker on a desktop, the scope button in the search row on a phone
  // (council round 10 B1), where it also holds the project.
  const scopeSlot = headerExtras.scopeSlot
  const scopeInput = {
    filterCount: ThreadListScope.filterCount({ filtered: listFiltered, filterLabels: activeFilterLabels.length }),
    project: projectFilterValue === ALL_PROJECTS ? null : projectFilterLabel,
    filters: props.tSidebar('threadSidebarFilters'),
  }
  const scopeCount = ThreadListScope.count(scopeInput)
  // The Filter panel (round nine, owner annotation): one level instead of five submenus, every value shown where it
  // sits, a change applied at once beside the list; a footer for the list's other places; a phone sheet (the kit's).
  const closeFilterThen =
    (action: () => void): (() => void) =>
    () => {
      setFilterOpen(false)
      action()
    }
  const markViewActions: ListFilterAction[] = [
    {
      id: 'mark-read',
      label: props.tSidebar('threadSidebarMarkViewRead'),
      icon: null,
      disabled: !attention.available || !activeViewThreadIds.some(sessionId => attention.records.has(sessionId)),
      onSelect: clearActiveViewUnread,
    },
    {
      id: 'mark-unread',
      label: props.tSidebar('threadSidebarMarkViewUnread'),
      icon: null,
      disabled: !attention.available || activeViewThreadIds.length === 0,
      onSelect: markActiveViewUnread,
    },
  ]
  const filterActions: ListFilterAction[] = [
    // With presets on, the preset's own menu holds these.
    ...(presetsOn ? [] : markViewActions),
    ...headerExtras.sections.map(section => ({ id: section.panelId, label: section.label, icon: section.icon, onSelect: closeFilterThen(section.open) })),
    {
      id: 'thread-list-settings',
      label: props.tSidebar('threadSidebarThreadListSettings'),
      icon: <Settings2Icon />,
      onSelect: closeFilterThen(() => setSettingsOpen(current => !current)),
    },
    ...(headerExtras.customize === undefined
      ? []
      : [{ id: 'customize', label: headerExtras.customize.label, icon: <SlidersHorizontalIcon />, onSelect: closeFilterThen(headerExtras.customize.toggle) }]),
  ]
  const projectNarrowed = scopeSlot !== null && projectFilterValue !== ALL_PROJECTS
  /**
   * Reset: All threads with no filter on, the grouping kept (it sits below Reset, in the panel's Display section), and in
   * the phone sheet, which holds the project, All projects.
   */
  const resetListFilters = (): void => {
    const reset = ThreadViewPreferencesModel.resetThreadViewFilters(threadViewSettings)
    const threadViews = ThreadViewPreferencesModel.updateThreadViewSettings(reset.settings)
    changePreferences(projectNarrowed ? { threadViews, workspaceFilter: null } : reset.workspaceFilter === undefined ? { threadViews } : { threadViews, workspaceFilter: reset.workspaceFilter })
  }
  const resetDisabled = activeFilterLabels.length === 0 && !projectNarrowed
  /** Save the current filters as a new preset: the name prompt, or the limit's warning. */
  const saveFiltersAsPreset = (): void => {
    if (threadViewSettings.views.length >= MAX_THREAD_VIEWS) {
      setNotice({ tone: 'warning', message: props.tSidebar('threadSidebarPresetFull', { count: MAX_THREAD_VIEWS }) })
      return
    }
    setFilterOpen(false)
    setPresetPrompt({ mode: 'create' })
  }
  // The built-in All threads is never renamed, overwritten or deleted (council round 28, item 13).
  const activeIsBuiltIn = listThreadView.id === ALL_THREADS_VIEW_ID
  const builtInHintId = useId()
  const presetOptionsMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          // Its 16px glyph ends on the panel's 12px inset, the edge Reset's label ends on (round 28, item 16). On a coarse
          // pointer its 44px touch area reaches left (20px) instead of 10px each way, which put 2px past the sheet's edge
          // and scrolled it sideways (council round 29, item 4).
          className="dshx:-mr-1 dshx:text-muted-foreground dshx:pointer-coarse:after:right-0 dshx:pointer-coarse:after:-left-5"
          aria-label={`${props.tSidebar('threadSidebarPresetOptions')}: ${activeViewTab?.label ?? ''}`}
        >
          <OverflowGlyph />
        </Button>
      </DropdownMenuTrigger>
      {/* A fixed 256px, aligned to the ⋯'s end, so it stays inside the 320px panel (council round 30, item 4). */}
      <DropdownMenuContent align="end" className="dshx-root dshx:w-64" aria-label={props.tSidebar('threadSidebarPresetOptions')}>
        {/* The built-in All threads shows no dead rows (council round 29, item 2): one caption says why, and describes
            the one way to keep its changes (a <p> in a menu is skipped unless an item points at it: round 30, item 4). */}
        {activeIsBuiltIn ? (
          <p id={builtInHintId} className="dshx:px-2 dshx:pt-1.5 dshx:pb-1 dshx:text-xs dshx:whitespace-normal dshx:text-muted-foreground" data-preset-built-in-hint="">
            {props.tSidebar('threadSidebarPresetBuiltInHint')}
          </p>
        ) : null}
        {/* Save as… left the panel for this menu, so the sheet opens on the filters (round 28, item 10). */}
        <DropdownMenuItem onSelect={saveFiltersAsPreset} aria-describedby={activeIsBuiltIn ? builtInHintId : undefined}>
          {/* One verb name, as on the edited built-in row's button (council round 29, item 2). */}
          {props.tSidebar('threadSidebarPresetSaveAsNew')}
        </DropdownMenuItem>
        {/* One text edge (no verb carries an icon) and the preset's name as a quiet label (council round 28, item 12),
            for a user preset only: the built-in caption already says which. */}
        {activeIsBuiltIn ? null : (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="dshx:truncate dshx:text-xs dshx:font-normal dshx:text-muted-foreground">{activeViewTab?.label ?? ''}</DropdownMenuLabel>
            <DropdownMenuItem
              onSelect={closeFilterThen(() =>
                setPresetPrompt({
                  mode: 'rename',
                  viewId: listThreadView.id,
                  name: activeViewTab?.label ?? threadViewPresetLabel(listThreadView, props.tSidebar),
                }),
              )}
            >
              {props.tSidebar('threadSidebarPresetRename')}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!presetEdited} onSelect={() => savePresetChanges()}>
              {/* One verb name, as on the edited row's button. */}
              {props.tSidebar('threadSidebarPresetSaveChanges', { name: activeViewTab?.label ?? '' })}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={threadViewSettings.views.length === 1 || viewTabs.length === 1}
              onSelect={closeFilterThen(() => setPresetToDelete({ id: listThreadView.id, label: activeViewTab?.label ?? '' }))}
            >
              {props.tSidebar('threadSidebarPresetDelete')}
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        {markViewActions.map(action => (
          <DropdownMenuItem key={action.id} disabled={action.disabled === true} onSelect={action.onSelect}>
            {action.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={closeFilterThen(() => setViewsManagerOpen(true))}>{props.tSidebar('threadSidebarPresetManage')}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
  const filterPanelStyle: FilterPanelRoomStyle | undefined = filterPanelRoom === null ? undefined : { '--filter-panel-room': `${String(filterPanelRoom)}px` }
  const filterMenu = (
    <Popover open={filterOpen} onOpenChange={setFilterOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          // The kit quiet secondary (council round 18 B1.4): the one look for an action beside a search field, the trigger
          // fill and hairline with its label in secondary ink, ink while the menu is open, whether or not a filter is on.
          ref={filterTriggerRef}
          variant="quiet"
          size="field"
          data-thread-list-filter=""
          data-filtered={listFiltered ? '' : undefined}
          // The list's keyboard model treats the view control as the way into the rows (thread-list-navigation.ts).
          data-thread-list-view-button=""
          // Arrow keys from the trigger move into the list, as the former view tabs did; Enter or Space opens it.
          // Radix's trigger opens its menu on ArrowDown unless the event is prevented first.
          onKeyDown={event => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
            navigateThreadList(event.nativeEvent)
            event.preventDefault()
          }}
          className={
            scopeSlot === null
              ? 'dshx:max-w-[50%] dshx:min-w-0 dshx:shrink dshx:gap-1 dshx:px-2 dshx:phone:px-3'
              : // The phone scope button: the funnel, "Filters" or the project, and the count of filters on; as wide as
                // its words, at most 45% of the row.
                'dshx:w-full dshx:min-w-0 dshx:gap-2 dshx:px-3'
          }
          // Filter presets (b:xpvk): the trigger names the active preset ("Filter: Needs you (edited)"), not the
          // filters it holds; the Status and Source rows inside the menu still spell those out. The phone scope button
          // adds the project it holds.
          // …and how many filters are on, as the count beside it shows (council round 29, item 11): "Filter: All threads,
          // 2 filters on".
          aria-label={`${props.tSidebar('threadSidebarFilter')}: ${filterTriggerName}${scopeSlot === null || scopeInput.project === null ? '' : ` · ${scopeInput.project}`}${scopeCount === null ? '' : `, ${plural(props.tSidebar, 'threadSidebarFiltersOn', scopeCount)}`}`}
          data-preset-edited={presetEdited ? '' : undefined}
          data-thread-list-scope-button={scopeSlot === null ? undefined : ''}
          data-scope-narrowed={scopeSlot !== null && ThreadListScope.narrowed(scopeInput) ? '' : undefined}
        >
          {scopeSlot === null && scopeCount !== null ? (
            // On a desktop with filters on, the count takes the funnel's slot (council round 31, item 1): a 16px filter
            // badge, so it reads as filters on, not as a result count, and the name gets the funnel's room ("All threads").
            <span
              aria-hidden="true"
              data-testid="thread-scope-count"
              className="dshx:inline-flex dshx:size-4 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:bg-muted dshx:text-2xs dshx:font-semibold dshx:text-foreground dshx:tabular-nums"
            >
              {scopeCount}
            </span>
          ) : (
            <ListFilterIcon className="dshx:size-3.5 dshx:shrink-0" aria-hidden="true" />
          )}
          {/* The preset's full name, \"All threads\" not \"All\" (council round 30, item 2: \"All 2\" read as two results), in the
              ink while the count pill beside it says filters are on. */}
          <span className={cn('dshx:truncate', scopeSlot === null && scopeCount !== null && 'dshx:text-foreground')}>
            {scopeSlot === null ? (presetsOn ? activePresetLabel : activeFilterSummary) : ThreadListScope.label(scopeInput)}
          </span>
          {scopeSlot !== null && scopeCount !== null ? (
            // The phone's "Filters 2" (council round 11 B2): a neutral pill after the word (council round 29, item 11).
            <Badge
              aria-hidden="true"
              data-testid="thread-scope-count"
              className="dshx:h-4 dshx:min-w-4 dshx:rounded-full dshx:border-transparent dshx:bg-muted dshx:px-1.25 dshx:py-0 dshx:text-2xs dshx:font-medium dshx:text-foreground dshx:tabular-nums"
            >
              {scopeCount}
            </Badge>
          ) : null}
          {/* With presets on the funnel already says "menu" and the preset name needs the room (b:xpvk). */}
          {presetsOn ? null : <ChevronDownIcon className="dshx:size-3 dshx:shrink-0" aria-hidden="true" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        // Beside the list on a desktop, so the rows it filters stay in view; the kit makes it the bottom sheet on a phone.
        side="right"
        align="start"
        sideOffset={8}
        collisionPadding={FILTER_PANEL_COLLISION_PADDING}
        style={filterPanelStyle}
        // Open on the preset in force, not on the first focusable control, the presets' ⋯ (round 28, item 14).
        onOpenAutoFocus={event => {
          const target = event.currentTarget instanceof HTMLElement ? filterPanelInitialFocus(event.currentTarget) : null
          if (target === null) return
          event.preventDefault()
          target.focus()
        }}
        aria-label={props.tSidebar('threadSidebarFilters')}
        // The phone sheet opens taller than the kit's 72dvh, so both Status rows show with three presets (round 28, item 10).
        // A column that holds still: the panel inside scrolls under its sticky header (round 29, item 7).
        // Its top holds on a desktop: no taller than the room below the trigger (round 31, item 7).
        className="dshx-root dshx:flex dshx:max-h-[min(var(--radix-popover-content-available-height),var(--filter-panel-room,100dvh))] dshx:w-80 dshx:max-w-[calc(100vw-1rem)] dshx:flex-col dshx:overflow-hidden dshx:p-0 dshx:phone:max-h-[85dvh]! dshx:phone:overflow-hidden!"
      >
        <ListFilterPanel
          t={props.tSidebar}
          project={
            scopeSlot === null ? undefined : (
              <Combobox
                contentClassName="dshx:w-(--radix-popover-trigger-width) dshx:min-w-56"
                emptyLabel={props.tSidebar('threadSidebarProjectSearchEmpty')}
                label={props.tSidebar('threadSidebarProjectFilter')}
                onValueChange={selectProject}
                options={projectOptions}
                searchAbove={0}
                searchLabel={props.tSidebar('threadSidebarProjectSearch')}
                searchPlaceholder={props.tSidebar('threadSidebarProjectSearchPlaceholder')}
                // One inline row, "Project · All projects ›", a list row rather than a field (round 28, item 10).
                triggerClassName="dshx:h-11 dshx:w-full dshx:min-w-0 dshx:rounded-md dshx:border-transparent dshx:bg-transparent dshx:px-0 dshx:hover:border-transparent dshx:hover:bg-accent"
                triggerContent={
                  <span className="dshx:flex dshx:w-full dshx:min-w-0 dshx:items-center dshx:gap-2" data-thread-project-row="">
                    <FolderIcon className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" aria-hidden="true" />
                    <span className="dshx:shrink-0 dshx:text-foreground">{props.tSidebar('threadSidebarGroupProject')}</span>
                    <span className="dshx:ml-auto dshx:min-w-0 dshx:truncate dshx:text-right dshx:text-muted-foreground">{projectFilterLabel}</span>
                    <ChevronRightIcon className="dshx:size-4 dshx:shrink-0 dshx:text-muted-foreground" aria-hidden="true" />
                  </span>
                }
                value={projectFilterValue}
              />
            )
          }
          presets={
            presetsOn
              ? {
                  items: viewTabs.map(({ view, label }) => {
                    // An edited preset counts what the list draws now (council round 29, item 6), in its row and its name.
                    const count = view.id === listThreadView.id && presetEdited ? visibleThreadEntries.length : (presetTallies.get(view.id) ?? null)
                    return { id: view.id, label, count: view.showCount === false ? null : count }
                  }),
                  activeId: listThreadView.id,
                  edited: presetEdited,
                  onApply: selectThreadViewPreset,
                  onSaveChanges: () => savePresetChanges(),
                  onDiscard: () => selectThreadViewPreset(listThreadView.id),
                  builtInId: ALL_THREADS_VIEW_ID,
                  onSaveAs: saveFiltersAsPreset,
                  options: presetOptionsMenu,
                }
              : undefined
          }
          status={showFilterControl ? { selected: threadView.statusFilters, onChange: statusFilters => updateThreadView({ statusFilters }) } : undefined}
          source={showFilterControl ? { value: threadView.sourceFilter, onChange: sourceFilter => updateThreadView({ sourceFilter }) } : undefined}
          sourceLabels={{
            all: { short: props.tSidebar('threadSidebarAllShort'), name: props.tSidebar(threadSourceFilterLabelKeys.all) },
            main: { short: props.tSidebar('threadSidebarFilterMainShort'), name: props.tSidebar(threadSourceFilterLabelKeys.main) },
            // Label in name (council round 28, item 17): the visible "Subagents" is its name.
            subagents: { short: props.tSidebar('threadSidebarFilterSubagentsShort'), name: props.tSidebar('threadSidebarFilterSubagentsShort') },
          }}
          group={
            showGroupControl
              ? {
                  value: threadView.groupBy,
                  options: ThreadBoardViewModel.groupingsOf(false),
                  labels: {
                    state: { short: props.tSidebar(threadGroupLabelKeys.state), name: props.tSidebar(threadGroupLabelKeys.state) },
                    project: { short: props.tSidebar(threadGroupLabelKeys.project), name: props.tSidebar(threadGroupLabelKeys.project) },
                    date: { short: props.tSidebar(threadGroupLabelKeys.date), name: props.tSidebar(threadGroupLabelKeys.date) },
                    // "Manual" so the five fit one segmented row; its name stays "Arrange manually".
                    status: { short: props.tSidebar('threadSidebarGroupManualShort'), name: props.tSidebar(threadGroupLabelKeys.status) },
                    none: { short: props.tSidebar(threadGroupLabelKeys.none), name: props.tSidebar(threadGroupLabelKeys.none) },
                  },
                  onChange: groupBy => updateThreadView({ groupBy }),
                }
              : undefined
          }
          reset={{ disabled: resetDisabled, onReset: resetListFilters }}
          onDone={() => setFilterOpen(false)}
          shown={plural(props.tSidebar, 'threadSidebarFilterShown', visibleThreadEntries.length)}
          actions={filterActions}
        />
      </PopoverContent>
    </Popover>
  )

  return (
    <TooltipProvider delayDuration={500}>
      <section
        // The list is sidebar furniture wherever it docks (rail column, Workbench pane, phone list): the same recessive
        // fill everywhere, which its sticky group headers match (T1.3).
        className={cn(
          'dshx-root dshx:relative dshx:flex dshx:h-full dshx:w-full dshx:min-h-0 dshx:min-w-0 dshx:flex-col dshx:bg-(--dsw-specific-sidebar-fill)',
          shiftPressed && 'dshx:select-none',
        )}
        aria-label={props.tSidebar(isBoard ? 'threadSidebarBoardTitle' : 'threadSidebarTitle')}
        data-thread-surface={surface}
        onClickCapture={handleSelectionClickCapture}
        onContextMenuCapture={handleSelectionContextMenuCapture}
      >
        {isBoard ? (
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
                  'dshx:min-w-0 dshx:justify-between dshx:border-0 dshx:bg-transparent dshx:px-2.5 dshx:font-medium dshx:hover:bg-accent',
                  isBoard ? 'dshx:w-56 dshx:text-sm' : 'dshx:flex-1 dshx:text-base',
                )}
                triggerContent={
                  <>
                    <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{projectFilterLabel}</span>
                    <span className="dshx:inline-flex dshx:text-muted-foreground" aria-hidden="true">
                      <ChevronDownIcon strokeWidth={1.5} size={14} />
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
                  aria-label={props.tSidebar('threadSidebarThreadListSettings')}
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
                // Read only by this tab's context menu: matching every listed row per tab on each render was the
                // sidebar's hottest loop while a turn streams.
                const matchingThreadIds =
                  viewMenuOpenId === view.id
                    ? threadViewAttentionEntries
                        .filter(entry => ThreadViewModel.matchesAttentionView(entry, { filters: view.statusFilters, sourceFilter: view.sourceFilter }))
                        .map(entry => entry.thread.id)
                    : NO_VIEW_MENU_THREAD_IDS
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
                // The built-in view reads "All" in the tab row so the three default views fit a 200px list as words, not
                // icons (T1.3); its accessible name stays "All threads".
                const shownLabel =
                  view.id === ALL_THREADS_VIEW_ID && label === props.tSidebar('threadSidebarAllThreads') ? props.tSidebar('threadSidebarAllShort') : label
                const accessibleLabel =
                  attentionLabel === undefined && visibleCount === null
                    ? undefined
                    : `${label}${countSuffix}${attentionLabel === undefined ? '' : `, ${props.tSidebar(attentionLabel)}`}`
                return (
                  <ContextMenu key={view.id} onOpenChange={open => setViewMenuOpenId(open ? view.id : null)}>
                    <ContextMenuTrigger asChild>
                      <Button
                        type="button"
                        data-thread-list-view-button=""
                        variant={view.id === listThreadView.id ? 'secondary' : 'ghost'}
                        size="sm"
                        className={cn(
                          // Grow from the content width, so a short "All" lends its room to "Working 1".
                          'dshx:flex-auto dshx:text-xs',
                          compactViewTabs ? 'dshx:min-w-0 dshx:shrink dshx:gap-1 dshx:px-1.5' : 'dshx:min-w-0 dshx:shrink-0 dshx:gap-1 dshx:px-2',
                          view.id !== listThreadView.id && 'dshx:text-muted-foreground',
                        )}
                        title={label}
                        aria-label={accessibleLabel ?? (shownLabel === label ? undefined : label)}
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
                          <span className="dshx:truncate">{shownLabel}</span>
                        )}
                        {attentionLabel === undefined ? null : (
                          <StatusDot
                            size="sm"
                            data-testid="thread-view-attention-dot"
                            className={cn(
                              ThreadAttentionPresentationModel.attentionDotClass({
                                attentionLabel,
                                attentionColors: preferences.attentionColors,
                                unread: false,
                                running: false,
                              }),
                            )}
                          />
                        )}
                        {visibleCount === null ? null : <span className="dshx:shrink-0 dshx:tabular-nums dshx:text-muted-foreground">{visibleCount}</span>}
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
                    className="dshx:inline-flex dshx:h-7 dshx:items-center dshx:justify-center dshx:gap-1 dshx:px-2 dshx:text-xs dshx:font-medium dshx:whitespace-nowrap"
                  >
                    {view.id === ALL_THREADS_VIEW_ID && label === props.tSidebar('threadSidebarAllThreads') ? props.tSidebar('threadSidebarAllShort') : label}
                    {attentionLabel === undefined ? null : <span className="dshx:size-1.5 dshx:shrink-0" />}
                    {visibleCount === null ? null : <span className="dshx:shrink-0">{visibleCount}</span>}
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
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            // Readable at 200px (T1.3): the icon says "group by", so the value keeps the whole width.
                            className="dshx:min-w-0 dshx:justify-start dshx:gap-1.5 dshx:px-2 dshx:text-xs dshx:font-normal dshx:text-muted-foreground"
                            aria-label={`${props.tSidebar('threadSidebarGroup')}: ${props.tSidebar(threadGroupLabelKeys[threadView.groupBy])}`}
                          >
                            <LayersIcon className="dshx:size-3.5 dshx:shrink-0" aria-hidden="true" />
                            <span className="dshx:truncate">{props.tSidebar(threadGroupLabelKeys[threadView.groupBy])}</span>
                            <ChevronDownIcon className="dshx:ml-auto dshx:size-3 dshx:shrink-0" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent>{`${props.tSidebar('threadSidebarGroup')}: ${props.tSidebar(threadGroupLabelKeys[threadView.groupBy])}`}</TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent align="start" className="dshx-root dshx:min-w-48">
                      <DropdownMenuLabel>{props.tSidebar('threadSidebarGroupBy')}</DropdownMenuLabel>
                      <DropdownMenuRadioGroup value={threadView.groupBy} onValueChange={selectThreadGroupBy}>
                        {ThreadBoardViewModel.groupingsOf(isBoard).map(groupBy => (
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
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="dshx:min-w-0 dshx:justify-start dshx:gap-1.5 dshx:px-2 dshx:text-xs dshx:font-normal dshx:text-muted-foreground"
                            aria-label={`${props.tSidebar('threadSidebarFilter')}: ${activeFilterSummary}`}
                          >
                            <ListFilterIcon className="dshx:size-3.5 dshx:shrink-0" aria-hidden="true" />
                            <span className="dshx:truncate">{activeFilterSummary}</span>
                            <ChevronDownIcon className="dshx:ml-auto dshx:size-3 dshx:shrink-0" aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                      </TooltipTrigger>
                      <TooltipContent>{`${props.tSidebar('threadSidebarFilter')}: ${activeFilterSummary}`}</TooltipContent>
                    </Tooltip>
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
        ) : (
          // Productivity pass Q5 (T5.3): above the first row the list keeps the project picker and one Filter menu; the
          // views, grouping, status and source filters, the Threads pages (Board) and both settings live in that menu.
          // The trigger keeps the former filter button's accessible name, "Filter: <active filters>".
          // On touch the row sits 4px under the 44px search and directly over the first group head (council round 6 B8).
          // The phone shell grid (round nine B4): fields fill from the 12px gutter, 8px under the search (its own padding)
          // and about 12px over the first group head's label (6px here, the head's own half-leading the rest).
          // On a phone (council round 10 B1) the row is gone: the Filter menu is the scope button in the search row, and
          // the header keeps only the preset chips when they are on.
          <header
            className={
              scopeSlot === null ? 'dshx:px-2 dshx:py-1 dshx:pointer-coarse:py-0 dshx:phone:px-3 dshx:phone:pb-1.5' : 'dshx:px-3 dshx:pb-1.5 dshx:empty:hidden'
            }
          >
            {/* Filter-row grammar (council round 8 B2): beside the search field, both value-showing triggers take the field
                look, 8px apart; their values in ink at the body weight. */}
            {scopeSlot !== null ? createPortal(filterMenu, scopeSlot) : (
            <div className="dshx:flex dshx:items-center dshx:gap-2">
              <Combobox
                contentClassName="dshx:w-(--radix-popover-trigger-width) dshx:min-w-56"
                emptyLabel={props.tSidebar('threadSidebarProjectSearchEmpty')}
                label={props.tSidebar('threadSidebarProjectFilter')}
                onValueChange={selectProject}
                options={projectOptions}
                searchAbove={0}
                searchLabel={props.tSidebar('threadSidebarProjectSearch')}
                searchPlaceholder={props.tSidebar('threadSidebarProjectSearchPlaceholder')}
                // The kit trigger's one control height, as the search (round nine B5); on a phone its value at the 24px
                // text edge.
                triggerClassName="dshx:min-w-0 dshx:flex-1 dshx:px-2.5 dshx:phone:px-3"
                triggerContent={
                  <>
                    <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{projectFilterLabel}</span>
                    <span className="dshx:inline-flex dshx:text-muted-foreground" aria-hidden="true">
                      <ChevronDownIcon strokeWidth={1.5} size={14} />
                    </span>
                  </>
                }
                value={projectFilterValue}
              />
              {filterMenu}
            </div>
            )}
            {presetsOn && threadViewSettings.showPresetChips ? (
              <PresetChips
                presets={viewTabs.map(tab => ({ id: tab.view.id, label: tab.label }))}
                activeId={listThreadView.id}
                edited={presetEdited}
                onApply={selectThreadViewPreset}
                t={props.tSidebar}
              />
            ) : null}
          </header>
        )}

        {settingsOpen && !isBoard ? (
          <section
            className="dshx:mx-2 dshx:mb-2 dshx:grid dshx:min-h-0 dshx:shrink dshx:gap-3 dshx:overflow-y-auto dshx:overscroll-contain dshx:rounded-lg dshx:border dshx:bg-card dshx:p-3"
            aria-label={props.tSidebar('threadSidebarThreadListSettings')}
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
              <Label className="dshx:font-normal dshx:leading-snug">
                <Checkbox
                  aria-label={props.tSidebar('threadSidebarShowPresets')}
                  checked={threadViewSettings.showPresets}
                  onCheckedChange={checked => saveThreadViewSettings(ThreadViewPreferencesModel.setPresetsEnabled(threadViewSettings, checked === true))}
                />
                {props.tSidebar('threadSidebarShowPresets')}
              </Label>
              <Label className="dshx:font-normal dshx:leading-snug">
                <Checkbox
                  aria-label={props.tSidebar('threadSidebarShowPresetChips')}
                  checked={threadViewSettings.showPresetChips}
                  disabled={!threadViewSettings.showPresets}
                  onCheckedChange={checked => saveThreadViewSettings({ ...threadViewSettings, showPresetChips: checked === true })}
                />
                {props.tSidebar('threadSidebarShowPresetChips')}
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
          onScroll={event => ListFade.restore(event.currentTarget)}
          data-shortcut-scope={isBoard ? undefined : 'list'}
          onPointerEnter={() => holdOrder('hover', true)}
          onPointerLeave={() => holdOrder('hover', false)}
          onFocus={event => {
            if (HeldGroupsModel.holdsOnFocus(event.target)) holdOrder('focus', true)
          }}
          onBlur={event => {
            if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) holdOrder('focus', false)
          }}
          // A floor of about two rows: in a short docked column (free docking with the bottom pane open) the section
          // scrolls past its controls instead of squeezing the list to a sliver no row fits in. A row scrolled to the
          // status bar thins out under a 24px fade (round five C5) instead of being cut; the list ends in padding as deep
          // as the fade, so the last row, scrolled to the end, is never under it (round nine B6). A phone fades only 14px
          // (council round 7 B4): the line above the tab bar reads instead of fading out.
          className={cn(
            'dshx:min-h-32 dshx:flex-1 dshx:overflow-auto dshx:overscroll-y-contain dshx:px-2 dshx:pb-6 dshx:pointer-coarse:pb-3.5 dshx:phone:px-3 dshx:[mask-image:linear-gradient(to_bottom,#000_calc(100%-24px),transparent)] dshx:pointer-coarse:[mask-image:linear-gradient(to_bottom,#000_calc(100%-14px),transparent)]',
            // A selected row inside the fade zone switches the fade off (`ListFade`, round nine B6).
            'dshx:data-[fade-off]:[mask-image:none]',
            isBoard && 'dshx:p-4 dshx:[mask-image:none]',
          )}
          onKeyDown={event => {
            if (!isBoard) navigateThreadList(event.nativeEvent)
          }}
        >
          {isBoard ? null : (
            <HeldUpdatesPill
              count={heldUpdates}
              label={count => tSidebar('threadSidebarHeldUpdates', { count })}
              hint={tSidebar('threadSidebarHeldUpdatesHint')}
              onShow={showHeldUpdates}
            />
          )}
          {peekSession === undefined ? null : (
            <RowPeek anchor={peekAnchor} open onOpenChange={open => (open ? undefined : setPeekId(null))}>
              <PeekCard
                heading={peekSession.displayTitle}
                {...(peekStatus === undefined ? {} : { status: peekStatus.status })}
                reply={peekReply}
                {...(peekSignal?.choices === undefined
                  ? {}
                  : {
                      question: {
                        text: peekSignal.detail ?? peekSignal.reason,
                        choices: peekSignal.choices,
                        onAnswer: (choiceId: string) => {
                          void inbox.act(peekSignal.itemId, 'Answer', choiceId)
                          setPeekId(null)
                        },
                      },
                    })}
                facts={peekFacts}
                actions={
                  <>
                    <Button size="sm" variant="outline" onClick={() => openThread(peekSession.id)}>
                      {tSidebar('threadSidebarKeyOpen')}
                    </Button>
                    {/* The row's menu (its action sheet on a phone), one tap from the peek a long press opened. */}
                    <Button
                      size="sm"
                      variant="ghost"
                      data-peek-actions=""
                      onClick={() => {
                        setPeekId(null)
                        requestAnimationFrame(() =>
                          ThreadRowMenu.open(peekAnchor?.closest<HTMLElement>('article[data-thread-id]') ?? null, peekAnchor ?? document.body),
                        )
                      }}
                    >
                      {tSidebar('threadSidebarPeekActions')}
                    </Button>
                  </>
                }
                labels={{
                  lastReply: tSidebar('threadSidebarPeekLastReply'),
                  noReply: tSidebar('threadSidebarPeekNoReply'),
                  loading: tSidebar('threadSidebarPeekLoading'),
                  close: tSidebar('threadSidebarPeekClose'),
                }}
              />
            </RowPeek>
          )}
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
                <Button type="button" size="xs" variant="outline" disabled={resumeAllBusy} onClick={() => void resumeAllAttention(hoistedInterruptedRows)}>
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
                <Button type="button" size="xs" variant="outline" disabled={resumeAllBusy} onClick={() => void resumeAllAttention(hoistedNeedsResumeRows)}>
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
            onResumeAll={() => void resumeAllAttention(hoistedUsageLimitRows.map(row => row.session))}
            onSnooze={input => void changeUsageLimitRecovery(input)}
            open={openThread}
            selectedSessionId={selectedSessionId}
            resumeAllBusy={resumeAllBusy}
            rows={hoistedUsageLimitRows}
            translate={props.tSidebar}
            withThreadMenu={(session, row) => {
              const workspaceId =
                realWorkspaceBySession.get(session.id) ?? SidebarOrganization.workspaceForLineage(session, sessionState.byId, workspaceBySession)
              return (
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
                  workspaceId={workspaceId}
                  workspaceTitle={workspaceId === undefined ? undefined : workspaceTitleById.get(workspaceId)}
                  workspacePath={workspaceId === undefined ? undefined : workspacePathById.get(workspaceId)}
                  actions={rowActions}
                >
                  {row}
                </ThreadContextMenu>
              )
            }}
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
                        threads={filteredRemoteThreads}
                        headerClassName={stickyHeaderClass}
                        renderRow={renderRemoteThreadRow}
                        onOpen={props.openRemoteThreads}
                        hint={props.tSidebar('threadSidebarSectionReorderHint')}
                        keepEmpty
                        onHeaderRef={element => {
                          sectionHeaderRefs.current[index] = element
                        }}
                        onHeaderPointerDown={event => {
                          if (isBoard || event.button !== 0) return
                          sendDrag({ type: 'section.press', pointerId: event.pointerId, from: index, startY: event.clientY })
                        }}
                        onHeaderPointerMove={event => {
                          const gesture = drag.context.section
                          if (gesture === null || gesture.pointerId !== event.pointerId) return
                          if (gesture.centers === null) {
                            if (Math.abs(event.clientY - gesture.startY) < SECTION_DRAG_THRESHOLD_PX) return
                            event.currentTarget.setPointerCapture(event.pointerId)
                            sendDrag({ type: 'section.drag', pointerId: event.pointerId, centers: sectionHeaderCenters() })
                          }
                          event.preventDefault()
                          sendDrag({ type: 'section.move', pointerId: event.pointerId, position: event.clientY })
                        }}
                        onHeaderPointerUp={event => {
                          const gesture = drag.context.section
                          if (gesture === null || gesture.pointerId !== event.pointerId) return
                          sendDrag({ type: 'section.drop', pointerId: event.pointerId, position: event.clientY })
                        }}
                        onHeaderPointerCancel={() => sendDrag({ type: 'section.end' })}
                        onHeaderLostPointerCapture={() => {
                          if (drag.matches('section')) sendDrag({ type: 'section.end' })
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
                          if (dragActor.getSnapshot().context.suppressed === 'section') {
                            sendDrag({ type: 'suppression.consume' })
                            event.preventDefault()
                            return
                          }
                          props.openRemoteThreads?.()
                        }}
                        dragging={activeSectionDrag?.from === index}
                      />
                    )
                  }
                  const sectionRows = sectionThreadsBySection.get(section) ?? NO_GROUPED_THREADS
                  const collapsed = collapsedSections.includes(section)
                  return (
                    <section
                      className={cn(
                        'dshx:mt-1 dshx:rounded-md',
                        isBoard && 'dshx:flex dshx:min-h-[24rem] dshx:min-w-72 dshx:flex-1 dshx:flex-col dshx:bg-muted/45 dshx:p-1.5',
                        activeRowDrag !== null && activeRowDropSection === section && 'dshx:bg-accent/40 dshx:ring-1 dshx:ring-inset dshx:ring-ring/30',
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
                          activeRowDrag !== null && 'dshx:ring-1 dshx:ring-ring/20',
                          activeRowDropSection === section && 'dshx:bg-accent dshx:text-foreground dshx:ring-ring/50',
                          activeSectionDrag?.from === index && 'dshx:cursor-grabbing dshx:bg-accent dshx:opacity-70',
                        )}
                        aria-expanded={!collapsed}
                        onPointerDown={event => {
                          if (isBoard || event.button !== 0) return
                          sendDrag({ type: 'section.press', pointerId: event.pointerId, from: index, startY: event.clientY })
                        }}
                        onPointerMove={event => {
                          const gesture = drag.context.section
                          if (gesture === null || gesture.pointerId !== event.pointerId) return
                          if (gesture.centers === null) {
                            if (Math.abs(event.clientY - gesture.startY) < SECTION_DRAG_THRESHOLD_PX) return
                            event.currentTarget.setPointerCapture(event.pointerId)
                            sendDrag({ type: 'section.drag', pointerId: event.pointerId, centers: sectionHeaderCenters() })
                          }
                          event.preventDefault()
                          sendDrag({ type: 'section.move', pointerId: event.pointerId, position: event.clientY })
                        }}
                        onPointerUp={event => {
                          const gesture = drag.context.section
                          if (gesture === null || gesture.pointerId !== event.pointerId) return
                          sendDrag({ type: 'section.drop', pointerId: event.pointerId, position: event.clientY })
                        }}
                        onPointerCancel={() => sendDrag({ type: 'section.end' })}
                        onLostPointerCapture={() => {
                          if (drag.matches('section')) sendDrag({ type: 'section.end' })
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
                          if (dragActor.getSnapshot().context.suppressed === 'section') {
                            sendDrag({ type: 'suppression.consume' })
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
                        <GroupChevron open={!collapsed} last />
                      </button>
                      {!collapsed ? (
                        <VirtualThreadRows
                          entries={sectionRows}
                          keyOf={groupedThreadKey}
                          threadIdOf={groupedThreadId}
                          render={entry =>
                            entry.kind === 'local' ? renderThreadRow(entry.session, undefined, section) : renderRemoteThreadRow(entry.remote, section)
                          }
                          {...virtualRowsProps}
                        />
                      ) : null}
                    </section>
                  )
                })
              : groupedThreadEntries.map(group => {
                  // A flat list under a hoisted group (Usage limit, Interrupted…) gets its own header, so its rows do
                  // not read as part of the group above.
                  const showHeader = group.showHeader || (!isBoard && hasHoistedGroups)
                  const groupLabel =
                    group.label || (viewTabs.find(tab => tab.view.id === threadViewSettings.activeViewId)?.label ?? props.tSidebar('threadSidebarAllThreads'))
                  const groupCollapsed =
                    showHeader &&
                    (group.key.startsWith(STATUS_GROUP_KEY_PREFIX)
                      ? ThreadStatusModel.isCollapsed(group.key, collapsedGroups)
                      : collapsedGroups.includes(group.key))
                  const resumableSessions = statusGroupResumableSessions.get(group.key) ?? []
                  // The Needs you group's count chips take their status hue (round five T2): needs you, then failed.
                  const statusCounts =
                    group.key === `${STATUS_GROUP_KEY_PREFIX}needs-you`
                      ? group.threads.reduce(
                          (counts, thread) => {
                            const status = thread.kind === 'local' ? threadStatusById.get(thread.session.id)?.status : undefined
                            if (status === 'failed') return { ...counts, failed: counts.failed + 1 }
                            return status === 'needs-you' ? { ...counts, needsYou: counts.needsYou + 1 } : counts
                          },
                          { needsYou: 0, failed: 0 },
                        )
                      : undefined
                  // Working, Ready, Idle, Done and Drafts count beside their 10px status glyph (council round 15 B2, round 16 B2).
                  const groupStatus = group.key.startsWith(STATUS_GROUP_KEY_PREFIX) ? groupCountStatusOf(group.key.slice(STATUS_GROUP_KEY_PREFIX.length)) : undefined
                  return (
                    <section
                      className={cn(
                        // Groups stand 12px apart in the list (council round 13 B3; 20px read as loose islands): the last
                        // row's 6px gap and this 6px; on a phone the last row's
                        // gap alone, and none above the first, so the first Ready row shows above the tab bar under the 44px
                        // search (round five B1, council round 6 B8).
                        'dshx:mt-1 dshx:rounded-md',
                        !isBoard && 'dshx:not-pointer-coarse:not-first:mt-1.5 dshx:pointer-coarse:not-first:mt-0 dshx:pointer-coarse:first:mt-0',
                        isBoard && 'dshx:flex dshx:min-h-[24rem] dshx:min-w-72 dshx:flex-1 dshx:flex-col dshx:bg-muted/45 dshx:p-1.5',
                      )}
                      key={group.key}
                      data-thread-board-column={isBoard ? group.key : undefined}
                      aria-label={isBoard ? `${group.label || props.tSidebar('threadSidebarAllThreads')} column` : showHeader ? groupLabel : undefined}
                    >
                      {showHeader ? (
                        <ThreadGroupHeader
                          icon={
                            group.projectId === undefined
                              ? undefined
                              : (() => {
                                  const projectPath = workspacePathById.get(group.projectId)
                                  return projectPath === undefined ? undefined : <ProjectIcon path={projectPath} label={groupLabel} />
                                })()
                          }
                          checkoutCount={group.checkoutCount}
                          {...(statusCounts === undefined ? {} : { statusCounts })}
                          {...(groupStatus === undefined ? {} : { status: groupStatus })}
                          label={groupLabel}
                          count={group.threads.length}
                          collapsed={groupCollapsed}
                          projectId={group.projectId}
                          className={stickyHeaderClass}
                          onToggle={() => toggleGroup(group.key)}
                          startProjectSession={props.startProjectSession}
                          t={props.tSidebar}
                          action={
                            resumableSessions.length === 0 ? undefined : (
                              <Button
                                type="button"
                                size="xs"
                                variant="outline"
                                disabled={resumeAllBusy}
                                onClick={() => void resumeAllAttention(resumableSessions)}
                              >
                                {resumeAllBusy ? <Spinner className="dshx:size-3" /> : null}
                                {props.tSidebar('threadSidebarResumeAll')}
                              </Button>
                            )
                          }
                        />
                      ) : null}
                      {groupCollapsed ? null : (
                        <VirtualThreadRows
                          entries={group.threads}
                          keyOf={groupedThreadKey}
                          threadIdOf={groupedThreadId}
                          render={entry => (entry.kind === 'local' ? renderThreadRow(entry.session, undefined) : renderRemoteThreadRow(entry.remote))}
                          {...virtualRowsProps}
                        />
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
                        {branchAction === 'restore' ? <ArchiveRestoreIcon strokeWidth={1.5} size={13} /> : <ArchiveIcon strokeWidth={1.5} size={13} />}
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
              threads={filteredRemoteThreads}
              renderRow={renderRemoteThreadRow}
              headerClassName={stickyHeaderClass}
              onOpen={props.openRemoteThreads}
            />
          ) : null}
          {isBoard || draftSessions.length === 0 ? null : (
            <DraftsSection
              key="drafts"
              drafts={draftSessions}
              open={draftsOpen}
              onOpenChange={setDraftsOpen}
              cleanable={draftsCleanable}
              cleaning={draftsCleaning}
              onConfirm={ids => void cleanUpDrafts(ids)}
              renderRow={session => renderThreadRow(session, undefined)}
              headerClassName={stickyHeaderClass}
              t={props.tSidebar}
            />
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
          <ThreadSelectionBar
            count={selectedSessionIds.length}
            allPinned={allSelectedPinned}
            allSettled={allSelectedSettled}
            onTogglePinned={() => void applyToSelection(allSelectedPinned ? 'unpin' : 'pin')}
            onSettle={settleSelection}
            onArchive={() => void applyToSelection('archive')}
            onClear={() => setThreadSelection(EMPTY_THREAD_SELECTION)}
            t={props.tSidebar}
          />
        ) : null}
      </section>
      <ThreadViewManager
        onOpenChange={setViewsManagerOpen}
        onSettingsChange={saveThreadViewSettings}
        open={viewsManagerOpen}
        settings={threadViewSettings}
        t={props.tSidebar}
      />
      <PresetNameDialog
        prompt={presetPrompt}
        existingNames={threadViewSettings.views
          .filter(view => presetPrompt?.mode !== 'rename' || view.id !== presetPrompt.viewId)
          .map(view => threadViewPresetLabel(view, props.tSidebar))}
        onSubmit={submitPresetName}
        onClose={() => setPresetPrompt(null)}
        t={props.tSidebar}
      />
      <PresetDeleteDialog preset={presetToDelete} onConfirm={deletePreset} onClose={() => setPresetToDelete(null)} t={props.tSidebar} />
    </TooltipProvider>
  )
}
