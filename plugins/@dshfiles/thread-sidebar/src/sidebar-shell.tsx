import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types'
import type { SidebarPanelMetadata, SidebarRootComponentProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PropsRenderSlots, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { useApi, useApiQuery, useContract, useRegistry } from '@dshfiles/dshx/client'
import { PhonePairingQr } from '@dshfiles/phone-pairing/contract'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@dshfiles/plugin-ui/components/ui/alert-dialog'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Textarea } from '@dshfiles/plugin-ui/components/ui/textarea'
import { Checkbox } from '@dshfiles/plugin-ui/components/ui/checkbox'
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@dshfiles/plugin-ui/components/ui/popover'
import { Switch } from '@dshfiles/plugin-ui/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  BellIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  CircleCheckIcon,
  CommandIcon,
  EllipsisIcon,
  GripVerticalIcon,
  LinkIcon,
  MessageSquareIcon,
  PanelLeftIcon,
  PanelRightOpenIcon,
  PauseIcon,
  PinIcon,
  QrCodeIcon,
  RefreshCwIcon,
  RotateCwIcon,
  SearchIcon,
  SettingsIcon,
  SignpostIcon,
  SlidersHorizontalIcon,
  SquarePenIcon,
  TextCursorInputIcon,
  XIcon,
} from '@dshfiles/plugin-ui/icons'
import { useCopyFeedback } from '@dshfiles/plugin-ui/hooks/copy-feedback'
import { errorMessage, useMutation, useQuery } from '@dshfiles/plugin-ui/query'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type Ref,
} from 'react'
import { SETTINGS_PANEL_ID } from './phone-shell.js'
import { StageCover } from './stage-cover.js'
import { SidebarOrganization, type OrderedSidebarEntry, type SidebarPreferences, type ThreadRowAction } from './organization.js'
import { NAVIGATION_EVENT, ThreadNavigationHistoryModel, type NavigationHistory, type NavigationLocation } from './navigation-history.js'
import type { PaletteAction } from '@dshfiles/command-palette/palette-contract'
import { PaletteBridge } from './palette-bridge.js'
import { FAN_OUT_REQUEST_EVENT, fanOutRoutesOf } from './fan-out-request.js'
import { registerWorkbenchPaletteActions } from './workbench-palette.js'
import { threadActionsApi } from './thread-actions-api.js'
import { KeyboardShortcutModel, parseChord } from './keyboard-shortcuts.js'
import { SidebarStateProvider, useSidebarState } from './sidebar-state.js'
import { THREAD_SIDEBAR_LOCALE_NAMESPACE } from './locales.js'
import { threadSidebarPluginUpdatesApi } from './plugin-updates-api.js'
import { threadSidebarRestartApi } from './restart-api.js'
import { RestartBridge } from './restart-bridge.js'
import { useAutoRestart } from './restart-status-item.js'
import { useRestartMachine } from './use-restart-machine.js'
import { sidebarSectionHookContext, type sidebarChildren } from './sidebar-contract.js'
import { SidebarContentSeat } from './sidebar-content-seat.js'
import { DestinationShell, NEW_FOLDER_EVENT, SHOW_DESTINATION_EVENT, usePhoneLayout } from './destination-shell.js'
import type { RailAction } from './rail-actions.js'
import { DESTINATIONS, DestinationSections, Destinations } from './destinations.js'
import { MovedTo, MovedToDialog } from './moved-to-dialog.js'
import { threadSidebarNavigationApi, type NavigationRecord } from './navigation-api.js'
import { decodeClientRevisions } from './client-revisions.js'
import { SidebarCustomizationFallback, SidebarCustomizationSeat } from './sidebar-customization.js'
import { LayoutMerge, SidebarDockHost } from './sidebar-dock-host.js'
import { SidebarCatalog } from './sidebar-catalog.js'
import { useSidebarFolders } from './sidebar-folders.js'
import { threadSidebarTreeApi } from './sidebar-tree-api.js'
import { workbenchPanels } from '@dshfiles/workbench/registry'
import { WorkbenchPorts } from '@dshfiles/workbench/shell-merge'
import { createPortal } from 'react-dom'
import { dispatchOpenSettings } from '@dshfiles/settings-shell/open-settings'

const NO_PENDING_PLUGINS: readonly string[] = []

interface FooterRegistration {
  id: string
  order: number
  label: string
}

export interface FooterSnapshot {
  settingsId: string | null
  actions: FooterRegistration[]
}

interface SidebarShellExtras {
  /** Actual public shell.left registration presence, not whether a renderer returned a nonempty element. */
  contentOverridden: boolean
  /** Plugin-local bridge: Root remains the sole editor/controller owner. */
  customizationTarget: HTMLElement | null
  customizationActionRef: Ref<() => void>
  readFooterSnapshot: () => FooterSnapshot
  subscribeFooterSnapshot: (listener: () => void) => () => void
  /** Stable key of the client bundle revisions this page runs; drives the reload banner. */
  readClientRevisionKey: () => string
  subscribeClientRevisions: (listener: () => void) => () => void
  openSession: (sessionId: SessionSummary['id']) => void
  /** Runs a Host shortcut command by id; null when this Host cannot run commands outside a key press. */
  runCommand: ((commandId: string) => boolean) | null
  loadModelCatalog: () => Promise<ModelCatalog>
  /** The Session the stage shows right now (a draft's local key until its first message creates it); optional for old callers. */
  readStageSession?: () => string | undefined
  subscribeStageSession?: (listener: () => void) => () => void
}

const NO_STAGE_SESSION = (): undefined => undefined
const NO_SUBSCRIPTION = (): (() => void) => () => undefined

type SidebarLocation = NavigationLocation<SessionSummary['id'], SidebarPanelMetadata['id']>

/** A Back/Forward step waits this long for its own navigation before treating a new location as a fresh visit. */
const NAVIGATION_SETTLE_MS = 1500
/** Holding Back or Forward this long opens the history menu, as browsers do. */
const HISTORY_HOLD_MS = 450
// A rebuilt plugin is noticed on the next check or on returning to the window; five minutes is often enough.
const PLUGIN_UPDATE_CHECK_MS = 300_000

const rowActionLabelKeys = {
  resume: 'threadSidebarResume',
  // Shorter than the button's tooltip so the Customize list keeps one line per action.
  resumeDismiss: 'threadSidebarRowActionDismiss',
  aside: 'threadSidebarOpenInSidePanel',
  pin: 'threadSidebarPin',
  park: 'threadSidebarPark',
  settle: 'threadSidebarSettle',
  mute: 'threadSidebarMute',
  archive: 'threadSidebarArchive',
  restore: 'threadSidebarRestore',
} as const satisfies Record<ThreadRowAction, Parameters<SidebarShellTranslate>[0]>

/** The button each hover action draws, so Customize sidebar lists the action the row itself shows. */
const rowActionIcons = {
  resume: <RefreshCwIcon size={14} />,
  resumeDismiss: <XIcon size={14} />,
  aside: <PanelRightOpenIcon size={14} />,
  pin: <PinIcon strokeWidth={1.5} size={14} />,
  park: <PauseIcon strokeWidth={1.5} size={14} />,
  settle: <CircleCheckIcon strokeWidth={1.5} size={14} />,
  mute: <BellIcon size={14} />,
  archive: <ArchiveIcon strokeWidth={1.5} size={14} />,
  restore: <ArchiveRestoreIcon strokeWidth={1.5} size={14} />,
} satisfies Record<ThreadRowAction, ReactNode>

const rowFieldKeys = [
  ['threadRowProject', 'threadSidebarRowProject'],
  ['threadRowProjectColor', 'threadSidebarRowProjectColor'],
  ['threadRowTitle', 'threadSidebarRowTitle'],
  ['threadRowMachine', 'threadSidebarRowMachine'],
  ['threadRowPath', 'threadSidebarRowPath'],
  ['threadRowTime', 'threadSidebarRowTime'],
  ['threadRowStatusDot', 'threadSidebarRowStatusDot'],
] as const satisfies readonly (readonly [keyof SidebarPreferences, Parameters<SidebarShellTranslate>[0]])[]

type SidebarShellTranslate = TranslateNS<typeof THREAD_SIDEBAR_LOCALE_NAMESPACE>
export type SidebarShellBaseProps = Omit<SidebarRootComponentProps, 't' | 'renderSlot' | '__renders'> &
  PropsRenderSlots<keyof typeof sidebarChildren> & {
    t: SidebarShellTranslate
  }
type SidebarShellProps = SidebarShellBaseProps & SidebarShellExtras

interface HeaderEntry extends OrderedSidebarEntry {
  label: string
  kind: 'new-thread' | 'search' | 'panel'
  panelId?: SidebarPanelMetadata['id']
}

interface FooterEntry extends OrderedSidebarEntry {
  key: string
  label: string
  kind: 'settings' | 'action'
  registrationId: string | null
}

const FOOTER_GAP = 8
const FOOTER_MORE_WIDTH = 28

const text = (translate: SidebarShellTranslate, key: Parameters<SidebarShellTranslate>[0]): string => translate(key)

/** Body of the page-reload banner: which client bundles this page is behind on, and the one button that applies them. */
const ReloadPendingContent = (props: { readonly plugins: readonly string[]; readonly reload: () => void; readonly t: SidebarShellTranslate }): JSX.Element => (
  <>
    <div className="dshx:flex dshx:flex-col dshx:gap-1">
      <p className="dshx:text-sm dshx:font-medium">{text(props.t, 'threadSidebarReloadApplied')}</p>
      <ul className="dshx:max-h-40 dshx:overflow-y-auto dshx:font-mono dshx:text-xs dshx:text-muted-foreground">
        {props.plugins.map(plugin => (
          <li key={plugin}>{plugin}</li>
        ))}
      </ul>
    </div>
    <Button type="button" size="sm" onClick={props.reload}>
      {text(props.t, 'threadSidebarReload')}
    </Button>
  </>
)

const toggleHidden = (ids: readonly string[], id: string): string[] => (ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id])

/** Set one hover action's visibility; a redundant call keeps the stored array identical. */
const withRowActionHidden = (actions: readonly ThreadRowAction[], action: ThreadRowAction, hidden: boolean): ThreadRowAction[] => {
  if (hidden === actions.includes(action)) return [...actions]
  return hidden ? [...actions, action] : actions.filter(item => item !== action)
}

const sameIds = (left: readonly string[], right: readonly string[]): boolean => left.length === right.length && left.every((id, index) => id === right[index])

/** Commands that only reopen this palette are left out of its command list. */
const SELF_COMMAND_IDS = new Set(['commandPalette.open'])

const SETTINGS_COMMAND_ID = 'settings.open'
/** `@dshfiles/workbench`'s right-pane toggle; on a phone that pane is the thread panel's bottom sheet. */
const THREAD_PANEL_COMMAND_ID = 'workbench.toggleSidePanel'

export const requestSettings = (runCommand: ((commandId: string) => boolean) | null): void => {
  if (runCommand?.(SETTINGS_COMMAND_ID) === true) return
  if (dispatchOpenSettings()) return
  // A native settings root owns the seat instead of the dshx shell: its trigger is the only public opener there.
  document.querySelector<HTMLButtonElement>('[data-footer-entry="settings"] button[aria-haspopup="dialog"]')?.click()
}

const focusComposer = (): void => {
  const composer = document.querySelector<HTMLElement>('[role="textbox"]:not([aria-disabled="true"]), textarea:not([disabled])')
  if (composer === null) return
  composer.focus()
  if (composer instanceof HTMLTextAreaElement) {
    composer.setSelectionRange(composer.value.length, composer.value.length)
    return
  }
  const range = document.createRange()
  range.selectNodeContents(composer)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

const SidebarRootContent = (props: SidebarShellProps): JSX.Element => {
  const { collapsed, readFooterSnapshot, renderSlot, selectPanel, startSession, subscribeFooterSnapshot, toggleSidebar } = props
  // History steps stamp their settle window from the gesture, not from render.
  const readNow = useCallback(() => Date.now(), [])
  const panels = props.usePanels(items => items)
  const activePanelId = props.usePanelInfo(info => info.activePanelId)
  const hostShortcuts = props.useShortcuts(entries => entries)
  const { preferences, updatePreferences, openPalette, selectedThreadId, threadTitle, hostBacked, layoutMergeOnHost, settingsSettled } = useSidebarState()
  // The phone top bar names the thread on the stage. The live stage Session wins over the list selection, which a
  // draft that became a thread does not update; read reactively so a rename (a first turn's title) shows at once.
  const stageSession = useSyncExternalStore(props.subscribeStageSession ?? NO_SUBSCRIPTION, props.readStageSession ?? NO_STAGE_SESSION, NO_STAGE_SESSION)
  // A blank Session (a new-thread draft before its first message) is not a thread yet: no title, no panels.
  const stageThread = props.useSessions(state => {
    const find = (id: string | null | undefined) => (id === undefined || id === null ? undefined : Object.values(state.byId).find(session => session.id === id))
    const stage = find(stageSession) ?? (stageSession === undefined ? find(selectedThreadId) : undefined)
    return stage === undefined || stage.blank ? undefined : stage.id
  })
  const stageTitle = props.useSessions(state =>
    stageThread === undefined ? undefined : Object.values(state.byId).find(session => session.id === stageThread)?.displayTitle,
  )
  // One sidebar layout (b:952m): the Workbench's left docking region is always mounted behind the rail; its default is
  // the old Fixed column as one Sidebar pane. The merge from the two former layouts runs once (sidebar-dock-host.ts).
  const contentOverridden = props.contentOverridden
  const mergeFiled = useRef(false)
  useEffect(() => {
    if (mergeFiled.current) return
    const decision = LayoutMerge.decide({ settled: settingsSettled, hostBacked, markerOnHost: layoutMergeOnHost, preferences })
    if (decision === null) return
    mergeFiled.current = true
    if (decision.hostPatch !== null) updatePreferences(decision.hostPatch)
    WorkbenchPorts.shellMerge().request(decision.request)
  }, [settingsSettled, hostBacked, layoutMergeOnHost, preferences, updatePreferences])
  const contributedSections = useRegistry(DestinationSections)
  const destinations = useMemo(() => Destinations.resolve(panels, contributedSections), [panels, contributedSections])
  // Sidebar folders (b:952m): the panels this browser can file, reported to the Host for the agent's
  // sidebar_panels_available (best effort; an older Host without the method is ignored).
  const sidebarCatalog = SidebarCatalog.useCatalog({ pages: panels, destinations, registry: workbenchPanels() })
  const treeApi = useApi(threadSidebarTreeApi)
  // SAFETY: the rail only offers panel ids it read from this sidebar's panel metadata or the Workbench registry.
  const selectAnyPanel = useCallback((panelId: string) => selectPanel(panelId as SidebarPanelMetadata['id']), [selectPanel])
  const folderUi = useSidebarFolders({ storedTree: preferences.sidebarTree, destinations, panels: sidebarCatalog, selectPanel: selectAnyPanel })
  const catalogKey = SidebarCatalog.key(sidebarCatalog)
  const latestCatalog = useRef(sidebarCatalog)
  latestCatalog.current = sidebarCatalog
  useEffect(() => {
    // Registrations arrive in bursts at boot and on a plugin reload: report once they settle.
    const timer = window.setTimeout(() => {
      void treeApi.reportPanels({ browserId: SidebarCatalog.browserId(), panels: latestCatalog.current }).catch(() => undefined)
    }, 2_000)
    return () => window.clearTimeout(timer)
  }, [catalogKey, treeApi])
  // A destination page on the stage hides the selected thread: its finishes are not "watched" (thread list attention).
  // On a phone the open list is full screen, so it hides the stage too.
  const phoneLayout = usePhoneLayout()
  const stageShowsPage =
    (phoneLayout && !collapsed) ||
    (activePanelId !== null &&
      activePanelId !== undefined &&
      (activePanelId === SETTINGS_PANEL_ID || Destinations.owning(destinations, activePanelId) !== undefined))
  useEffect(() => StageCover.set(stageShowsPage), [stageShowsPage])
  // Where the rail and its list render (b:952m): inside the Sidebar pane while the left docking region shows (a phone
  // keeps its own shell), inline otherwise. One element moves between the two, so the column never remounts.
  const dockMounted = contentOverridden && !phoneLayout
  const dockHost = useSyncExternalStore(SidebarDockHost.subscribe, SidebarDockHost.get, () => null)
  const columnInline = !dockMounted || props.collapsed
  const [columnElement] = useState(() => {
    const element = document.createElement('div')
    element.setAttribute('data-sidebar-column', '')
    element.className = 'dshx:flex dshx:min-h-0 dshx:w-full dshx:min-w-0 dshx:flex-1'
    return element
  })
  const inlineColumnRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const target = columnInline ? inlineColumnRef.current : dockHost
    if (target === null) {
      columnElement.remove()
      return
    }
    if (columnElement.parentElement === target) return
    target.append(columnElement)
    // A focused rail button that moves while the column is still animating its width can leave an ancestor scrolled
    // sideways (the pane then shows only its right edge); the column never scrolls horizontally on purpose.
    const unscroll = (): void => {
      for (let element: HTMLElement | null = target; element !== null && element !== document.body; element = element.parentElement)
        if (element.scrollLeft !== 0) element.scrollLeft = 0
    }
    const frame = window.requestAnimationFrame(unscroll)
    const settled = window.setTimeout(unscroll, 450)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(settled)
    }
  }, [columnInline, dockHost, columnElement])
  useEffect(() => () => columnElement.remove(), [columnElement])
  const navigationApi = useApi(threadSidebarNavigationApi)
  const recordNavigation = useCallback(
    (record: NavigationRecord): void => {
      // Counting is best effort: an older Host without the method must never break navigation.
      void navigationApi.record(record).catch(() => undefined)
    },
    [navigationApi],
  )
  const [history, setHistory] = useState<NavigationHistory<SidebarLocation>>(ThreadNavigationHistoryModel.emptyNavigationHistory)
  const pendingStep = useRef<{ target: SidebarLocation; until: number } | null>(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const historyGroupRef = useRef<HTMLDivElement>(null)
  const historyHold = useRef<{ timer: number | undefined; opened: boolean }>({ timer: undefined, opened: false })
  const restartApi = useApi(threadSidebarRestartApi)
  const fanOutApi = useApi(threadActionsApi)
  const fanOutWorkspaceId = useSyncExternalStore(PaletteBridge.subscribeFanOut, PaletteBridge.readFanOutWorkspaceId, () => undefined)
  const fanOutPreset = useSyncExternalStore(PaletteBridge.subscribeFanOut, PaletteBridge.readFanOutModels, () => undefined)
  const fanOutOpen = fanOutWorkspaceId !== undefined
  const loadModelCatalog = props.loadModelCatalog
  const fanOutCatalog = useQuery({
    queryKey: ['thread-sidebar', 'fan-out-catalog'],
    queryFn: () => loadModelCatalog(),
    enabled: fanOutOpen,
    staleTime: 0,
  })
  const [fanOutText, setFanOutText] = useState('')
  const [fanOutModels, setFanOutModels] = useState<readonly { provider: string; model: string; reasoningEffort?: string }[]>([])
  useEffect(() => {
    if (!fanOutOpen) return
    setFanOutModels(fanOutPreset ?? [])
  }, [fanOutOpen, fanOutPreset])
  useEffect(() => {
    const onRequest = (event: Event): void => {
      if (!(event instanceof CustomEvent)) return
      const models = fanOutRoutesOf(event.detail)
      if (models !== undefined) PaletteBridge.openFanOut(null, models)
    }
    window.addEventListener(FAN_OUT_REQUEST_EVENT, onRequest)
    return () => window.removeEventListener(FAN_OUT_REQUEST_EVENT, onRequest)
  }, [])
  const sendFanOut = useMutation({
    mutationFn: async () => {
      const result = await fanOutApi.fanOut({
        ...(fanOutWorkspaceId === null ? undefined : { projectId: fanOutWorkspaceId }),
        text: fanOutText.trim(),
        models: fanOutModels,
      })
      const firstCreated = result.results.find(item => item.ok && item.sessionId !== undefined)
      if (firstCreated?.sessionId !== undefined) props.openSession(SessionId(firstCreated.sessionId))
      const failures = result.results.filter(item => !item.ok)
      if (failures.length > 0) throw new Error(failures.map(item => `${item.provider}/${item.model}: ${item.error ?? 'failed'}`).join(' · '))
    },
    onSuccess: () => PaletteBridge.closeFanOut(),
  })
  const [restartSnapshot, sendRestart] = useRestartMachine(restartApi)
  const restartRequestPending = restartSnapshot.matches('requesting') || restartSnapshot.matches('requestingIdle')
  const restartRequestFailed = restartSnapshot.matches('failed')
  const restartWaitingHost = restartSnapshot.matches('restarting')
  const restartStalled = restartSnapshot.matches('stalled')
  const restartDialogOpen = restartSnapshot.context.dialogOpen
  const restartAvailability = useApiQuery(threadSidebarRestartApi, 'availability')
  const restartAvailable = restartAvailability.data?.available === true
  const restartPending = restartSnapshot.context.pending
  const reportedPendingRestart = restartAvailability.data?.pending
  // A restart waiting for idle that this page never asked for still ends with a new Host to watch.
  useEffect(() => {
    if (reportedPendingRestart !== null && reportedPendingRestart !== undefined) {
      sendRestart({ type: 'pendingSeen', pending: reportedPendingRestart })
    }
  }, [reportedPendingRestart, sendRestart])
  const restartWhenIdle = (): void => {
    sendRestart({ type: 'whenIdle' })
  }
  const cancelPendingRestart = (): void => {
    sendRestart({ type: 'cancelWhenIdle' })
  }
  const restartPendingLabel =
    restartPending === null
      ? null
      : restartPending.running === 0
        ? text(props.t, 'threadSidebarRestartWaitingIdle')
        : `${text(props.t, 'threadSidebarRestartWaiting')} (${String(restartPending.running)})`
  const launchUrl = useApiQuery(threadSidebarRestartApi, 'launchUrl').data?.url ?? null
  const pluginUpdates = useApiQuery(threadSidebarPluginUpdatesApi, 'pending')
  const pendingPlugins = pluginUpdates.data?.plugins ?? NO_PENDING_PLUGINS
  const pluginUpdatesSupported = pluginUpdates.status !== 'error'
  const refetchPluginUpdates = pluginUpdates.refetch
  const clientRevisionKey = useSyncExternalStore(props.subscribeClientRevisions, props.readClientRevisionKey, props.readClientRevisionKey)
  const clientRevisions = useMemo(() => decodeClientRevisions(clientRevisionKey), [clientRevisionKey])
  const clientUpdates = useApiQuery(threadSidebarPluginUpdatesApi, 'clientUpdates', {
    enabled: pluginUpdatesSupported && clientRevisions.length > 0,
    input: { revisions: clientRevisions },
  })
  // Entries the page never loaded count too: a plugin added after this page booted needs the reload as well.
  const staleClientPlugins = useMemo(() => [...(clientUpdates.data?.stale ?? []), ...(clientUpdates.data?.added ?? [])], [clientUpdates.data])
  const refetchClientUpdates = clientUpdates.refetch
  const [reloadPopoverOpen, setReloadPopoverOpen] = useState(false)
  const launchUrlCopy = useCopyFeedback()
  // phone-pairing's QR (upstream): the rail's Pair a phone (b:kgcc), ⌘K → Pair a phone and, with the rail actions off,
  // a footer button all open it; the rail and ⌘K show it in a dialog.
  const pairingQr = useContract(PhonePairingQr)
  const pairingAvailable = pairingQr.status === 'active'
  const [pairingOpen, setPairingOpen] = useState(false)
  const [footerSnapshot, setFooterSnapshot] = useState(props.readFooterSnapshot)
  const [customizeOpen, setCustomizeOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [footerFit, setFooterFit] = useState<readonly boolean[] | null>(null)
  const [emptyFooterIds, setEmptyFooterIds] = useState<readonly string[]>([])
  const shellRef = useRef<HTMLDivElement>(null)
  const brandRef = useRef<HTMLDivElement>(null)
  const footerAboveRef = useRef<HTMLDivElement>(null)
  const footerRegionRef = useRef<HTMLElement>(null)
  const footerItemRefs = useRef(new Map<string, HTMLDivElement>())
  const headerRegionId = `thread-sidebar-header-${useId()}`
  const wide = !props.collapsed
  const mac = KeyboardShortcutModel.isMacPlatform(navigator.platform)

  // Rebuilds happen in another window, so check on return to this one and now and then while it stays visible.
  useEffect(() => {
    if (!pluginUpdatesSupported) return
    const check = (): void => {
      if (document.hidden) return
      refetchPluginUpdates()
      refetchClientUpdates()
    }
    const timer = window.setInterval(check, PLUGIN_UPDATE_CHECK_MS)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [pluginUpdatesSupported, refetchPluginUpdates, refetchClientUpdates])

  useEffect(() => {
    const sync = (): void => setFooterSnapshot(readFooterSnapshot())
    const unsubscribe = subscribeFooterSnapshot(sync)
    sync()
    return unsubscribe
  }, [readFooterSnapshot, subscribeFooterSnapshot])

  useEffect(() => {
    const location = ThreadNavigationHistoryModel.currentLocation({ panelId: activePanelId, threadId: selectedThreadId })
    if (location === null) return
    const pending = pendingStep.current
    if (pending !== null) {
      if (ThreadNavigationHistoryModel.sameLocation(pending.target, location)) {
        pendingStep.current = null
        return
      }
      // Opening a thread from a panel passes through the old thread first; that is not a visit.
      if (Date.now() < pending.until) return
      pendingStep.current = null
    }
    setHistory(current => ThreadNavigationHistoryModel.visitLocation(current, location))
  }, [activePanelId, selectedThreadId])

  const goToHistoryEntry = (index: number): void => {
    const step = ThreadNavigationHistoryModel.jumpHistory(history, index)
    if (step === null) return
    pendingStep.current = { target: step.target, until: readNow() + NAVIGATION_SETTLE_MS }
    setHistory(step.history)
    if (step.target.kind === 'thread') {
      props.openSession(step.target.id)
      return
    }
    const panelId = step.target.id
    if (panels.some(panel => panel.id === panelId)) props.selectPanel(panelId)
  }
  const stepNavigation = (direction: -1 | 1): void => goToHistoryEntry(history.index + direction)
  const latestStepNavigation = useRef(stepNavigation)
  latestStepNavigation.current = stepNavigation
  // The palette reads availability when it opens; a ref keeps every thread switch from re-registering its actions.
  const latestHistory = useRef(history)
  latestHistory.current = history

  useEffect(() => {
    const onNavigate = (event: Event): void => {
      const detail: unknown = event instanceof CustomEvent ? event.detail : undefined
      const direction = typeof detail === 'object' && detail !== null && 'direction' in detail ? detail.direction : undefined
      if (direction === -1 || direction === 1) latestStepNavigation.current(direction)
    }
    window.addEventListener(NAVIGATION_EVENT, onNavigate)
    return () => window.removeEventListener(NAVIGATION_EVENT, onNavigate)
  }, [])

  useEffect(() => {
    const ownedByHost = (chord: NonNullable<ReturnType<typeof parseChord>>): boolean =>
      hostShortcuts.some(entry => KeyboardShortcutModel.sameAsHostBinding(chord, entry.binding, mac))
    // ⌘[ / ⌘] are browser-reserved for Host web shortcuts, so on the web they are claimed here before the browser.
    const chords = [
      { chord: parseChord(preferences.paletteChord), run: () => openPalette('all') },
      { chord: parseChord(preferences.fileSearchChord), run: () => openPalette('files') },
      { chord: parseChord(preferences.threadSearchChord), run: () => openPalette('threads') },
      { chord: parseChord(preferences.backChord), run: () => latestStepNavigation.current(-1) },
      { chord: parseChord(preferences.forwardChord), run: () => latestStepNavigation.current(1) },
    ].flatMap(({ chord, run }) => (chord === null || ownedByHost(chord) ? [] : [{ chord, run }]))

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing || event.repeat) return
      const match = chords.find(({ chord }) => KeyboardShortcutModel.matchesChord(event, chord, mac))
      if (match === undefined) return
      event.preventDefault()
      event.stopPropagation()
      match.run()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [
    hostShortcuts,
    mac,
    openPalette,
    preferences.backChord,
    preferences.fileSearchChord,
    preferences.forwardChord,
    preferences.paletteChord,
    preferences.threadSearchChord,
  ])

  const headerEntries = useMemo<HeaderEntry[]>(
    () => [
      { id: 'new-thread', label: text(props.t, 'threadSidebarNewThread'), kind: 'new-thread', order: -2 },
      { id: 'search', label: text(props.t, 'threadSidebarSearch'), kind: 'search', order: -1 },
      ...panels.map(panel => ({
        id: 'panel:' + panel.id,
        label: panel.label,
        kind: 'panel' as const,
        panelId: panel.id,
        order: panel.order,
      })),
    ],
    [panels, props.t],
  )

  const orderedHeaderEntries = useMemo(
    () => SidebarOrganization.orderSidebarEntries(headerEntries, preferences.headerOrder),
    [headerEntries, preferences.headerOrder],
  )
  const visibleHeaderEntries = useMemo(
    () => orderedHeaderEntries.filter(entry => !preferences.hiddenHeaderIds.includes(entry.id)),
    [orderedHeaderEntries, preferences.hiddenHeaderIds],
  )

  const orderedRowActions = useMemo(() => SidebarOrganization.orderRowActions(preferences.rowActionOrder), [preferences.rowActionOrder])

  const footerEntries = useMemo<FooterEntry[]>(
    () => [
      ...(footerSnapshot.settingsId === null
        ? []
        : [
            {
              key: 'settings',
              id: 'settings',
              label: text(props.t, 'threadSidebarHostSettings'),
              kind: 'settings' as const,
              registrationId: null,
              order: -1,
            },
          ]),
      ...footerSnapshot.actions.map(action => ({
        key: 'footer:' + action.id,
        id: 'footer:' + action.id,
        label: action.label,
        kind: 'action' as const,
        registrationId: action.id,
        order: action.order,
      })),
    ],
    [footerSnapshot, props.t],
  )

  const orderedFooterEntries = useMemo(
    () => SidebarOrganization.orderSidebarEntries(footerEntries, preferences.footerOrder),
    [footerEntries, preferences.footerOrder],
  )
  const visibleFooterEntries = orderedFooterEntries.filter(entry => !preferences.hiddenFooterIds.includes(entry.id))
  const hiddenFooterEntries = orderedFooterEntries.filter(entry => preferences.hiddenFooterIds.includes(entry.id))
  const footerEntryFits = (index: number): boolean => !wide || footerFit === null || footerFit[index] !== false
  // A seat whose card yielded to another surface (the usage strip above the foot,
  // the cordis panel with nothing to show) renders nothing: it keeps its place in
  // the order but takes no room and never sends the More control after it.
  const footerEntryEmpty = (entry: FooterEntry): boolean => emptyFooterIds.includes(entry.id)
  const footerEntryInline = (entry: FooterEntry, index: number): boolean => !footerEntryEmpty(entry) && footerEntryFits(index)
  const overflowFooterEntries = [...visibleFooterEntries.filter((entry, index) => !footerEntryInline(entry, index)), ...hiddenFooterEntries]
  const visibleFooterKey = visibleFooterEntries.map(entry => entry.id).join('|')
  const footerPages = visibleHeaderEntries
    .filter(entry => entry.kind === 'panel')
    .map(entry => ({ entry, current: entry.panelId !== undefined && entry.panelId === activePanelId }))

  useLayoutEffect(() => {
    const footer = footerRegionRef.current
    const ids = visibleFooterKey.split('|').filter(Boolean)
    if (!wide || footer === null) {
      setFooterFit(null)
      setEmptyFooterIds(current => (current.length === 0 ? current : []))
      return
    }
    const measure = (): void => {
      const widths = ids.map(id => footerItemRefs.current.get(id)?.getBoundingClientRect().width ?? 0)
      setEmptyFooterIds(current => {
        const next = ids.filter((_, index) => (widths[index] ?? 0) <= 0)
        return sameIds(current, next) ? current : next
      })
      const style = window.getComputedStyle(footer)
      const reserved = footer.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
      // The More control is always seated in the wide foot, so it always keeps its room.
      setFooterFit(
        SidebarOrganization.fitItems({
          widths,
          available: reserved - FOOTER_MORE_WIDTH - FOOTER_GAP,
          gap: FOOTER_GAP,
          reserve: 0,
        }),
      )
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(footer)
    footerItemRefs.current.forEach(element => observer.observe(element))
    return () => observer.disconnect()
  }, [wide, visibleFooterKey])

  const renderFooterEntry = (entry: FooterEntry, renderWide: boolean): ReactNode => {
    if (entry.kind === 'settings') {
      return props.renderSlot('sidebar.settings', { wide: renderWide })
    }
    if (entry.registrationId === null) return null
    return props.renderSlot('sidebar.footer.action', { wide: renderWide }, { only: entry.registrationId })
  }

  const activateHeaderEntry = useCallback(
    (entry: HeaderEntry): void => {
      if (entry.kind === 'new-thread') {
        startSession()
        return
      }
      if (entry.kind === 'search') {
        openPalette('threads')
        return
      }
      if (entry.panelId !== undefined) selectPanel(entry.panelId)
    },
    [openPalette, selectPanel, startSession],
  )

  const headerIconFor = useCallback(
    (entry: HeaderEntry, size: number): ReactNode => {
      if (entry.kind === 'new-thread')
        return (
          <span className="dshx:inline-flex" aria-hidden="true">
            <SquarePenIcon strokeWidth={1.5} size={size} />
          </span>
        )
      if (entry.kind === 'search')
        return (
          <span className="dshx:inline-flex" aria-hidden="true">
            <SearchIcon strokeWidth={1.5} size={size} />
          </span>
        )
      if (entry.panelId === undefined) return null
      return renderSlot('sidebar.panellist', { size, active: activePanelId === entry.panelId }, { only: entry.panelId })
    },
    [activePanelId, renderSlot],
  )

  const openCustomize = useCallback(() => {
    // A visible Threads panel can live on the right while the native left column is collapsed.
    if (props.customizationTarget === null && collapsed) toggleSidebar()
    setCustomizeOpen(true)
  }, [collapsed, toggleSidebar, props.customizationTarget])
  useImperativeHandle(props.customizationActionRef, () => openCustomize, [openCustomize])

  const openRestartDialog = useCallback((): void => {
    if (!restartAvailable) return
    sendRestart({ type: 'open' })
  }, [restartAvailable, sendRestart])
  // The status strip's restart item shows what waits and asks for the verbs; the dialog and its guards stay here.
  // Upstream's automatic restart (off by default here): its countdown, Postpone and Resume ride on the rail's Restart and
  // its confirmation dialog, so the status strip draws no second control while that Restart is on the rail.
  const autoRestart = useAutoRestart()
  const autoRestartPhase = autoRestart.status?.phase
  const restartOnRail = preferences.showRailActions && restartAvailable
  useEffect(() => {
    RestartBridge.publish({ hostPlugins: pendingPlugins, available: restartAvailable, waitingLabel: restartPendingLabel, onRail: restartOnRail })
  }, [pendingPlugins, restartAvailable, restartPendingLabel, restartOnRail])
  const postponeAutoRestart = (): void => {
    void restartApi.safe.postponeAutoRestart({}).then(() => autoRestart.refetch())
  }
  const resumeAutoRestart = (): void => {
    void restartApi.safe.resumeAutoRestart({}).then(() => autoRestart.refetch())
  }
  useEffect(() => () => RestartBridge.publish(RestartBridge.empty), [])
  const restartWhenIdleRef = useRef(restartWhenIdle)
  restartWhenIdleRef.current = restartWhenIdle
  const updatePreferencesRef = useRef(updatePreferences)
  updatePreferencesRef.current = updatePreferences
  useEffect(
    () =>
      RestartBridge.onRequest(request => {
        if (request === 'restart') {
          openRestartDialog()
          return
        }
        if (request === 'turn-off-auto-restart') {
          updatePreferencesRef.current({ autoRestartWhenIdle: false })
          return
        }
        if (restartAvailable && restartPending === null) restartWhenIdleRef.current()
      }),
    [openRestartDialog, restartAvailable, restartPending],
  )
  const pendingUpdatesLabel =
    pendingPlugins.length === 0
      ? null
      : `${text(props.t, 'threadSidebarUpdatesPending')} (${String(pendingPlugins.length)} ${text(props.t, pendingPlugins.length === 1 ? 'threadSidebarUpdatesPlugin' : 'threadSidebarUpdatesPlugins')})`
  const reloadPendingLabel =
    staleClientPlugins.length === 0
      ? null
      : `${text(props.t, 'threadSidebarReloadPending')} (${String(staleClientPlugins.length)} ${text(props.t, staleClientPlugins.length === 1 ? 'threadSidebarUpdatesPlugin' : 'threadSidebarUpdatesPlugins')})`
  const applyPageReload = (): void => globalThis.location.reload()
  const runCommand = props.runCommand
  const paletteActions = useMemo<PaletteAction[]>(
    () => [
      ...orderedHeaderEntries
        .filter(entry => entry.kind !== 'search')
        .map((entry): PaletteAction => {
          const owner = entry.kind === 'panel' ? Destinations.owning(destinations, entry.panelId) : undefined
          const section = owner?.sections.find(candidate => entry.kind === 'panel' && candidate.panelId === entry.panelId)
          return {
            id: `@dshfiles/thread-sidebar/header/${entry.id}`,
            group: 'destination',
            // "Observe › Usage"; the old "Usage: Analytics" label stays searchable.
            label: owner === undefined || section === undefined ? entry.label : `${owner.label} › ${section.label}`,
            aliases: owner === undefined ? [] : [entry.label, ...(section?.formerLabels ?? [])],
            icon: headerIconFor(entry, 16),
            run: () => {
              activateHeaderEntry(entry)
              if (owner !== undefined && entry.kind === 'panel') recordNavigation({ destination: owner.id, section: entry.panelId, surface: 'palette' })
            },
          }
        }),
      ...DESTINATIONS.map((destination): PaletteAction => ({
        id: `@dshfiles/thread-sidebar/destination/${destination.id}`,
        group: 'destination',
        label: `Go to ${destination.label}`,
        aliases: [destination.label, destination.description],
        run: () => {
          window.dispatchEvent(new CustomEvent(SHOW_DESTINATION_EVENT, { detail: destination.id }))
          recordNavigation({ destination: destination.id, surface: 'palette' })
        },
      })),
      {
        id: '@dshfiles/thread-sidebar/action/new-sidebar-folder',
        group: 'command',
        label: 'New sidebar folder',
        aliases: ['folder', 'sidebar folder', 'add folder', 'rail'],
        run: () => {
          window.setTimeout(() => window.dispatchEvent(new CustomEvent(NEW_FOLDER_EVENT)), 0)
        },
      },
      // Sidebar folders (b:952m): file any panel in one of the person's own folders from ⌘K.
      ...folderUi.folders
        .filter(folder => !folder.builtIn)
        .flatMap(folder =>
          folderUi.panels
            .filter(panel => !folder.entries.some(entry => entry.viewId === panel.id))
            .map((panel): PaletteAction => ({
              id: `@dshfiles/thread-sidebar/sidebar-add/${folder.id}/${panel.id}`,
              group: 'command',
              label: `Add ${panel.title} to ${folder.title}`,
              aliases: ['sidebar', 'folder', 'add panel'],
              run: () => folderUi.actions.addPanel(panel.id, folder.id),
            })),
        ),
      {
        id: '@dshfiles/thread-sidebar/action/toggle-footer',
        group: 'command',
        label: () => (preferences.showFooter ? 'Sidebar: hide the row under the list' : 'Sidebar: show the row under the list'),
        aliases: ['footer', 'sidebar footer', 'more', 'bottom row'],
        run: () => updatePreferences({ showFooter: !preferences.showFooter }),
      },
      {
        id: '@dshfiles/thread-sidebar/action/moved-to',
        group: 'command',
        label: 'Where did a page go?',
        aliases: ['moved to', 'moved pages', 'old sidebar', 'navigation map', 'find page'],
        icon: <SignpostIcon className="dshx:size-4" />,
        run: () => {
          window.setTimeout(MovedTo.open, 0)
        },
      },
      {
        id: '@dshfiles/thread-sidebar/action/toggle-sidebar',
        group: 'destination',
        label: text(props.t, 'threadSidebarToggleSidebar'),
        icon: <PanelLeftIcon className="dshx:size-4" />,
        run: toggleSidebar,
      },
      {
        id: '@dshfiles/thread-sidebar/action/focus-composer',
        group: 'destination',
        label: text(props.t, 'threadSidebarFocusComposer'),
        icon: <TextCursorInputIcon className="dshx:size-4" />,
        run: () => window.setTimeout(focusComposer, 0),
      },
      {
        id: '@dshfiles/thread-sidebar/action/customize-sidebar',
        group: 'destination',
        label: text(props.t, 'threadSidebarCustomize'),
        icon: <SlidersHorizontalIcon className="dshx:size-4" />,
        run: openCustomize,
      },
      {
        id: '@dshfiles/thread-sidebar/navigation/back',
        group: 'action',
        label: text(props.t, 'threadSidebarBack'),
        aliases: ['history', 'previous'],
        icon: <ArrowLeftIcon className="dshx:size-4" />,
        isAvailable: () => ThreadNavigationHistoryModel.canStep(latestHistory.current, -1),
        run: () => latestStepNavigation.current(-1),
      },
      {
        id: '@dshfiles/thread-sidebar/navigation/forward',
        group: 'action',
        label: text(props.t, 'threadSidebarForward'),
        aliases: ['history', 'next'],
        icon: <ArrowRightIcon className="dshx:size-4" />,
        isAvailable: () => ThreadNavigationHistoryModel.canStep(latestHistory.current, 1),
        run: () => latestStepNavigation.current(1),
      },
      ...(restartAvailable
        ? [
            {
              id: '@dshfiles/thread-sidebar/action/restart-dsh',
              group: 'destination' as const,
              label: pendingUpdatesLabel ?? text(props.t, 'threadSidebarRestart'),
              aliases: ['restart', 'reload host', 'apply updates'],
              icon: <RefreshCwIcon className="dshx:size-4" />,
              run: openRestartDialog,
            },
          ]
        : []),
      ...(!pairingAvailable
        ? []
        : [
            {
              id: '@dshfiles/thread-sidebar/action/pair-phone',
              group: 'destination' as const,
              label: 'Pair a phone',
              aliases: ['qr', 'qr code', 'phone', 'pairing', 'mobile'],
              icon: <QrCodeIcon className="dshx:size-4" />,
              run: () => setPairingOpen(true),
            },
          ]),
      ...(launchUrl === null
        ? []
        : [
            {
              id: '@dshfiles/thread-sidebar/action/copy-dsh-url',
              group: 'destination' as const,
              label: text(props.t, 'threadSidebarCopyLaunchUrl'),
              aliases: ['token', 'url', 'dshx', 'agent access'],
              icon: <LinkIcon className="dshx:size-4" />,
              run: () => void writeClipboard(launchUrl),
            },
          ]),
      ...(runCommand === null
        ? []
        : hostShortcuts
            .filter(entry => !SELF_COMMAND_IDS.has(entry.id))
            .map((entry): PaletteAction => ({
              id: `@dshfiles/thread-sidebar/command/${entry.id}`,
              group: 'command',
              label: entry.label,
              aliases: entry.aliases,
              keys: entry.binding === null ? [] : entry.keys,
              icon: <CommandIcon className="dshx:size-4" />,
              run: () => {
                window.setTimeout(() => runCommand(entry.id), 0)
              },
            }))),
    ],
    [
      orderedHeaderEntries,
      props.t,
      toggleSidebar,
      restartAvailable,
      launchUrl,
      pairingAvailable,
      pendingUpdatesLabel,
      hostShortcuts,
      runCommand,
      headerIconFor,
      activateHeaderEntry,
      openCustomize,
      openRestartDialog,
      destinations,
      recordNavigation,
      preferences.showFooter,
      folderUi.folders,
      folderUi.panels,
      folderUi.actions,
      updatePreferences,
    ],
  )
  // b:kgcc: Restart, a pending page reload, Copy DSH URL and Pair a phone sit on the rail above Settings (More › DSH on a
  // phone) unless the person turned that off; then they keep their old place in the row under the list.
  const railActionsShown = preferences.showRailActions
  const autoCountdownLabel = autoRestart.secondsLeft === null ? null : props.t('threadSidebarAutoRestartCountdown', { seconds: autoRestart.secondsLeft })
  const restartLabel = autoCountdownLabel ?? restartPendingLabel ?? pendingUpdatesLabel ?? text(props.t, 'threadSidebarRestart')
  const railActions: readonly RailAction[] = !railActionsShown
    ? []
    : [
        ...(restartAvailable
          ? [
              {
                id: 'restart' as const,
                label: restartLabel,
                icon: <RefreshCwIcon strokeWidth={1.5} />,
                // The one signal of the group: amber and a slow pulse while updates or a restart wait.
                tone: restartPendingLabel === null && pendingUpdatesLabel === null && autoCountdownLabel === null ? ('muted' as const) : ('warning' as const),
                pulse: restartPendingLabel !== null || pendingUpdatesLabel !== null || autoCountdownLabel !== null,
                onSelect: openRestartDialog,
              },
            ]
          : []),
        ...(reloadPendingLabel === null
          ? []
          : [
              {
                id: 'reload' as const,
                label: reloadPendingLabel,
                icon: <RotateCwIcon strokeWidth={1.5} />,
                tone: 'warning' as const,
                popover: {
                  label: text(props.t, 'threadSidebarReloadPending'),
                  content: <ReloadPendingContent plugins={staleClientPlugins} reload={applyPageReload} t={props.t} />,
                  open: reloadPopoverOpen,
                  onOpenChange: setReloadPopoverOpen,
                },
              },
            ]),
        ...(launchUrl === null
          ? []
          : [
              {
                id: 'copy-url' as const,
                label: text(props.t, 'threadSidebarCopyLaunchUrl'),
                icon: <LinkIcon strokeWidth={1.5} />,
                feedback: launchUrlCopy.copied ? text(props.t, 'threadSidebarCopied') : null,
                feedbackIcon: <CheckIcon strokeWidth={1.5} />,
                onSelect: () => void launchUrlCopy.copy(launchUrl),
              },
            ]),
        ...(pairingAvailable
          ? [
              {
                id: 'pair-phone' as const,
                label: text(props.t, 'threadSidebarPairPhone'),
                icon: <QrCodeIcon strokeWidth={1.5} />,
                onSelect: () => setPairingOpen(true),
              },
            ]
          : []),
      ]
  // With the actions on the rail, nothing pending forces the row under the list back (b:kgcc).
  const footerHidden = !preferences.showFooter && (railActionsShown || (restartPendingLabel === null && reloadPendingLabel === null))

  useEffect(() => PaletteBridge.addActions(paletteActions), [paletteActions])
  useEffect(() => {
    const registry = workbenchPanels()
    const existingMainPanelIds = new Set(orderedHeaderEntries.flatMap(entry => (entry.kind === 'panel' && entry.panelId !== undefined ? [entry.panelId] : [])))
    return registerWorkbenchPaletteActions({ registry, existingMainPanelIds, addActions: PaletteBridge.addActions })
  }, [orderedHeaderEntries])

  const renderCustomizeRow = (options: {
    entry: { id: string; label: string }
    index: number
    count: number
    icon: ReactNode
    hidden: boolean
    control: 'checkbox' | 'switch'
    /** Accessible name of the visibility control; defaults to the shared "Visibility: <label>" wording. */
    toggleLabel?: string
    onReorder: (from: number, to: number) => void
    onToggle: () => void
  }): JSX.Element => {
    const visibilityLabel = options.toggleLabel ?? `${text(props.t, 'threadSidebarVisibility')}: ${options.entry.label}`
    return (
      <div
        className={cn(
          'dshx:grid dshx:grid-cols-[14px_20px_minmax(0,1fr)_auto_auto] dshx:items-center dshx:gap-2.5',
          options.control === 'checkbox' ? 'dshx:h-8 dshx:rounded-md dshx:px-2 dshx:hover:bg-accent' : 'dshx:h-11 dshx:px-3',
        )}
        key={options.entry.id}
        draggable
        onDragStart={event => {
          event.dataTransfer.effectAllowed = 'move'
          event.dataTransfer.setData('text/plain', String(options.index))
        }}
        onDragOver={event => event.preventDefault()}
        onDrop={event => {
          event.preventDefault()
          const from = Number(event.dataTransfer.getData('text/plain'))
          if (Number.isInteger(from)) options.onReorder(from, options.index)
        }}
      >
        <GripVerticalIcon className="dshx:size-3.5 dshx:cursor-grab dshx:text-muted-foreground dshx:active:cursor-grabbing" aria-hidden="true" />
        <span
          className="dshx:inline-flex dshx:size-5 dshx:items-center dshx:justify-center dshx:overflow-hidden dshx:text-muted-foreground dshx:*:max-h-5 dshx:*:max-w-5 dshx:*:overflow-hidden"
          aria-hidden="true"
        >
          {options.icon}
        </span>
        <span className="dshx:truncate dshx:text-sm">{options.entry.label}</span>
        <span className="dshx:flex dshx:items-center">
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`${text(props.t, 'threadSidebarMoveUp')}: ${options.entry.label}`}
            disabled={options.index === 0}
            onClick={() => options.onReorder(options.index, options.index - 1)}
          >
            <ChevronUpIcon aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={`${text(props.t, 'threadSidebarMoveDown')}: ${options.entry.label}`}
            disabled={options.index === options.count - 1}
            onClick={() => options.onReorder(options.index, options.index + 1)}
          >
            <ChevronDownIcon aria-hidden="true" />
          </Button>
        </span>
        {options.control === 'checkbox' ? (
          <Checkbox checked={!options.hidden} aria-label={visibilityLabel} onCheckedChange={options.onToggle} />
        ) : (
          <Switch checked={!options.hidden} aria-label={visibilityLabel} onCheckedChange={options.onToggle} />
        )}
      </div>
    )
  }

  const toggleFanOutModel = (provider: string, model: string, reasoningEffort?: string): void => {
    setFanOutModels(current => {
      const selected = current.some(route => route.provider === provider && route.model === model)
      if (selected) return current.filter(route => route.provider !== provider || route.model !== model)
      if (current.length >= 6) return current
      return [...current, { provider, model, ...(reasoningEffort === undefined ? undefined : { reasoningEffort }) }]
    })
  }

  const paletteHint = parseChord(preferences.paletteChord)
  const withChordHint = (label: string, chordValue: string | null): string => {
    const chord = parseChord(chordValue)
    return chord === null ? label : `${label} (${KeyboardShortcutModel.formatChord(chord, mac).join('')})`
  }

  return (
    <TooltipProvider delayDuration={350}>
      <div
        ref={shellRef}
        className={cn(
          'dshx-root dshx:relative dshx:flex dshx:h-full dshx:min-h-0 dshx:max-w-full dshx:flex-none dshx:flex-col dshx:overflow-hidden dshx:bg-(--dsw-specific-sidebar-fill) dshx:text-foreground',
          props.collapsed && 'dshx:items-center',
        )}
        style={{ width: props.width }}
      >
        <div
          ref={brandRef}
          // A named container: the brand row decides what collapses from its own width (T1.2), not the viewport's.
          className={cn(
            'dshx:@container/brand dshx:flex dshx:h-12 dshx:w-full dshx:shrink-0 dshx:items-center dshx:gap-1',
            props.collapsed ? 'dshx:justify-center' : 'dshx:px-1.5',
          )}
        >
          <Button
            variant="ghost"
            size={props.collapsed ? 'icon' : 'icon-sm'}
            aria-label={text(props.t, props.collapsed ? 'threadSidebarExpand' : 'threadSidebarCollapse')}
            onClick={props.toggleSidebar}
          >
            {preferences.hideBrandLogo ? (
              <PanelLeftIcon className="dshx:size-4 dshx:text-muted-foreground" aria-hidden="true" />
            ) : (
              (props.renderSlot('sidebar.brand.mark', { size: 20 }) ?? <span aria-hidden="true">◈</span>)
            )}
          </Button>
          {wide && !preferences.hideBrandLogo ? (
            // The wordmark never truncates (T1.2): it is drawn at a 20px height (the native SVG is 24px) so it fits whole
            // beside Back, Forward, New thread and the palette at the default 280px; below 20rem only the history chevron
            // folds away (right-click or hold Back/Forward opens the same menu).
            <span
              data-sidebar-wordmark=""
              className="dshx:flex dshx:shrink-0 dshx:items-center dshx:whitespace-nowrap dshx:text-sm dshx:font-semibold dshx:[&_svg]:h-5 dshx:[&_svg]:w-auto"
            >
              {props.renderSlot('sidebar.brand.name', {}) ?? 'DSH'}
            </span>
          ) : null}
          {wide ? (
            <div className="dshx:ml-auto dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-px dshx:overflow-hidden">
              <Popover open={historyOpen} onOpenChange={setHistoryOpen}>
                <PopoverAnchor asChild>
                  <div ref={historyGroupRef} className="dshx:flex dshx:items-center">
                    {([-1, 1] as const).map(direction => {
                      const label = text(props.t, direction === -1 ? 'threadSidebarBack' : 'threadSidebarForward')
                      return (
                        <Button
                          key={direction}
                          variant="ghost"
                          size="icon-xs"
                          className="dshx:text-muted-foreground"
                          aria-label={label}
                          title={`${withChordHint(label, direction === -1 ? preferences.backChord : preferences.forwardChord)}\n${text(props.t, 'threadSidebarHistoryHint')}`}
                          disabled={!ThreadNavigationHistoryModel.canStep(history, direction)}
                          onPointerDown={event => {
                            if (event.button !== 0) return
                            window.clearTimeout(historyHold.current.timer)
                            historyHold.current = {
                              opened: false,
                              timer: window.setTimeout(() => {
                                historyHold.current.opened = true
                                setHistoryOpen(true)
                              }, HISTORY_HOLD_MS),
                            }
                          }}
                          onPointerUp={() => window.clearTimeout(historyHold.current.timer)}
                          onPointerLeave={() => window.clearTimeout(historyHold.current.timer)}
                          onContextMenu={event => {
                            event.preventDefault()
                            setHistoryOpen(true)
                          }}
                          onClick={() => {
                            if (historyHold.current.opened) {
                              historyHold.current.opened = false
                              return
                            }
                            stepNavigation(direction)
                          }}
                        >
                          {direction === -1 ? (
                            <ArrowLeftIcon className="dshx:size-3.5" aria-hidden="true" />
                          ) : (
                            <ArrowRightIcon className="dshx:size-3.5" aria-hidden="true" />
                          )}
                        </Button>
                      )
                    })}
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="dshx:w-4 dshx:text-muted-foreground dshx:@max-[20rem]/brand:hidden"
                      aria-label={text(props.t, 'threadSidebarHistory')}
                      aria-expanded={historyOpen}
                      title={text(props.t, 'threadSidebarHistory')}
                      disabled={history.entries.length < 2}
                      onClick={() => setHistoryOpen(open => !open)}
                    >
                      <ChevronDownIcon className="dshx:size-3" aria-hidden="true" />
                    </Button>
                  </div>
                </PopoverAnchor>
                <PopoverContent
                  align="start"
                  sideOffset={6}
                  className="dshx-root dshx:flex dshx:max-h-[min(420px,calc(100vh-96px))] dshx:w-64 dshx:flex-col dshx:gap-0.5 dshx:overflow-y-auto dshx:p-1"
                  aria-label={text(props.t, 'threadSidebarHistory')}
                  onInteractOutside={event => {
                    if (event.target instanceof Node && historyGroupRef.current?.contains(event.target) === true) event.preventDefault()
                  }}
                >
                  {history.entries
                    .map((entry, index) => ({ entry, index }))
                    .reverse()
                    .map(({ entry, index }) => {
                      const current = index === history.index
                      const label =
                        entry.kind === 'thread'
                          ? (threadTitle.current(entry.id) ?? text(props.t, 'threadSidebarHistoryThread'))
                          : (panels.find(panel => panel.id === entry.id)?.label ?? entry.id)
                      return (
                        <Button
                          key={`${String(index)}:${entry.kind}:${entry.id}`}
                          variant="ghost"
                          size="sm"
                          className={cn('dshx:w-full dshx:justify-start dshx:gap-2 dshx:font-normal', current && 'dshx:bg-accent dshx:font-medium')}
                          aria-current={current ? 'page' : undefined}
                          onClick={() => {
                            setHistoryOpen(false)
                            goToHistoryEntry(index)
                          }}
                        >
                          <span
                            className="dshx:inline-flex dshx:size-4 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:text-muted-foreground"
                            aria-hidden="true"
                          >
                            {entry.kind === 'thread' ? (
                              <MessageSquareIcon className="dshx:size-3.5" />
                            ) : (
                              props.renderSlot('sidebar.panellist', { size: 14, active: false }, { only: entry.id })
                            )}
                          </span>
                          <span className="dshx:truncate">{label}</span>
                        </Button>
                      )
                    })}
                </PopoverContent>
              </Popover>
              {preferences.hiddenHeaderIds.includes('new-thread') ? null : (
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="dshx:text-muted-foreground"
                  aria-label={text(props.t, 'threadSidebarNewThread')}
                  title={text(props.t, 'threadSidebarNewThread')}
                  onClick={() => startSession()}
                >
                  <SquarePenIcon className="dshx:size-4" aria-hidden="true" />
                </Button>
              )}
              <Button
                variant="ghost"
                size="icon-xs"
                className="dshx:text-muted-foreground"
                aria-label={text(props.t, 'threadSidebarCommandPalette')}
                title={
                  paletteHint === null
                    ? text(props.t, 'threadSidebarCommandPalette')
                    : `${text(props.t, 'threadSidebarCommandPalette')} (${KeyboardShortcutModel.formatChord(paletteHint, mac).join('')})`
                }
                onClick={() => openPalette('all')}
              >
                <CommandIcon className="dshx:size-4" aria-hidden="true" />
              </Button>
              <SidebarCustomizationFallback
                contentOverridden
                label={text(props.t, 'threadSidebarSettings')}
                expanded={customizeOpen}
                onClick={() => setCustomizeOpen(value => !value)}
              />
            </div>
          ) : null}
          {props.collapsed ? props.renderSlot('sidebar.toggle.badge', {}) : null}
        </div>

        {/* One sidebar layout (b:952m): the rail and its list render here, and live in the Workbench's Sidebar pane once
            it lends its element; collapsed, on a phone and without the Workbench they stay inline (the rail). */}
        {columnInline ? (
          <div ref={inlineColumnRef} data-sidebar-inline-column="" className="dshx:flex dshx:min-h-0 dshx:w-full dshx:min-w-0 dshx:flex-1" />
        ) : null}
        {createPortal(
          <DestinationShell
            panels={panels}
            contributed={contributedSections}
            activePanelId={activePanelId ?? null}
            selectedThreadId={selectedThreadId ?? null}
            stageThreadId={stageThread ?? null}
            stageSessionId={stageSession ?? null}
            collapsed={props.collapsed}
            renderPanelIcon={(panelId, size, active) => props.renderSlot('sidebar.panellist', { size, active }, { only: panelId })}
            threadList={props.renderSlot(
              'sidebar.workspaces',
              {
                wide,
                expandSidebar: () => {
                  if (props.collapsed) props.toggleSidebar()
                },
              },
              { hookContext: sidebarSectionHookContext },
            )}
            // SAFETY: the destination shell only offers panel ids it read from this sidebar's panel metadata.
            selectPanel={panelId => selectPanel(panelId as SidebarPanelMetadata['id'])}
            startSession={() => startSession()}
            searchThreads={preferences.hiddenHeaderIds.includes('search') ? null : () => openPalette('threads')}
            showNewThread={!preferences.hiddenHeaderIds.includes('new-thread')}
            customizeThreads={{ label: text(props.t, 'threadSidebarSettings'), expanded: customizeOpen, toggle: () => setCustomizeOpen(value => !value) }}
            labels={{ newThread: text(props.t, 'threadSidebarNewThread'), searchThreads: text(props.t, 'threadSidebarSearch') }}
            openSettings={footerSnapshot.settingsId === null ? null : () => requestSettings(props.runCommand)}
            toggleSidebar={toggleSidebar}
            record={recordNavigation}
            folderUi={folderUi}
            stageTitle={stageTitle}
            // The Workbench's thread panel (a bottom sheet on a phone) through its registered command; none without it.
            togglePanels={props.runCommand === null ? null : () => void props.runCommand?.(THREAD_PANEL_COMMAND_ID)}
            railActions={railActions}
          />,
          columnElement,
        )}
        <MovedToDialog
          panels={panels}
          openEntry={entry => {
            // SAFETY: moved-to entries name registered sidebar panel ids.
            selectPanel(entry.panelId as SidebarPanelMetadata['id'])
            recordNavigation({ destination: entry.destination, section: entry.panelId, surface: 'moved-to' })
          }}
        />
        {dockMounted ? (
          // Collapsed, the region stays mounted (its panes keep their state) but takes no room under the rail.
          <div className={props.collapsed ? 'dshx:hidden' : 'dshx:contents'}>
            <SidebarContentSeat renderSlot={props.renderSlot} collapsed={props.collapsed}>
              {null}
            </SidebarContentSeat>
          </div>
        ) : null}

        {customizeOpen && (wide || props.customizationTarget !== null) ? (
          <SidebarCustomizationSeat target={props.customizationTarget} label={text(props.t, 'threadSidebarCustomize')}>
            <div className="dshx:flex dshx:shrink-0 dshx:items-center dshx:justify-between dshx:pl-2">
              <h2 className="dshx:text-sm dshx:font-medium dshx:text-muted-foreground">{text(props.t, 'threadSidebarCustomize')}</h2>
              <Button variant="ghost" size="sm" className="dshx:font-semibold" onClick={() => setCustomizeOpen(false)}>
                {text(props.t, 'threadSidebarDone')}
              </Button>
            </div>
            <div className="dshx:flex dshx:flex-col dshx:gap-1.5 dshx:px-2">
              <label className="dshx:flex dshx:items-center dshx:gap-2 dshx:pt-1 dshx:text-sm">
                <Checkbox checked={!preferences.hideBrandLogo} onCheckedChange={checked => updatePreferences({ hideBrandLogo: checked !== true })} />
                {text(props.t, 'threadSidebarShowBrandLogo')}
              </label>
              <label className="dshx:flex dshx:items-center dshx:gap-2 dshx:pt-1 dshx:text-sm">
                <Checkbox checked={preferences.showFooter} onCheckedChange={checked => updatePreferences({ showFooter: checked === true })} />
                {text(props.t, 'threadSidebarShowFooter')}
              </label>
              <label className="dshx:flex dshx:items-center dshx:gap-2 dshx:pt-1 dshx:text-sm">
                <Checkbox checked={preferences.showRailActions} onCheckedChange={checked => updatePreferences({ showRailActions: checked === true })} />
                {text(props.t, 'threadSidebarShowRailActions')}
              </label>
            </div>
            <section className="dshx:flex dshx:flex-col dshx:gap-1.5 dshx:px-2" aria-labelledby={`${headerRegionId}-rows`}>
              <h3 id={`${headerRegionId}-rows`} className="dshx:text-xs dshx:font-medium dshx:text-muted-foreground">
                {text(props.t, 'threadSidebarThreadRows')}
              </h3>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                aria-labelledby={`${headerRegionId}-rows`}
                value={preferences.threadRowDensity}
                onValueChange={value => {
                  if (value === 'compact' || value === 'comfortable') updatePreferences({ threadRowDensity: value })
                }}
              >
                <ToggleGroupItem value="compact">{text(props.t, 'threadSidebarRowCompact')}</ToggleGroupItem>
                <ToggleGroupItem value="comfortable">{text(props.t, 'threadSidebarRowComfortable')}</ToggleGroupItem>
              </ToggleGroup>
              <div className="dshx:grid dshx:grid-cols-2 dshx:gap-x-3 dshx:gap-y-1.5 dshx:pt-1">
                {rowFieldKeys.map(([key, label]) => (
                  <label key={key} className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-sm">
                    <Checkbox checked={preferences[key]} onCheckedChange={checked => updatePreferences({ [key]: checked === true })} />
                    {text(props.t, label)}
                  </label>
                ))}
              </div>
            </section>
            <section className="dshx:flex dshx:flex-col dshx:gap-1.5 dshx:px-2" aria-labelledby={`${headerRegionId}-actions`}>
              <h3 id={`${headerRegionId}-actions`} className="dshx:text-xs dshx:font-medium dshx:text-muted-foreground">
                {text(props.t, 'threadSidebarRowActions')}
              </h3>
              <p className="dshx:text-xs dshx:text-muted-foreground">{text(props.t, 'threadSidebarRowActionsHint')}</p>
              <div className="dshx:mt-1 dshx:divide-y dshx:rounded-lg dshx:border">
                {orderedRowActions.map((action, index) =>
                  renderCustomizeRow({
                    entry: { id: action, label: text(props.t, rowActionLabelKeys[action]) },
                    index,
                    count: orderedRowActions.length,
                    icon: rowActionIcons[action],
                    hidden: preferences.hiddenRowActions.includes(action),
                    control: 'checkbox',
                    toggleLabel: text(props.t, rowActionLabelKeys[action]),
                    onReorder: (from, to) => updatePreferences({ rowActionOrder: SidebarOrganization.reorderRowActions(orderedRowActions, from, to) }),
                    onToggle: () =>
                      updatePreferences({
                        hiddenRowActions: withRowActionHidden(preferences.hiddenRowActions, action, !preferences.hiddenRowActions.includes(action)),
                      }),
                  }),
                )}
              </div>
            </section>
            <section className="dshx:flex dshx:flex-col dshx:gap-0.5">
              <h3 className="dshx:px-2 dshx:pb-1 dshx:text-xs dshx:font-medium dshx:text-muted-foreground">{text(props.t, 'threadSidebarHeaderLinks')}</h3>
              {orderedHeaderEntries.map((entry, index) =>
                renderCustomizeRow({
                  entry,
                  index,
                  count: orderedHeaderEntries.length,
                  icon: headerIconFor(entry, 16),
                  hidden: preferences.hiddenHeaderIds.includes(entry.id),
                  control: 'checkbox',
                  onReorder: (from, to) =>
                    updatePreferences({
                      headerOrder: SidebarOrganization.reorderSidebarEntry(
                        orderedHeaderEntries.map(item => item.id),
                        from,
                        to,
                      ),
                    }),
                  onToggle: () => updatePreferences({ hiddenHeaderIds: toggleHidden(preferences.hiddenHeaderIds, entry.id) }),
                }),
              )}
            </section>
            <section className="dshx:flex dshx:flex-col dshx:gap-1 dshx:px-2">
              <h3 className="dshx:text-sm dshx:font-medium">{text(props.t, 'threadSidebarFooterLinks')}</h3>
              <p className="dshx:text-xs dshx:text-muted-foreground">{text(props.t, 'threadSidebarFooterHint')}</p>
              <div className="dshx:mt-1 dshx:divide-y dshx:rounded-lg dshx:border">
                {orderedFooterEntries.map((entry, index) =>
                  renderCustomizeRow({
                    entry,
                    index,
                    count: orderedFooterEntries.length,
                    icon:
                      entry.kind === 'settings' ? (
                        <SettingsIcon strokeWidth={1.5} size={16} />
                      ) : (
                        props.renderSlot(
                          'sidebar.footer.action',
                          { wide: false },
                          entry.registrationId === undefined || entry.registrationId === null ? {} : { only: entry.registrationId },
                        )
                      ),
                    hidden: preferences.hiddenFooterIds.includes(entry.id),
                    control: 'switch',
                    onReorder: (from, to) =>
                      updatePreferences({
                        footerOrder: SidebarOrganization.reorderSidebarEntry(
                          orderedFooterEntries.map(item => item.id),
                          from,
                          to,
                        ),
                      }),
                    onToggle: () => updatePreferences({ hiddenFooterIds: toggleHidden(preferences.hiddenFooterIds, entry.id) }),
                  }),
                )}
              </div>
            </section>
          </SidebarCustomizationSeat>
        ) : null}

        {wide ? (
          <div ref={footerAboveRef} className="dshx:flex dshx:w-full dshx:min-w-0 dshx:shrink-0 dshx:flex-col dshx:empty:hidden">
            {reloadPendingLabel === null || railActionsShown ? null : (
              <Popover open={reloadPopoverOpen} onOpenChange={setReloadPopoverOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="dshx:flex dshx:h-7 dshx:w-full dshx:min-w-0 dshx:items-center dshx:gap-1.5 dshx:border-t dshx:px-3 dshx:text-left dshx:text-xs dshx:text-warning dshx:outline-none dshx:hover:bg-accent dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:focus-visible:ring-inset"
                    aria-label={reloadPendingLabel}
                  >
                    <RotateCwIcon className="dshx:size-3.5 dshx:shrink-0" aria-hidden="true" />
                    <span className="dshx:truncate">{reloadPendingLabel}</span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  side="top"
                  align="start"
                  className="dshx-root dshx:flex dshx:w-72 dshx:max-w-[calc(100vw-16px)] dshx:flex-col dshx:gap-3"
                  aria-label={text(props.t, 'threadSidebarReloadPending')}
                >
                  <ReloadPendingContent plugins={staleClientPlugins} reload={applyPageReload} t={props.t} />
                </PopoverContent>
              </Popover>
            )}
            {/* The status strip carries the account preview (docs/ade-ux §4.1 R5); Workbench offers the footer preview
                seat as a movable view. */}
          </div>
        ) : null}

        {footerHidden ? (
          // b:4v6p: Fixed layout keeps the foot row out of view unless asked for (showFooter), or, with the rail actions
          // off (b:kgcc), a pending restart or page reload needs it. Every verb stays reachable (Settings, the pages and
          // the DSH actions in the rail, all of them in ⌘K); its entries stay mounted, plainly and without tooltips (a tooltip whose trigger is not laid out opens at
          // the window's corner), because the quota edge overlay portals from here and Settings opens through its button.
          <footer ref={footerRegionRef} hidden style={{ display: 'none' }} data-footer-hidden="">
            {visibleFooterEntries.map(entry => (
              <div key={entry.id} data-footer-entry={entry.kind}>
                {renderFooterEntry(entry, true)}
              </div>
            ))}
          </footer>
        ) : (
          <footer
            ref={footerRegionRef}
            className={cn(
              'dshx:relative dshx:flex dshx:w-full dshx:border-t',
              props.collapsed
                ? 'dshx:mt-auto dshx:max-h-1/2 dshx:shrink dshx:flex-col dshx:items-center dshx:gap-1 dshx:overflow-x-hidden dshx:overflow-y-auto dshx:py-1 dshx:[scrollbar-width:none]'
                : 'dshx:h-[52px] dshx:shrink-0 dshx:flex-nowrap dshx:items-center dshx:gap-2 dshx:overflow-hidden dshx:px-2',
            )}
          >
            {restartAvailable && !railActionsShown ? (
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn('dshx:shrink-0', restartPendingLabel === null ? 'dshx:text-muted-foreground' : 'dshx:text-warning dshx:animate-pulse')}
                aria-label={restartPendingLabel ?? text(props.t, 'threadSidebarRestart')}
                title={restartPendingLabel ?? text(props.t, 'threadSidebarRestart')}
                onClick={openRestartDialog}
              >
                <RefreshCwIcon className="dshx:size-4" aria-hidden="true" />
              </Button>
            ) : null}
            {props.collapsed && reloadPendingLabel !== null && !railActionsShown ? (
              <Popover open={reloadPopoverOpen} onOpenChange={setReloadPopoverOpen}>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="dshx:shrink-0 dshx:text-warning" aria-label={reloadPendingLabel}>
                    <RotateCwIcon className="dshx:size-4" aria-hidden="true" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent
                  side="right"
                  align="start"
                  className="dshx-root dshx:flex dshx:w-72 dshx:max-w-[calc(100vw-16px)] dshx:flex-col dshx:gap-3"
                  aria-label={text(props.t, 'threadSidebarReloadPending')}
                >
                  <ReloadPendingContent plugins={staleClientPlugins} reload={applyPageReload} t={props.t} />
                </PopoverContent>
              </Popover>
            ) : null}
            {launchUrl === null || railActionsShown ? null : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="dshx:shrink-0 dshx:text-muted-foreground"
                    aria-label={text(props.t, 'threadSidebarCopyLaunchUrl')}
                    onClick={() => void launchUrlCopy.copy(launchUrl)}
                  >
                    {launchUrlCopy.copied ? <CheckIcon className="dshx:size-4" aria-hidden="true" /> : <LinkIcon className="dshx:size-4" aria-hidden="true" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">{text(props.t, 'threadSidebarCopyLaunchUrl')}</TooltipContent>
              </Tooltip>
            )}
            {pairingQr.status === 'active' && !railActionsShown ? <pairingQr.value.Button /> : null}
            {visibleFooterEntries.map((entry, index) => {
              const concealed = !footerEntryInline(entry, index)
              const item = (
                <div
                  key={entry.id}
                  ref={element => {
                    if (element === null) footerItemRefs.current.delete(entry.id)
                    else {
                      footerItemRefs.current.set(entry.id, element)
                      element.inert = concealed
                    }
                  }}
                  aria-hidden={concealed ? true : undefined}
                  data-overflowed={concealed ? 'true' : undefined}
                  data-footer-entry={entry.kind}
                  className={cn(
                    'dshx:flex dshx:w-max dshx:max-h-11 dshx:shrink-0 dshx:items-center dshx:whitespace-nowrap dshx:*:shrink-0',
                    concealed && 'dshx:pointer-events-none dshx:invisible dshx:absolute dshx:top-0 dshx:left-0',
                  )}
                >
                  {renderFooterEntry(entry, wide)}
                </div>
              )
              if (wide) return item
              return (
                <Tooltip key={entry.id}>
                  <TooltipTrigger asChild>{item}</TooltipTrigger>
                  <TooltipContent side="right">{entry.label}</TooltipContent>
                </Tooltip>
              )
            })}
            <Popover open={moreOpen} onOpenChange={setMoreOpen}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <PopoverTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className={cn('dshx:shrink-0 dshx:text-muted-foreground', wide && 'dshx:ml-auto')}
                      aria-label={text(props.t, 'threadSidebarMore')}
                    >
                      <EllipsisIcon strokeWidth={1.5} size={16} />
                    </Button>
                  </PopoverTrigger>
                </TooltipTrigger>
                <TooltipContent side="top">{text(props.t, 'threadSidebarMore')}</TooltipContent>
              </Tooltip>
              <PopoverContent
                side={wide ? 'top' : 'right'}
                align={wide ? 'end' : 'start'}
                className="dshx-root dshx:flex dshx:max-h-[min(480px,calc(100vh-96px))] dshx:w-auto dshx:min-w-56 dshx:max-w-[min(360px,calc(100vw-16px))] dshx:flex-col dshx:gap-0.5 dshx:overflow-y-auto dshx:p-1"
                aria-label={text(props.t, 'threadSidebarMore')}
              >
                {footerSnapshot.settingsId === null ? null : (
                  <Button
                    variant="ghost"
                    className="dshx:w-full dshx:shrink-0 dshx:justify-start dshx:gap-2 dshx:font-normal dshx:text-muted-foreground dshx:hover:text-foreground"
                    onClick={() => {
                      setMoreOpen(false)
                      requestSettings(props.runCommand)
                    }}
                  >
                    <SettingsIcon strokeWidth={1.5} size={16} />
                    <span className="dshx:truncate">{text(props.t, 'threadSidebarHostSettings')}</span>
                  </Button>
                )}
                {footerSnapshot.settingsId === null || overflowFooterEntries.length === 0 ? null : (
                  <div className="dshx:my-1 dshx:h-px dshx:shrink-0 dshx:bg-border" aria-hidden="true" />
                )}
                {overflowFooterEntries.map(entry => (
                  <div className="dshx:flex dshx:items-center dshx:whitespace-nowrap dshx:*:w-full" key={entry.id}>
                    {renderFooterEntry(entry, true)}
                  </div>
                ))}
                {(footerSnapshot.settingsId === null && overflowFooterEntries.length === 0) || footerPages.length === 0 ? null : (
                  <div className="dshx:my-1 dshx:h-px dshx:shrink-0 dshx:bg-border" aria-hidden="true" />
                )}
                {footerPages.map(({ entry, current }) => (
                  <Button
                    key={entry.id}
                    variant="ghost"
                    className={cn(
                      'dshx:w-full dshx:shrink-0 dshx:justify-start dshx:gap-2 dshx:font-normal dshx:text-muted-foreground dshx:hover:text-foreground',
                      current && 'dshx:bg-accent dshx:text-foreground',
                    )}
                    aria-current={current ? 'page' : undefined}
                    onClick={() => {
                      setMoreOpen(false)
                      activateHeaderEntry(entry)
                    }}
                  >
                    {headerIconFor(entry, 16)}
                    <span className="dshx:truncate">{entry.label}</span>
                    {current ? <CheckIcon className="dshx:ml-auto dshx:size-4" aria-hidden="true" /> : null}
                  </Button>
                ))}
              </PopoverContent>
            </Popover>
          </footer>
        )}
      </div>
      <AlertDialog
        open={restartDialogOpen}
        onOpenChange={open => {
          if (restartRequestPending && !open) return
          sendRestart({ type: open ? 'open' : 'cancel' })
        }}
      >
        {restartWaitingHost || restartStalled ? (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{text(props.t, restartStalled ? 'threadSidebarRestartStalledTitle' : 'threadSidebarRestartPending')}</AlertDialogTitle>
              {restartStalled ? (
                <AlertDialogDescription role="alert">{text(props.t, 'threadSidebarRestartStalled')}</AlertDialogDescription>
              ) : (
                <AlertDialogDescription role="status">{text(props.t, 'threadSidebarRestartWaitingHost')}</AlertDialogDescription>
              )}
            </AlertDialogHeader>
            <AlertDialogFooter>
              <Button type="button" variant="outline" onClick={() => sendRestart({ type: 'cancel' })}>
                {text(props.t, 'threadSidebarRestartCancel')}
              </Button>
              {restartStalled ? (
                <>
                  <Button type="button" variant="outline" onClick={() => sendRestart({ type: 'retry' })}>
                    {text(props.t, 'threadSidebarRestartKeepWaiting')}
                  </Button>
                  <Button type="button" onClick={() => globalThis.location.reload()}>
                    {text(props.t, 'threadSidebarReload')}
                  </Button>
                </>
              ) : null}
            </AlertDialogFooter>
          </AlertDialogContent>
        ) : (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{text(props.t, 'threadSidebarRestartTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{text(props.t, 'threadSidebarRestartDescription')}</AlertDialogDescription>
              <AlertDialogDescription>{text(props.t, 'threadSidebarRestartIdleDescription')}</AlertDialogDescription>
            </AlertDialogHeader>
            {autoCountdownLabel !== null || (autoRestartPhase === 'postponed' && autoRestart.status?.postponedUntil != null) ? (
              <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2 dshx:px-6 dshx:text-sm" data-auto-restart-state={autoRestartPhase}>
                <p role="status" className="dshx:text-muted-foreground">
                  {autoCountdownLabel ??
                    props.t('threadSidebarAutoRestartPostponed', {
                      time: new Date(autoRestart.status?.postponedUntil ?? 0).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    })}
                </p>
                <Button type="button" variant="ghost" size="sm" onClick={autoCountdownLabel === null ? resumeAutoRestart : postponeAutoRestart}>
                  {text(props.t, autoCountdownLabel === null ? 'threadSidebarAutoRestartResume' : 'threadSidebarAutoRestartPostpone')}
                </Button>
              </div>
            ) : null}
            {restartPendingLabel === null ? null : (
              <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2 dshx:px-6 dshx:text-sm">
                <p role="status" className="dshx:text-muted-foreground">
                  {restartPendingLabel}
                </p>
                <Button type="button" variant="ghost" size="sm" onClick={cancelPendingRestart}>
                  {text(props.t, 'threadSidebarRestartCancelPending')}
                </Button>
              </div>
            )}
            {pendingPlugins.length === 0 ? null : (
              <div className="dshx:flex dshx:flex-col dshx:gap-1 dshx:px-6 dshx:text-sm">
                <p className="dshx:text-muted-foreground">{text(props.t, 'threadSidebarUpdatesApplied')}</p>
                <ul className="dshx:flex dshx:max-h-40 dshx:flex-col dshx:gap-0.5 dshx:overflow-y-auto dshx:font-mono dshx:text-xs">
                  {pendingPlugins.map(plugin => (
                    <li key={plugin}>{plugin}</li>
                  ))}
                </ul>
              </div>
            )}
            {restartRequestFailed ? (
              <p role="alert" className="dshx:px-6 dshx:text-sm dshx:text-destructive">
                {text(props.t, 'threadSidebarRestartFailure')}
              </p>
            ) : null}
            <AlertDialogFooter>
              <Button type="button" variant="outline" disabled={restartRequestPending} onClick={() => sendRestart({ type: 'cancel' })}>
                {text(props.t, 'threadSidebarRestartCancel')}
              </Button>
              {restartPending === null ? (
                <Button type="button" variant="outline" disabled={restartRequestPending} onClick={restartWhenIdle}>
                  {text(props.t, 'threadSidebarRestartWhenIdle')}
                </Button>
              ) : null}
              <Button type="button" variant="destructive" disabled={restartRequestPending} onClick={() => sendRestart({ type: 'confirm' })}>
                {text(props.t, restartRequestPending ? 'threadSidebarRestartPending' : 'threadSidebarRestartConfirm')}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        )}
      </AlertDialog>
      <Dialog open={pairingOpen} onOpenChange={setPairingOpen}>
        <DialogContent className="dshx-root dshx:max-w-sm">
          <DialogHeader>
            <DialogTitle>Pair a phone</DialogTitle>
          </DialogHeader>
          {pairingQr.status === 'active' && pairingQr.value.Panel !== undefined ? (
            // b:ysaj: the code (and the switch that turns phone access on) right in the dialog, not behind a second button.
            <pairingQr.value.Panel />
          ) : (
            <>
              <p className="dshx:m-0 dshx:text-sm dshx:text-muted-foreground">Open the pairing code, then scan it with the phone or type it at /pair.</p>
              <div className="dshx:flex dshx:justify-center">{pairingQr.status === 'active' ? <pairingQr.value.Button /> : null}</div>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={fanOutOpen}
        onOpenChange={open => {
          if (!open) PaletteBridge.closeFanOut()
        }}
      >
        <DialogContent className="dshx-root dshx:max-h-[85dvh] dshx:overflow-y-auto dshx:max-w-xl">
          <DialogHeader>
            <DialogTitle>{text(props.t, 'threadSidebarFanOutTitle')}</DialogTitle>
          </DialogHeader>
          <Textarea aria-label={text(props.t, 'threadSidebarFanOutPrompt')} value={fanOutText} onChange={event => setFanOutText(event.target.value)} />
          <div className="dshx:max-h-64 dshx:overflow-y-auto dshx:rounded-md dshx:border dshx:border-border dshx:p-2">
            {fanOutCatalog.data?.groups.map(group => (
              <section key={group.id} className="dshx:mb-2">
                <h3 className="dshx:px-2 dshx:py-1 dshx:text-xs dshx:font-medium dshx:text-muted-foreground">{group.name}</h3>
                {group.models.map(model => {
                  const checked = fanOutModels.some(route => route.provider === group.id && route.model === model.id)
                  return (
                    <label
                      key={`${group.id}/${model.id}`}
                      className="dshx:flex dshx:items-center dshx:gap-2 dshx:rounded-sm dshx:px-2 dshx:py-1.5 dshx:text-sm dshx:hover:bg-accent dshx:pointer-coarse:min-h-11"
                    >
                      <Checkbox
                        checked={checked}
                        disabled={!checked && fanOutModels.length >= 6}
                        onCheckedChange={() => toggleFanOutModel(group.id, model.id, model.reasoning?.defaultEffort)}
                      />
                      {/* b:ysaj: the model's name, not its account-prefixed route (the picker's displayName rule). */}
                      <span>{model.name.startsWith(`${group.id}/`) ? model.name.slice(group.id.length + 1) : model.name}</span>
                    </label>
                  )
                })}
              </section>
            ))}
            {fanOutCatalog.isPending ? <p role="status">{text(props.t, 'threadSidebarFanOutLoading')}</p> : null}
            {fanOutCatalog.data !== undefined && fanOutCatalog.data.groups.length === 0 && fanOutCatalog.error === null ? (
              <p role="status" className="dshx:p-2 dshx:text-sm dshx:text-muted-foreground">
                {text(props.t, 'threadSidebarFanOutEmpty')}
              </p>
            ) : null}
            {fanOutCatalog.error === null ? null : (
              <p role="alert" className="dshx:text-sm dshx:text-destructive">
                {errorMessage(fanOutCatalog.error, 'Could not load model catalog.')}
              </p>
            )}
          </div>
          {sendFanOut.error === null ? null : (
            <p role="alert" className="dshx:text-sm dshx:text-destructive">
              {errorMessage(sendFanOut.error, 'Could not start the model threads.')}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => PaletteBridge.closeFanOut()}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={sendFanOut.isPending || fanOutModels.length < 2 || fanOutText.trim().length === 0}
              onClick={() => sendFanOut.mutate()}
            >
              {text(props.t, sendFanOut.isPending ? 'threadSidebarFanOutSending' : 'threadSidebarFanOutSend')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  )
}

export const SidebarRoot = (props: SidebarShellProps): JSX.Element => (
  <SidebarStateProvider>
    <SidebarRootContent {...props} />
  </SidebarStateProvider>
)
