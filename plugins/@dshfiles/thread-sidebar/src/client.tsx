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
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
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
import { ActivityIcon, BellIcon, BellOffIcon, ChevronDownIcon, ChevronUpIcon, CirclePauseIcon, LinkIcon, MonitorIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { memo, useEffect, useId, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import {
  isAutoArchiveCandidate,
  isAttentionSessionIncluded,
  nextIdleTransitionAt,
  parseSessionIds,
  sessionLineage,
  sectionForSession,
  type AttentionColor,
  type AttentionColorKey,
  type AttentionColors,
  type SessionActivity,
  type SidebarPreferences,
  type SidebarSection,
  type ThreadRowDensity,
  workspaceForLineage,
} from './organization.js'
import { attentionColorDotClass, attentionDotClass, attentionLabelClass, type ThreadAttentionLabel } from './attention-presentation.js'
import { attentionColorSchema, toggleCollapsedSection } from './preferences.js'
import { registerPaletteAction, setPaletteRecentLimit, type PaletteAction } from '@dshfiles/command-palette/api'
import { useSidebarState } from './sidebar-state.js'
import { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'
import { projectTextTone } from './project-tone.js'
import { scheduleSuccessNoticeDismissal, SidebarNoticeMessage, type SidebarNotice } from './sidebar-notice.js'
import { threadSidebarMachineApi } from './machine-api.js'
import { groupThreadChildren, threadActionTargetIds, visibleChildren } from './thread-children.js'
import { buildThreadUrl, clearThreadUrl, readThreadUrl } from './thread-url.js'
import { captureThreadMentionInsertion, requestThreadMentionInsertion } from './thread-mention.js'
import {
  clearExpiredThreadMutes,
  clearThreadMute,
  DEFAULT_THREAD_NOTIFICATION_PREFERENCES,
  isThreadMuted,
  markThreadSeen,
  setThreadMute,
  snoozeDurations,
  threadAttentionTransitions,
  threadNotificationPreferences,
  type ThreadAttentionStatus,
} from './thread-notifications.js'

type InjectedActions = {
  archiveSession: (sessionId: SessionSummary['id']) => Promise<void>
  unarchiveSession: (sessionId: SessionSummary['id']) => Promise<void>
  pinSession: (sessionId: SessionSummary['id']) => Promise<void>
  unpinSession: (sessionId: SessionSummary['id']) => Promise<void>
  markRead: (sessionId: SessionSummary['id']) => Promise<boolean>
}

type ThreadSidebarProps = Pick<WorkspaceBrowserProps, 'open' | 'useSessions' | 'useSessionStatus' | 'useWorkspaces'> &
  InjectedActions & {
    tSidebar: TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>
  }

type ThreadSidebarTranslate = ThreadSidebarProps['tSidebar']
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

const attentionColorLabelKeys = {
  muted: 'threadSidebarColorMuted',
  primary: 'threadSidebarColorPrimary',
  info: 'threadSidebarColorInfo',
  success: 'threadSidebarColorSuccess',
  warning: 'threadSidebarColorWarning',
  danger: 'threadSidebarColorDanger',
} satisfies Record<AttentionColor, Parameters<ThreadSidebarTranslate>[0]>

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
  readonly setNotificationMute: (sessionId: SessionSummary['id'], mutedUntil: number | null) => void
  readonly clearNotificationMute: (sessionId: SessionSummary['id']) => void
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
  readonly archived: boolean
  readonly pinned: boolean
  readonly parked: boolean
  readonly selected: boolean
  readonly parentTitle: string | undefined
  readonly workspaceId: string | undefined
  readonly workspaceTitle: string | undefined
  readonly machine: string | undefined
  readonly age: string
  readonly muted: boolean
  readonly attentionLabel: ThreadAttentionLabel | undefined
  readonly childAttentionLabels: ReadonlyMap<SessionSummary['id'], ThreadAttentionLabel>
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

const StatusDot = (props: {
  readonly session: SessionSummary
  readonly unreadLabel: string
  readonly attentionLabel: ThreadAttentionLabel | undefined
  readonly attentionColors: AttentionColors
}): JSX.Element => {
  const unread = Boolean(props.session.attention?.unread)
  const dotClass = attentionDotClass({ attentionLabel: props.attentionLabel, attentionColors: props.attentionColors, unread, running: props.session.running })
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
  readonly allShown: boolean
  readonly selectedChildId: SessionSummary['id'] | undefined
  readonly attentionLabels: ReadonlyMap<SessionSummary['id'], ThreadAttentionLabel>
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
      {shown.map(child => {
        const attentionLabel = props.attentionLabels.get(child.id)
        return (
          <li key={child.id}>
            <button
              type="button"
              className={cn(lineClass, 'dshx:data-[selected=true]:bg-accent')}
              data-selected={child.id === props.selectedChildId}
              title={new Date(child.updatedAt).toLocaleString()}
              onClick={() => props.actions.open(child.id)}
            >
              <StatusDot
                session={child}
                unreadLabel={t('threadSidebarUnread')}
                attentionLabel={attentionLabel}
                attentionColors={props.rowStyle.attentionColors}
              />
              <span className={cn('dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-foreground', child.attention?.unread && 'dshx:font-semibold')}>
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
      })}
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
        <article className="dshx:group/row dshx:relative dshx:min-w-0" data-selected={props.selected} onContextMenu={captureThreadMentionInsertion}>
          <div className="dshx:relative dshx:rounded-md dshx:hover:bg-accent/60 dshx:focus-within:bg-accent/60 dshx:group-data-[selected=true]/row:bg-accent">
            <button
              type="button"
              className={cn(
                'dshx:flex dshx:w-full dshx:min-w-0 dshx:flex-col dshx:rounded-md dshx:text-left dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/50 dshx:disabled:cursor-default',
                compact ? 'dshx:gap-0.5 dshx:px-2 dshx:py-1.5' : 'dshx:gap-1 dshx:px-2.5 dshx:py-2.5',
              )}
              title={new Date(session.updatedAt).toLocaleString()}
              onClick={() => props.actions.open(session.id)}
            >
              {headLine ? (
                <span className="dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-2">
                  {rowStyle.statusDot ? (
                    <StatusDot
                      session={session}
                      unreadLabel={t('threadSidebarUnread')}
                      attentionLabel={props.attentionLabel}
                      attentionColors={rowStyle.attentionColors}
                    />
                  ) : null}
                  <span
                    className={cn(
                      'dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-foreground',
                      compact ? 'dshx:text-sm' : 'dshx:text-base',
                      unread && 'dshx:font-semibold',
                    )}
                  >
                    {rowStyle.title ? session.displayTitle : null}
                  </span>
                  {props.muted ? (
                    <BellOffIcon className="dshx:size-3 dshx:shrink-0 dshx:text-muted-foreground" aria-label={t('threadSidebarNotificationsMuted')} />
                  ) : null}
                  {props.attentionLabel === undefined ? null : (
                    <span className={cn('dshx:shrink-0 dshx:text-xs dshx:font-medium', attentionLabelClass(props.attentionLabel, rowStyle.attentionColors))}>
                      {t(props.attentionLabel)}
                    </span>
                  )}
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
                            unread: Boolean(child.attention?.unread),
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
                    t(props.muted ? 'threadSidebarNotificationsMuted' : 'threadSidebarNotifications'),
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-xs" aria-label={t(props.muted ? 'threadSidebarNotificationsMuted' : 'threadSidebarNotifications')}>
                          {props.muted ? <BellOffIcon className="dshx:size-3.5" /> : <BellIcon className="dshx:size-3.5" />}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="dshx-root dshx:min-w-44" aria-label={t('threadSidebarNotifications')}>
                        {snoozeDurations.map(duration => (
                          <DropdownMenuItem
                            key={duration.milliseconds}
                            onSelect={() => props.actions.setNotificationMute(session.id, Date.now() + duration.milliseconds)}
                          >
                            {t('threadSidebarSnoozeFor')} {t(duration.label)}
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuItem onSelect={() => props.actions.setNotificationMute(session.id, null)}>
                          {t('threadSidebarMuteUntilEnabled')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={!props.muted} onSelect={() => props.actions.clearNotificationMute(session.id)}>
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
        <ContextMenuSub>
          <ContextMenuSubTrigger>{t('threadSidebarNotifications')}</ContextMenuSubTrigger>
          <ContextMenuSubContent className="dshx-root dshx:min-w-44">
            {snoozeDurations.map(duration => (
              <ContextMenuItem key={duration.milliseconds} onSelect={() => props.actions.setNotificationMute(session.id, Date.now() + duration.milliseconds)}>
                {t('threadSidebarSnoozeFor')} {t(duration.label)}
              </ContextMenuItem>
            ))}
            <ContextMenuItem onSelect={() => props.actions.setNotificationMute(session.id, null)}>{t('threadSidebarMuteUntilEnabled')}</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={!props.muted} onSelect={() => props.actions.clearNotificationMute(session.id)}>
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

export const ThreadSidebar = (props: ThreadSidebarProps): JSX.Element => {
  const sessionState = props.useSessions(state => state)
  const sessionStatus = props.useSessionStatus(state => state)
  const workspaceState = props.useWorkspaces(state => state)
  const { preferences, updatePreferences, storageWarning, setSelectedThreadId, threadTitle } = useSidebarState()
  const notificationPreferences = threadNotificationPreferences.useValue() ?? DEFAULT_THREAD_NOTIFICATION_PREFERENCES
  const machine = useApiQuery(threadSidebarMachineApi, 'name', { enabled: preferences.threadRowMachine }).data?.name
  const [closedParents, setClosedParents] = useState<ReadonlySet<string>>(() => new Set())
  const [expandedParents, setExpandedParents] = useState<ReadonlySet<string>>(() => new Set())
  const [settingsOpen, setSettingsOpen] = useState(false)
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
  const readMarkAttempts = useRef(new Map<SessionSummary['id'], number>())
  const previousStatus = useRef<Readonly<Record<string, ThreadAttentionStatus>> | null>(null)
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
  const parkedSessionIds = useMemo(() => setIncludes(preferences.parkedSessionIds), [preferences.parkedSessionIds])
  const selectedSession = useMemo(() => sessions.find(session => (session.retainedBy.mainView ?? 0) > 0), [sessions])
  const attentionSessions = useMemo(
    () => sessions.filter(session => isAttentionSessionIncluded(session, preferences.includeSubagentAttention)),
    [preferences.includeSubagentAttention, sessions],
  )

  useEffect(() => setSelectedThreadId(selectedSession?.id ?? null), [selectedSession?.id, setSelectedThreadId])
  useEffect(() => {
    if (selectedSession === undefined) return
    const current = threadNotificationPreferences.get() ?? DEFAULT_THREAD_NOTIFICATION_PREFERENCES
    threadNotificationPreferences.set(markThreadSeen(current, selectedSession.id))
  }, [selectedSession?.id])
  threadTitle.current = sessionId => sessionState.byId[sessionId]?.displayTitle

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
    return groupThreadChildren({ threads: listed })
  }, [preferences.workspaceFilter, sessionState.byId, sessionState.ids, workspaceBySession])

  const rootThreadIds = useMemo(() => new Set(threadTree.roots.map(session => session.id)), [threadTree.roots])
  const sectionEntries = useMemo(
    () =>
      threadTree.roots.map(session => ({
        session,
        activity: {
          id: session.id,
          updatedAt: session.updatedAt,
          // A parent waiting on a running subagent is still active work.
          running: session.running || (threadTree.childrenByRoot.get(session.id) ?? NO_CHILDREN).some(child => child.running),
        },
      })),
    [threadTree],
  )
  const nextMuteExpiry = useMemo(
    () =>
      Object.values(notificationPreferences.mutedUntil)
        .flatMap(until => (until !== null && until > now ? [until] : []))
        .sort((left, right) => left - right)[0] ?? null,
    [notificationPreferences.mutedUntil, now],
  )
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
    const nextBoundary = [nextIdleAt, nextMuteExpiry].filter((value): value is number => value !== null).sort((left, right) => left - right)[0]
    if (nextBoundary === undefined) return
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, nextBoundary - Date.now() + 1))
    return () => window.clearTimeout(timer)
  }, [nextIdleAt, nextMuteExpiry])

  const needsInputRows = useMemo(
    () =>
      attentionSessions
        .filter(session => {
          const kind = sessionStatus.get(session.id)?.pendingInteraction?.kind
          return (
            !session.blank &&
            session.id !== selectedSession?.id &&
            kind === 'question' &&
            !archivedSessionIds.has(session.id) &&
            (preferences.workspaceFilter === null ||
              (workspaceForLineage(session, sessionState.byId, workspaceBySession) ?? '') === preferences.workspaceFilter)
          )
        })
        .sort((left, right) => right.updatedAt - left.updatedAt),
    [archivedSessionIds, attentionSessions, preferences.workspaceFilter, selectedSession?.id, sessionState.byId, sessionStatus, workspaceBySession],
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
            !archivedSessionIds.has(session.id) &&
            (preferences.workspaceFilter === null ||
              (workspaceForLineage(session, sessionState.byId, workspaceBySession) ?? '') === preferences.workspaceFilter)
          )
        })
        .sort((left, right) => right.updatedAt - left.updatedAt),
    [archivedSessionIds, attentionSessions, preferences.workspaceFilter, selectedSession?.id, sessionState.byId, sessionStatus, workspaceBySession],
  )
  const approvalNeededIds = useMemo(() => new Set(approvalNeededRows.map(session => session.id)), [approvalNeededRows])
  const turnFinishedRows = useMemo(
    () =>
      attentionSessions
        .filter(
          session =>
            !session.running &&
            !session.blank &&
            session.id !== selectedSession?.id &&
            !needsInputIds.has(session.id) &&
            !approvalNeededIds.has(session.id) &&
            notificationPreferences.needsYouAt[session.id] !== undefined &&
            !archivedSessionIds.has(session.id) &&
            (preferences.workspaceFilter === null ||
              (workspaceForLineage(session, sessionState.byId, workspaceBySession) ?? '') === preferences.workspaceFilter),
        )
        .sort((left, right) => (notificationPreferences.needsYouAt[right.id] ?? 0) - (notificationPreferences.needsYouAt[left.id] ?? 0)),
    [
      approvalNeededIds,
      archivedSessionIds,
      attentionSessions,
      needsInputIds,
      notificationPreferences.needsYouAt,
      preferences.workspaceFilter,
      selectedSession?.id,
      sessionState.byId,
      workspaceBySession,
    ],
  )
  const groupedAttentionRows = useMemo(
    () => ({
      approvalNeeded: preferences.approvalNeededDisplay === 'group' ? approvalNeededRows.filter(session => rootThreadIds.has(session.id)) : [],
      inputNeeded: preferences.inputNeededDisplay === 'group' ? needsInputRows.filter(session => rootThreadIds.has(session.id)) : [],
      turnFinished: preferences.turnFinishedDisplay === 'group' ? turnFinishedRows.filter(session => rootThreadIds.has(session.id)) : [],
    }),
    [
      approvalNeededRows,
      needsInputRows,
      preferences.approvalNeededDisplay,
      preferences.inputNeededDisplay,
      preferences.turnFinishedDisplay,
      rootThreadIds,
      turnFinishedRows,
    ],
  )
  const attentionIds = useMemo(
    () =>
      new Set([...groupedAttentionRows.approvalNeeded, ...groupedAttentionRows.inputNeeded, ...groupedAttentionRows.turnFinished].map(session => session.id)),
    [groupedAttentionRows],
  )
  const inlineAttentionLabels = useMemo(() => {
    const labels = new Map<SessionSummary['id'], ThreadAttentionLabel>()
    if (preferences.approvalNeededDisplay === 'label') {
      for (const session of approvalNeededRows) labels.set(session.id, 'threadSidebarApprovalNeeded')
    }
    if (preferences.inputNeededDisplay === 'label') {
      for (const session of needsInputRows) labels.set(session.id, 'threadSidebarInputNeeded')
    }
    if (preferences.turnFinishedDisplay === 'label') {
      for (const session of turnFinishedRows) labels.set(session.id, 'threadSidebarTurnFinished')
    }
    return labels
  }, [approvalNeededRows, needsInputRows, preferences.approvalNeededDisplay, preferences.inputNeededDisplay, preferences.turnFinishedDisplay, turnFinishedRows])

  const rowsBySection = useMemo(() => {
    const rows = new Map<SidebarSection, SessionSummary[]>(sections.map(section => [section, []]))
    for (const { session, activity } of sectionEntries) {
      if (attentionIds.has(session.id)) continue
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
    for (const entries of rows.values()) entries.sort((left, right) => right.updatedAt - left.updatedAt)
    rows.set(
      'pinned',
      rows.get('pinned')?.sort((left, right) => workspaceState.pinnedSessionIds.indexOf(left.id) - workspaceState.pinnedSessionIds.indexOf(right.id)) ?? [],
    )
    return rows
  }, [archivedSessionIds, attentionIds, now, parkedSessionIds, pinnedSessionIds, preferences.idleMinutes, sectionEntries, workspaceState.pinnedSessionIds])

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

  const latestRowActions = useRef({ openThread, mutateSession, toggleParked, copyContextValue, props, sessionsById: sessionState.byId })
  latestRowActions.current = { openThread, mutateSession, toggleParked, copyContextValue, props, sessionsById: sessionState.byId }
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
      toggleChildren: sessionId => setClosedParents(current => toggleSetMember(current, sessionId)),
      toggleAllChildren: sessionId => setExpandedParents(current => toggleSetMember(current, sessionId)),
      setNotificationMute: (sessionId, mutedUntil) => {
        const current = threadNotificationPreferences.get() ?? DEFAULT_THREAD_NOTIFICATION_PREFERENCES
        threadNotificationPreferences.set(setThreadMute(current, sessionId, mutedUntil))
      },
      clearNotificationMute: sessionId => {
        const current = threadNotificationPreferences.get() ?? DEFAULT_THREAD_NOTIFICATION_PREFERENCES
        threadNotificationPreferences.set(clearThreadMute(current, sessionId))
      },
      translate: (...args) => latestRowActions.current.props.tSidebar(...args),
    }
  }, [])

  const renderThreadRow = (session: SessionSummary, attentionLabel: ThreadRowProps['attentionLabel']): JSX.Element => {
    const lineage = sessionLineage(session, sessionState.byId)
    const workspaceId = workspaceForLineage(session, sessionState.byId, workspaceBySession)
    const childThreads = (threadTree.childrenByRoot.get(session.id) ?? NO_CHILDREN).filter(
      child => !attentionIds.has(child.id) && (threadListView === 'all' || currentWorkingThreadIds.has(child.id)),
    )
    const selectedChildId = childThreads.some(child => child.id === selectedSession?.id) ? selectedSession?.id : undefined
    const rowAttentionLabel = attentionLabel ?? inlineAttentionLabels.get(session.id)
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
        muted={isThreadMuted(notificationPreferences, session.id, now)}
        attentionLabel={rowAttentionLabel}
        childAttentionLabels={inlineAttentionLabels}
        rowStyle={rowStyle}
        childThreads={childThreads}
        childrenOpen={!closedParents.has(session.id)}
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
    const stored = threadNotificationPreferences.get() ?? DEFAULT_THREAD_NOTIFICATION_PREFERENCES
    const current = clearExpiredThreadMutes(stored, now)
    const needsYouAt = { ...current.needsYouAt }
    let changed = Object.keys(current.mutedUntil).length !== Object.keys(stored.mutedUntil).length
    for (const { sessionId, status } of currentStatusEntries) {
      const session = sessionState.byId[sessionId]
      if (
        !status.completionUnread ||
        needsYouAt[sessionId] !== undefined ||
        session === undefined ||
        !isAttentionSessionIncluded(session, preferences.includeSubagentAttention)
      ) {
        continue
      }
      needsYouAt[sessionId] = now
      changed = true
    }
    const notifyThread = (sessionId: SessionSummary['id'], title: string, fallbackBody: string): void => {
      if (!current.enabled || isThreadMuted(current, sessionId, now) || !('Notification' in window) || window.Notification.permission !== 'granted') return
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
    if (changed) threadNotificationPreferences.set({ ...current, needsYouAt })
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

  return (
    <TooltipProvider delayDuration={500}>
      <section
        className="dshx-root dshx:flex dshx:h-full dshx:w-full dshx:min-h-0 dshx:min-w-0 dshx:flex-col"
        aria-label={props.tSidebar('threadSidebarTitle')}
      >
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
            <Label className="dshx:font-normal dshx:leading-snug">
              <Checkbox
                checked={preferences.applyActionsToChildThreads}
                onCheckedChange={checked => changePreferences({ applyActionsToChildThreads: checked === true })}
              />
              {props.tSidebar('threadSidebarApplyActionsToChildren')}
            </Label>
            <p className="dshx:text-xs dshx:text-muted-foreground">{props.tSidebar('threadSidebarApplyActionsToChildrenHint')}</p>
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

        {notice !== null || storageWarning ? (
          <div className="dshx:grid dshx:gap-2 dshx:px-2 dshx:pb-2">
            {notice !== null ? (
              <Alert variant={notice.tone === 'danger' ? 'destructive' : notice.tone} className={noticeClass}>
                <div className="dshx:flex dshx:items-center dshx:gap-2">
                  <SidebarNoticeMessage message={notice.message} />
                  {notice.actionLabel !== undefined && notice.onAction !== undefined ? (
                    <Button size="sm" variant="ghost" className="dshx:h-6 dshx:px-1.5 dshx:text-xs" onClick={notice.onAction}>
                      {notice.actionLabel}
                    </Button>
                  ) : null}
                </div>
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
          {sections.map(section => {
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
          })}
          {sessionState.phase === 'ready' &&
          groupedAttentionRows.approvalNeeded.length === 0 &&
          groupedAttentionRows.inputNeeded.length === 0 &&
          groupedAttentionRows.turnFinished.length === 0 &&
          [...rowsBySection.values()].every(rows => rows.length === 0) ? (
            <Empty className="dshx:gap-2 dshx:p-6 dshx:md:p-6">
              <EmptyTitle className="dshx:text-sm dshx:font-normal dshx:text-muted-foreground">
                {props.tSidebar('threadSidebarEmpty')}
              </EmptyTitle>
            </Empty>
          ) : null}
        </div>
      </section>
    </TooltipProvider>
  )
}
