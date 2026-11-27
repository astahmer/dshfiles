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
import {
  AppWindowIcon,
  BellOffIcon,
  CircleDashedIcon,
  DownloadIcon,
  EllipsisIcon,
  FileTextIcon,
  PinOffIcon,
  PlayIcon,
  RotateCcwIcon,
  SendIcon,
} from '@dshfiles/plugin-ui/icons'
import { ThreadToolsModel } from '@dshfiles/chat/thread-tools'
import { ThreadViewsModel, type ThreadHeaderMenu, type ThreadHeaderMenuAction } from '@dshfiles/rich-composer/thread-views'
import { PanelRightIcon } from '@dshfiles/plugin-ui/icons'
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { ThreadDirectories } from '@dshfiles/vcs-provider-port/workspace-attribution'
import { ThreadMuteModel, THREAD_MUTE_OPTIONS, type ThreadMuteOption } from './thread-mute.js'
import { ThreadChildrenModel } from './thread-children.js'
import { usePreferences } from './sidebar-state.js'
import { THREAD_SIDEBAR_LOCALE_NAMESPACE, type ThreadSidebarLocaleKey } from './locales.js'
import { SidebarOrganization } from './organization.js'
import { ThreadUrlModel } from './thread-url.js'
import { ThreadReferencesItems } from './thread-references-menu.js'
import { ContinueInProjectItems } from './continue-in-menu.js'
import { SettledThreadsModel } from './settled-threads.js'
import { useStableValue } from './stable-value.js'
import { useRegistry } from '@dshfiles/dshx/client'
import { ThreadMenuSections } from './thread-menu-sections.js'
import { PhoneLayout } from './phone-layout.js'
import { ThreadMenu, type ThreadMenuEntries, type ThreadMenuKit } from './thread-menu.js'

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

/** The thread menu's own icon for each action the Host's header menu is known to carry; any other gets a neutral mark. */
const NATIVE_ACTION_ICONS = {
  'session-log-download.copy': FileTextIcon,
  'session-log-download.download': DownloadIcon,
  'session-log-download.feedback': SendIcon,
  'open-in-app.application': AppWindowIcon,
} as const

const isKnownNativeIcon = (key: string | undefined): key is keyof typeof NATIVE_ACTION_ICONS => key !== undefined && Object.hasOwn(NATIVE_ACTION_ICONS, key)

/** Thread wording for the Host's two exports (its own labels say Session); any other action keeps its plugin's label. */
const NATIVE_ACTION_LABELS = {
  'session-log-download.copy': 'threadSidebarCopyAsMarkdown',
  'session-log-download.download': 'threadSidebarDownloadLog',
} as const satisfies Readonly<Record<string, ThreadSidebarLocaleKey>>

const nativeActionLabelKey = (iconKey: string | undefined): (typeof NATIVE_ACTION_LABELS)[keyof typeof NATIVE_ACTION_LABELS] | undefined =>
  iconKey === 'session-log-download.copy' || iconKey === 'session-log-download.download' ? NATIVE_ACTION_LABELS[iconKey] : undefined

const NativeActionIcon = (props: { readonly action: ThreadHeaderMenuAction }): JSX.Element => {
  if (props.action.iconSrc !== undefined) return <img src={props.action.iconSrc} alt="" className="dshx:size-4 dshx:shrink-0 dshx:rounded-sm" />
  const Icon = isKnownNativeIcon(props.action.iconKey) ? NATIVE_ACTION_ICONS[props.action.iconKey] : CircleDashedIcon
  return <Icon aria-hidden="true" />
}

const NO_NATIVE_ACTIONS: readonly ThreadHeaderMenuAction[] = []
const noSubscription = (): (() => void) => () => undefined
const noNativeActions = (): readonly ThreadHeaderMenuAction[] => NO_NATIVE_ACTIONS

/**
 * The thread header's own More actions (Copy as Markdown, Download log, Open in…, Feedback: what native DSH plugins
 * register for the header menu), listed in this menu so the header has one `⋯`. Read inside the open menu: it resolves
 * them when the menu opens and lets go when it closes.
 */
const useNativeHeaderMenu = (sessionId: string) => {
  const [menu, setMenu] = useState<ThreadHeaderMenu | undefined>(undefined)
  useEffect(() => {
    const resolved = ThreadViewsModel.headerMenu(sessionId)
    setMenu(resolved)
    return () => resolved?.dispose()
  }, [sessionId])
  const actions = useSyncExternalStore(menu?.subscribe ?? noSubscription, menu?.actions ?? noNativeActions, noNativeActions)
  return { menu, actions }
}

/** Where a native action sits in the thread menu: its Markdown copy under Copy, its application list under Open in. */
const nativeActionPlace = (action: ThreadHeaderMenuAction): 'copy-markdown' | 'native-open-in' | 'native-actions' => {
  if (action.iconKey === 'session-log-download.copy') return 'copy-markdown'
  if (action.iconKey === 'open-in-app.application' || (action.children ?? []).some(child => child.iconKey === 'open-in-app.application'))
    return 'native-open-in'
  return 'native-actions'
}

const NativeHeaderMenuRows = (props: {
  readonly menu: ThreadHeaderMenu
  readonly actions: readonly ThreadHeaderMenuAction[]
  readonly t: HeaderThreadActionsProps['t']
}): JSX.Element => {
  const row = (action: ThreadHeaderMenuAction): JSX.Element => {
    const labelKey = nativeActionLabelKey(action.iconKey)
    const label = labelKey === undefined ? action.label : props.t(labelKey)
    if (action.children !== undefined && action.children.length > 0) {
      return (
        <DropdownMenuSub key={action.id}>
          <DropdownMenuSubTrigger disabled={action.disabled === true}>
            <NativeActionIcon action={action} />
            {label}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="dshx-root dshx:min-w-44 dshx:max-w-72" aria-label={label}>
            {action.children.map(row)}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )
    }
    return (
      <DropdownMenuItem key={action.id} disabled={action.disabled === true} onSelect={() => props.menu.select(action.id)}>
        <NativeActionIcon action={action} />
        {label}
      </DropdownMenuItem>
    )
  }
  return <>{props.actions.map(row)}</>
}

/** Submenu content sized like the menu's own submenus. */
const SectionSubContent = (props: { readonly 'aria-label'?: string; readonly children?: ReactNode }): JSX.Element => (
  <DropdownMenuSubContent className="dshx-root dshx:min-w-56 dshx:max-w-72" aria-label={props['aria-label']}>
    {props.children}
  </DropdownMenuSubContent>
)

/** Sections other plugins add (b:ysaj: Linked backlog items), each with this menu's own parts. */
const RegisteredThreadMenuSections = (props: { readonly sessionId: string }): JSX.Element | null => {
  const sections = useRegistry(ThreadMenuSections)
  if (sections.length === 0) return null
  return (
    <>
      {[...sections]
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0))
        .map(section => (
          <section.Component
            key={section.id}
            sessionId={props.sessionId}
            Item={DropdownMenuItem}
            Sub={DropdownMenuSub}
            SubTrigger={DropdownMenuSubTrigger}
            SubContent={SectionSubContent}
          />
        ))}
    </>
  )
}

/** The header's menu parts, for the shared thread menu. */
const DROPDOWN_MENU_KIT: ThreadMenuKit = {
  Item: DropdownMenuItem,
  Sub: DropdownMenuSub,
  SubTrigger: DropdownMenuSubTrigger,
  SubContent: DropdownMenuSubContent,
  Separator: DropdownMenuSeparator,
}

interface HeaderMenuBodyProps {
  readonly sessionId: SessionSummary['id']
  readonly t: HeaderThreadActionsProps['t']
  readonly openThread: HeaderThreadActionsInjected['openThread']
  readonly state: {
    readonly archived: boolean
    readonly pinned: boolean
    readonly parked: boolean
    readonly settled: boolean
    readonly muted: boolean
    readonly running: boolean
    readonly settleDisabled: boolean
    readonly archiveDisabled: boolean
  }
  readonly run: {
    readonly togglePinned: () => void
    readonly updateParked: () => void
    readonly updateSettled: () => void
    readonly mute: (option: ThreadMuteOption) => void
    readonly unmute: () => void
    readonly continueIn: (projectId: string) => void
    readonly archive: () => void
    readonly restore: () => void
    readonly copyId: () => void
    readonly copyLink: () => void
  }
}

/**
 * The open thread's menu: the same layout as the thread's row menu in the list (`thread-menu-model.ts`), filled with
 * what the header can run. Find in thread leads it, because on a phone this menu is the way in (no ⌘F, no rail).
 * Mounted while the menu is open, so the native header actions resolve then.
 */
const HeaderMenuBody = ({ sessionId, t, openThread, state, run }: HeaderMenuBodyProps): JSX.Element => {
  // Trajectory, Traces, Requests: thread-panel facets since productivity pass Q5 (E5); this menu opens them.
  const threadViews = useSyncExternalStore(ThreadViewsModel.subscribe, ThreadViewsModel.list, ThreadViewsModel.list)
  const native = useNativeHeaderMenu(sessionId)
  const sections = useRegistry(ThreadMenuSections)
  const nativeRows = (place: ReturnType<typeof nativeActionPlace>): ThreadMenuEntries => {
    const menu = native.menu
    const placed = native.actions.filter(action => nativeActionPlace(action) === place)
    // The Host's own "Open in" is a submenu of applications; inside this menu's Open in they are rows of it.
    const actions = place === 'native-open-in' ? placed.flatMap(action => action.children ?? [action]) : placed
    return menu === undefined || actions.length === 0 ? {} : { [place]: { kind: 'rows', rows: <NativeHeaderMenuRows menu={menu} actions={actions} t={t} /> } }
  }
  const entries: ThreadMenuEntries = {
    find: { kind: 'item', label: t('threadSidebarFindInThread'), keys: 'Mod+F', onSelect: () => ThreadToolsModel.request({ sessionId, tool: 'find' }) },
    pin: {
      kind: 'item',
      label: t(state.pinned ? 'threadSidebarUnpin' : 'threadSidebarPin'),
      ...(state.pinned ? { icon: <PinOffIcon aria-hidden="true" /> } : undefined),
      onSelect: run.togglePinned,
    },
    done: {
      kind: 'item',
      label: t(state.settled ? 'threadSidebarUnsettle' : 'threadSidebarSettle'),
      disabled: !state.settled && state.settleDisabled,
      ...(state.settled ? { icon: <RotateCcwIcon aria-hidden="true" /> } : undefined),
      onSelect: run.updateSettled,
    },
    snooze: {
      kind: 'item',
      label: t(state.parked ? 'threadSidebarUnpark' : 'threadSidebarPark'),
      disabled: state.running,
      ...(state.parked ? { icon: <PlayIcon aria-hidden="true" /> } : undefined),
      onSelect: run.updateParked,
    },
    restore: { kind: 'item', label: t('threadSidebarRestore'), onSelect: run.restore },
    'copy-link': { kind: 'item', label: t('threadSidebarCopyLink'), onSelect: run.copyLink },
    ...(threadViews.length === 0
      ? undefined
      : {
          'thread-views': {
            kind: 'rows',
            rows: threadViews.map(view => (
              <DropdownMenuItem key={view.id} data-thread-view-open={view.id} onSelect={() => ThreadViewsModel.open({ sessionId, viewId: view.id })}>
                <PanelRightIcon aria-hidden="true" />
                {view.label}
              </DropdownMenuItem>
            )),
          },
        }),
    'continue-in': {
      kind: 'sub',
      label: t('threadSidebarContinueIn'),
      disabled: state.running,
      content: <ContinueInProjectItems t={t} continueIn={run.continueIn} Item={DropdownMenuItem} />,
    },
    ...nativeRows('native-open-in'),
    'copy-id': { kind: 'item', label: t('threadSidebarCopyId'), onSelect: run.copyId },
    ...nativeRows('copy-markdown'),
    turns: { kind: 'item', label: t('threadSidebarTurns'), onSelect: () => ThreadToolsModel.request({ sessionId, tool: 'turns' }) },
    mute: {
      kind: 'sub',
      label: t(state.muted ? 'threadSidebarMuted' : 'threadSidebarMute'),
      ...(state.muted ? { icon: <BellOffIcon aria-hidden="true" /> } : undefined),
      contentClassName: 'dshx-root dshx:min-w-44',
      content: (
        <>
          {THREAD_MUTE_OPTIONS.map(option => (
            <DropdownMenuItem key={option} onSelect={() => run.mute(option)}>
              {t(ThreadMuteModel.muteOptionLabelKeys[option])}
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={!state.muted} onSelect={run.unmute}>
            {t('threadSidebarUnmute')}
          </DropdownMenuItem>
        </>
      ),
    },
    'referenced-by': {
      kind: 'sub',
      label: t('threadSidebarReferencedBy'),
      contentClassName: 'dshx-root dshx:min-w-56 dshx:max-w-72',
      content: <ThreadReferencesItems sessionId={sessionId} t={t} openThread={openThread} Item={DropdownMenuItem} />,
    },
    ...(sections.length === 0 ? undefined : { sections: { kind: 'rows', rows: <RegisteredThreadMenuSections sessionId={sessionId} /> } }),
    ...nativeRows('native-actions'),
    archive: { kind: 'item', label: t('threadSidebarArchive'), disabled: state.archiveDisabled, onSelect: run.archive },
  }
  return (
    <ThreadMenu
      kit={DROPDOWN_MENU_KIT}
      entries={entries}
      archived={state.archived}
      phone={PhoneLayout.matches()}
      coarsePointer={typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches}
      labels={{ openIn: t('threadSidebarOpenIn'), copy: t('threadSidebarCopy'), more: t('threadSidebarMore') }}
    />
  )
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
  // Expired mutes are pruned by the sidebar's own clock; this header only needs the moment it opened.
  const [openedAt] = useState(() => Date.now())
  // The header's own More actions fold into this menu while their owner can resolve them; the header then draws no
  // second `⋯` (DESIGN.md: the thread header is one row with one `⋯`).
  const nativeMenuAvailable = useSyncExternalStore(ThreadViewsModel.subscribe, ThreadViewsModel.headerMenuAvailable, ThreadViewsModel.headerMenuAvailable)
  useEffect(() => (nativeMenuAvailable ? ThreadViewsModel.hostHeaderMenu() : undefined), [nativeMenuAvailable])
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
  const moreLabel = t('threadSidebarMoreThreadActions')
  const archiveDisabled = !archived && targetIds.some(targetId => sessionState.byId[targetId]?.running === true)

  return (
    <TooltipProvider>
      <div className="dshx-root dshx:flex dshx:items-center dshx:gap-1" role="group" aria-label={t('threadSidebarThreadActions')}>
        {/* One control: every verb of the thread is a row of this menu, never a second button beside it. */}
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
            <HeaderMenuBody
              sessionId={sessionId}
              t={t}
              openThread={openThread}
              state={{ archived, pinned, parked, settled, muted, running: session.running, settleDisabled, archiveDisabled }}
              run={{
                togglePinned,
                updateParked,
                updateSettled,
                mute,
                unmute: () => updatePreferences({ mutedThreads: ThreadMuteModel.unmuteSessions(preferences.mutedThreads, targetIds) }),
                continueIn: projectId => void continueIn(projectId),
                archive: () => void updateThreadOperation('archive'),
                restore: () => void updateThreadOperation('unarchive'),
                copyId: () => void copy(sessionId, 'threadSidebarIdCopied'),
                copyLink: () => void copy(ThreadUrlModel.buildThreadUrl(window.location.href, sessionId, workspaceId), 'threadSidebarLinkCopied'),
              }}
            />
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
