import { WorkbenchPorts } from '@dshfiles/workbench/shell-merge'
import { useContract } from '@dshfiles/dshx/client'
import { PhoneStatus } from '@dshfiles/frame-layout/status-strip'
import { usePhoneHistoryLayer } from '@dshfiles/workbench/phone-history'
import { EmptyState } from '@dshfiles/plugin-ui/components/page'
import { LoadError } from '@dshfiles/plugin-ui/components/load-error'
import { LEADING_GLYPH_ATTRIBUTE, SELECTED_EDGE } from '@dshfiles/plugin-ui/components/selection'
import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { fieldLook } from '@dshfiles/plugin-ui/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { Popover, PopoverAnchor, PopoverContent } from '@dshfiles/plugin-ui/components/ui/popover'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import {
  ActivityIcon,
  BotIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EllipsisIcon,
  GitMergeIcon,
  InboxIcon,
  LibraryIcon,
  ListTodoIcon,
  MessagesSquareIcon,
  PanelBottomOpenIcon,
  PanelLeftIcon,
  PlusIcon,
  SettingsIcon,
  SearchIcon,
  SquarePenIcon,
  type LucideIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { PLACE_TONE_CLASS, placeToneStyle, type PlaceTone } from '@dshfiles/plugin-ui/components/ui/place-glyph'
import * as Schema from 'effect/Schema'
import { Fragment, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  DESTINATION_IDS,
  Destinations,
  KNOWN_SECTIONS,
  type DestinationIcon,
  type DestinationId,
  type DestinationPanel,
  type DestinationSection,
  type ResolvedDestination,
} from './destinations.js'
import type { NavigationRecord } from './navigation-api.js'
import { ListHeaderExtras } from './list-header-extras.js'
import { AddPanelButton, EntryMenu, FolderDialog, FolderGlyph, FolderMenu, FolderNotice, ViewGlyph, viewDrag, type SidebarFolderUi } from './sidebar-folders.js'
import { SidebarTrees, type ResolvedEntry } from './sidebar-tree.js'
import { PhoneTopBarModel, SETTINGS_PANEL_ID, useSoftwareKeyboard, useStandaloneStatusBar, type PhoneThreadSubtitle } from './phone-shell.js'
import { StatusGlyph } from '@dshfiles/plugin-ui/components/work-status'
import { PhoneLayout } from './phone-layout.js'
import { useEdgeSwipe } from './edge-swipe.js'
import { runStackMotion } from './stack-motion.js'
import { clearThreadUrl, pageLoadThreadRoute } from './thread-url.js'
import { PhoneRailActions, RailActionGroup, type RailAction } from './rail-actions.js'
import { PhoneDrawer } from './phone-drawer.js'
import { StageFold, type StageFoldState } from './stage-fold.js'
import { dispatchOpenSettings } from '@dshfiles/settings-shell/open-settings'
import type { SettingsNavigationService, SettingsNavigationState } from '@dshfiles/settings-shell/settings-navigation'
import { SettingsColumn, type SettingsColumnRow } from './settings-column.js'
import { SettingsEntryGlyph, SettingsIcons, SettingsToneMark } from '@dshfiles/settings-shell/settings-icons'

const ICONS = {
  'messages-square': MessagesSquareIcon,
  inbox: InboxIcon,
  'git-merge': GitMergeIcon,
  'list-todo': ListTodoIcon,
  bot: BotIcon,
  activity: ActivityIcon,
  library: LibraryIcon,
  settings: SettingsIcon,
} satisfies Record<DestinationIcon, LucideIcon>

/** The palette's "Go to …" commands ask the left column to show one destination's list. */
export const SHOW_DESTINATION_EVENT = 'dshfiles:thread-sidebar-show-destination'
/** ⌘K › New sidebar folder (b:952m): the rail opens its New folder dialog. */
export const NEW_FOLDER_EVENT = 'dshfiles:thread-sidebar-new-folder'
/** The `G`-then-key sequences: choose a destination as its rail button does (opening its only page). */
export const GO_DESTINATION_EVENT = 'dshfiles:thread-sidebar-go-destination'

const GO_FOCUS_DELAY_MS = 350

/** Focus the open thread's row (else the first) for Threads, else the first row of the page's keyboard list. */
const focusLanding = (destination: DestinationId): void => {
  if (destination === 'threads') {
    const list = document.querySelector<HTMLElement>('[data-testid="thread-sidebar-scroll"]')
    const rows = [...(list?.querySelectorAll<HTMLElement>('[data-thread-main-action][data-thread-id]') ?? [])].filter(row => row.offsetParent !== null)
    ;(rows.find(row => row.getAttribute('aria-current') === 'page') ?? rows[0])?.focus({ preventScroll: false })
    return
  }
  const region = [...document.querySelectorAll<HTMLElement>('[data-shortcut-ambient]')].find(element => element.offsetParent !== null)
  const row = region?.querySelector<HTMLElement>('[role="listitem"][tabindex="-1"]') ?? region
  if (row !== undefined && row !== null) row.focus({ preventScroll: true })
}

/** `G` then this key opens the destination (plan Q2 keymap); the rail tooltips show it. */
export const DESTINATION_GO_KEYS = {
  threads: 'G T',
  inbox: 'G I',
  land: 'G L',
  work: 'G W',
  agents: 'G A',
  observe: 'G O',
  knowledge: 'G K',
  settings: 'G S',
} as const satisfies Readonly<Record<DestinationId, string>>

const memoryValues = new Map<string, string>()
const memoryStorage = {
  getItem: (key: string) => memoryValues.get(key) ?? null,
  setItem: (key: string, value: string) => void memoryValues.set(key, value),
  removeItem: (key: string) => void memoryValues.delete(key),
}

/**
 * Which destination's list the left column shows. Presentation only and per page load: every load starts at Threads,
 * the home of the ADE, and the list then follows the page the stage shows.
 */
/** Every page load starts at Threads. */
const HOME_DESTINATION: DestinationId = 'threads'

// A built-in destination or a user folder id (b:952m); an id no folder has any more falls back to Threads.
const storedDestination = createStoredValue({
  key: 'dshfiles.thread-sidebar.destination.v1',
  schema: Schema.String,
  fallback: HOME_DESTINATION,
  storage: () => memoryStorage,
})

/** iPhone-class widths (plan §4.1): the rail becomes a bottom tab bar. Matches the frame's 640px phone rule. */
/** A destination whose list holds one page opens that page at once (the Inbox): the list would only repeat it. */
const soleSection = (destination: ResolvedDestination): string | undefined =>
  destination.id !== 'threads' && destination.id !== 'settings' && destination.sections.length === 1 ? destination.sections[0]?.panelId : undefined

/**
 * Opens `@dshfiles/settings-shell`'s Settings page in the stage through its documented cross-plugin request (plan §4.6).
 * False when the shell is not loaded: the rail then only shows its list, never the native Settings dialog.
 */
const openSettingsPage = (): boolean => dispatchOpenSettings()
const PHONE_NAV_HEIGHT = 'calc(56px + env(safe-area-inset-bottom, 0px))'
/** Inside a thread the tab bar is gone; the stage still stops above the home indicator. */
const PHONE_NAV_HIDDEN_HEIGHT = 'env(safe-area-inset-bottom, 0px)'
/** The phone top bar (Back, title, thread panels; the frame's status chip takes its trailing 48px). */
const PHONE_TOP_HEIGHT = 'calc(44px + env(safe-area-inset-top, 0px))'

export const usePhoneLayout = (): boolean => useSyncExternalStore(PhoneLayout.subscribe, PhoneLayout.matches, () => false)

export interface DestinationShellProps {
  readonly panels: readonly DestinationPanel[]
  readonly contributed: readonly DestinationSection[]
  readonly activePanelId: string | null
  /** The thread the stage shows; a change closes the phone list (the stage was pushed). */
  readonly selectedThreadId: string | null
  /** The Host thread on the stage, also once a draft became one (the list selection may lag); null for a draft. */
  readonly stageThreadId?: string | null
  /** The Session on the stage even while it is a blank draft; null or absent when none is known. */
  readonly stageSessionId?: string | null
  readonly collapsed: boolean
  /** The `sidebar.panellist` glyph of one page: the Inbox draws its own Needs you badge in it. */
  readonly renderPanelIcon: (panelId: string, size: number, active: boolean) => ReactNode
  /** Today's thread list: the Threads destination. */
  readonly threadList: ReactNode
  readonly selectPanel: (panelId: string) => void
  readonly startSession: () => void
  /** Opens the palette on threads; null hides the button (Customize sidebar › Search). */
  readonly searchThreads: (() => void) | null
  /** False when Customize sidebar hides New thread. */
  readonly showNewThread: boolean
  readonly labels: { readonly newThread: string; readonly searchThreads: string }
  /** The thread list's Sidebar settings gear (Customize sidebar), beside Search threads. */
  readonly customizeThreads?: { readonly label: string; readonly expanded: boolean; readonly toggle: () => void }
  /** Settings › All settings; null when the Host serves no settings page. */
  readonly openSettings: (() => void) | null
  /**
   * Settings' categories (`@dshfiles/settings-shell`): the Settings column lists them with its pages, as the one Settings
   * navigation (council round 4 B1). Absent, the column lists its pages under All settings.
   */
  readonly settingsNavigation?: SettingsNavigationService | undefined
  /** The thread the stage shows, as its title (the phone top bar names the stage). */
  readonly stageTitle?: string | undefined
  /** A thread picked in the list that the stage has not opened yet: the phone bar names it at once. */
  readonly pendingTitle?: string | undefined
  /** The phone thread bar's second line: the thread's subagents or that it works (council round 7 B5). */
  readonly stageSubtitle?: PhoneThreadSubtitle | undefined
  /** Opens or closes the thread panel (a bottom sheet on a phone); null when no owner serves it. */
  readonly togglePanels?: (() => void) | null
  /** A swipe in from the right edge, inside a thread, opens the thread panel (Settings › phoneEdgeSwipePanels). */
  readonly edgeSwipePanels?: boolean
  /** Phone model (Settings › phoneNavigation): the tab-bar stack, or the thread list as a drawer over the thread. */
  readonly phoneNavigation?: 'stack' | 'drawer'
  /** Settings › Developer lists the pages for plugin authors; off hides the group (the palette still opens them). */
  readonly showDeveloperPages?: boolean
  readonly toggleSidebar: () => void
  readonly record: (record: NavigationRecord) => void
  /** Sidebar folders (b:952m): the rail's folders and their verbs; absent, the rail lists the eight destinations. */
  readonly folderUi?: SidebarFolderUi | undefined
  /**
   * Restart DSH, a pending page reload, Copy DSH URL and Pair a phone (b:kgcc): a group directly above Settings on the
   * rail, a "DSH" section at the end of the phone's More tab. Empty or absent draws nothing.
   */
  readonly railActions?: readonly RailAction[] | undefined
}

const NO_RAIL_ACTIONS: readonly RailAction[] = []

/** "The column is folded because the stage page asked": the frame persists the collapse, so this persists too. */
const stageFoldMarker = createStoredValue({ key: 'dshfiles.thread-sidebar.stage-fold.v1', schema: Schema.Boolean, fallback: false })

/**
 * Folds the left column to its rail while the stage shows a page its list would only repeat (`StageFold`), and opens it
 * again when the page leaves. True while folded this way: the rail then keeps its labels and its active item.
 */
const useStageFold = (wants: boolean, collapsed: boolean, toggle: () => void, enabled: boolean): boolean => {
  // Read once per mount, from storage itself: another tab or an earlier mount may have changed the marker.
  const [initial] = useState((): StageFoldState => {
    stageFoldMarker.reload()
    return { folded: stageFoldMarker.get(), userOpened: false }
  })
  const state = useRef<StageFoldState>(initial)
  const [folded, setFolded] = useState(initial.folded)
  // Steps run on a change of the page or of the column only: a new toggle identity alone must not read the column it
  // just asked to fold, still open in this render, as one the person opened by hand.
  const toggleRef = useRef(toggle)
  toggleRef.current = toggle
  useEffect(() => {
    if (!enabled) return
    const { next, toggle: flip } = StageFold.step(state.current, { wants, collapsed })
    if (next.folded !== state.current.folded) {
      if (next.folded) stageFoldMarker.set(true)
      else stageFoldMarker.remove()
    }
    state.current = next
    setFolded(next.folded)
    if (flip) toggleRef.current()
  }, [wants, collapsed, enabled])
  return enabled && wants && collapsed && folded
}

const setStoredDestination = (next: string): void => void storedDestination.set(next)

/** The stored destination, for a test or a command that resets the column to Threads. */
export const DestinationSelection = { get: storedDestination.get, set: setStoredDestination } as const

/** The page the stage shows maps back onto its destination, so the list follows the palette and deep links. */
const useDestination = (
  destinations: readonly ResolvedDestination[],
  activePanelId: string | null,
  folderUi: SidebarFolderUi | undefined,
): [string, (next: string) => void] => {
  const destination = storedDestination.useValue()
  // A page filed in a folder is found there first (b:952m); otherwise its destination lists it.
  const owner =
    (folderUi === undefined || activePanelId === null ? undefined : SidebarTrees.folderOf(folderUi.folders, activePanelId)?.id) ??
    Destinations.owning(destinations, activePanelId)?.id
  const previous = useRef(activePanelId)
  useEffect(() => {
    if (previous.current === activePanelId) return
    previous.current = activePanelId
    if (owner !== undefined && owner !== storedDestination.get()) storedDestination.set(owner)
  }, [activePanelId, owner])
  return [destination, setStoredDestination]
}

/**
 * One rail entry (b:952m): a built-in destination or a folder of the person's own, with the rows its list shows. Without
 * sidebar folders (an older Host or a test) the rail is the eight destinations and their sections.
 */
interface RailFolder {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly icon: string
  readonly builtIn: boolean
  readonly bottom: boolean
  /** The built-in destination behind this folder: its badge glyph, its Go key, its navigation counter id. */
  readonly destination: ResolvedDestination | undefined
  readonly entries: readonly ResolvedEntry[]
}

const entriesOfSections = (destination: ResolvedDestination): readonly ResolvedEntry[] =>
  destination.sections.map(section => ({
    viewId: section.panelId,
    title: section.label,
    kind: 'page' as const,
    keep: false,
    mapped: true,
    description: section.description,
    unmapped: section.unmapped,
    developer: section.group === 'developer',
  }))

const railFoldersOf = (destinations: readonly ResolvedDestination[], folderUi: SidebarFolderUi | undefined): readonly RailFolder[] => {
  if (folderUi === undefined)
    return destinations.map(destination => ({
      id: destination.id,
      label: destination.label,
      description: destination.description,
      icon: destination.icon,
      builtIn: true,
      bottom: destination.bottom === true,
      destination,
      entries: entriesOfSections(destination),
    }))
  return folderUi.folders
    .filter(folder => !folder.hidden)
    .map(folder => {
      const destination = destinations.find(candidate => candidate.id === folder.id)
      const count = folder.entries.length
      return {
        id: folder.id,
        label: destination?.label ?? folder.title,
        description:
          destination?.description ?? (count === 0 ? 'Add the panels you want together here.' : `${String(count)} ${count === 1 ? 'panel' : 'panels'}.`),
        icon: folder.icon,
        builtIn: folder.builtIn,
        bottom: destination?.bottom === true,
        destination,
        entries: folder.entries,
      }
    })
}

/** A built-in folder whose list holds one page opens it at once (the Inbox): the list would only repeat it. */
const soleEntry = (folder: RailFolder): string | undefined =>
  folder.builtIn && folder.id !== 'threads' && folder.id !== 'settings' && folder.entries.length === 1 && folder.entries[0]?.kind === 'page'
    ? folder.entries[0].viewId
    : undefined

const isDestinationId = (id: string): id is DestinationId => DESTINATION_IDS.some(candidate => candidate === id)

/** Each destination's identity tone (council round 3 A7): its glyph on the rail and the phone tab bar. */
const NAV_TONE = {
  threads: 'dshx:nav-tone-threads',
  inbox: 'dshx:nav-tone-inbox',
  land: 'dshx:nav-tone-land',
  work: 'dshx:nav-tone-work',
  agents: 'dshx:nav-tone-agents',
  observe: 'dshx:nav-tone-observe',
  knowledge: 'dshx:nav-tone-knowledge',
  settings: 'dshx:nav-tone-settings',
} as const satisfies Record<DestinationId, string>

const RailButton = (props: {
  readonly folder: RailFolder
  readonly active: boolean
  readonly showLabel: boolean
  readonly icon: ReactNode
  readonly controls: string | undefined
  readonly onSelect: () => void
  /** A row dropped on this folder moves there (b:952m). */
  readonly onDropView?: ((viewId: string) => void) | undefined
}): JSX.Element => {
  const [dropping, setDropping] = useState(false)
  const button = (
    <button
      type="button"
      role="tab"
      data-destination={props.folder.id}
      data-sidebar-folder={props.folder.builtIn ? undefined : ''}
      aria-label={props.folder.label}
      aria-selected={props.active}
      aria-controls={props.controls}
      onClick={props.onSelect}
      onDragOver={event => {
        if (props.onDropView === undefined || !viewDrag.accepts(event)) return
        event.preventDefault()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={event => {
        setDropping(false)
        const viewId = viewDrag.read(event)
        if (viewId === undefined || props.onDropView === undefined) return
        event.preventDefault()
        props.onDropView(viewId)
      }}
      className={cn(
        'dshx:flex dshx:w-full dshx:shrink-0 dshx:flex-col dshx:items-center dshx:gap-0.5 dshx:rounded-md dshx:px-0 dshx:py-1 dshx:text-muted-foreground dshx:outline-none dshx:transition-colors',
        'dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring',
        // Navigation identity (council round 3 B2, A7): each destination's glyph in its own tone. The active item is its
        // tone's 14% tile behind the glyph and an ink label at 600, no wash: the leaf row in the list carries the marker.
        isDestinationId(props.folder.id) ? NAV_TONE[props.folder.id] : undefined,
        props.active && 'dshx:text-foreground',
        dropping && 'dshx:ring-2 dshx:ring-ring',
      )}
    >
      <span
        className={cn(
          'dshx:inline-flex dshx:h-6 dshx:w-8 dshx:items-center dshx:justify-center dshx:rounded-md dshx:text-nav-tone',
          props.active && 'dshx:bg-nav-tile',
        )}
        aria-hidden="true"
        data-rail-icon=""
      >
        {props.icon}
      </span>
      {props.showLabel ? (
        // The 11px floor at -0.01em (round five B3): "Knowledge", the longest, keeps side room in the 60px rail.
        <span className={cn('dshx:max-w-full dshx:truncate dshx:text-2xs dshx:leading-tight dshx:tracking-[-0.01em]', props.active && 'dshx:font-semibold')}>
          {props.folder.label}
        </span>
      ) : null}
    </button>
  )
  if (props.showLabel) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      {isDestinationId(props.folder.id) ? (
        <TooltipContent side="right" keys={DESTINATION_GO_KEYS[props.folder.id]}>
          {props.folder.label}
        </TooltipContent>
      ) : (
        <TooltipContent side="right">{props.folder.label}</TooltipContent>
      )}
    </Tooltip>
  )
}

/** Rail icons are 16px with a 1.5 stroke (T1.3 recessive sidebar); the phone tab bar asks for 20px touch-sized marks. */
const destinationIcon = (
  props: Pick<DestinationShellProps, 'panels' | 'renderPanelIcon'>,
  destination: ResolvedDestination,
  active: boolean,
  size: 16 | 20 = 16,
): ReactNode => {
  const badgePanel = destination.badgeFromPanel
  if (badgePanel !== undefined && props.panels.some(panel => panel.id === badgePanel)) return props.renderPanelIcon(badgePanel, size, active)
  const Icon = ICONS[destination.icon]
  return <Icon className={size === 16 ? 'dshx:size-4' : 'dshx:size-5'} strokeWidth={1.5} />
}

const folderIcon = (props: Pick<DestinationShellProps, 'panels' | 'renderPanelIcon'>, folder: RailFolder, active: boolean, size: 16 | 20 = 16): ReactNode =>
  folder.destination === undefined ? (
    <FolderGlyph name={folder.icon} className={size === 16 ? 'dshx:size-4' : 'dshx:size-5'} />
  ) : (
    destinationIcon(props, folder.destination, active, size)
  )

/**
 * A page glyph may draw a count over its icon (the Inbox's Needs you count): right for the 20px rail seat, but in a list
 * row the count sat on the icon and touched the label. In a row the count is positioned against the row instead, at its
 * trailing edge, clear of the label and of the row's menu.
 */
const SECTION_ROW_BADGE =
  'dshx:[&_[data-attention-badge]]:static dshx:[&_[data-attention-badge]>span]:top-2 dshx:[&_[data-attention-badge]>span]:right-8 dshx:[&_[data-attention-badge]>span]:left-auto'
const SECTION_ROW_BADGE_ROOM = "dshx:has-[[data-attention-badge]:not([data-attention-badge='0'])]:pr-14"
/**
 * The seat sizes the glyph (council round 10 B2): a page may register an unsized icon (a bare lucide icon is 24px), which
 * filled the 24px place seat. Every side-column glyph draws at 16px in its seat.
 */
const SECTION_ROW_GLYPH = 'dshx:[&_svg]:size-4 dshx:[&_svg]:shrink-0'

/** One section: its label is the button's whole name, so a reach or a screen reader finds it by that alone. */
const SectionButton = (props: {
  readonly label: string
  readonly description?: string | undefined
  readonly selected: boolean
  readonly panelId?: string | undefined
  /** The page's own sidebar glyph, which may carry its badge (RAM's detached memory, the Inbox count). */
  readonly icon?: ReactNode
  readonly onSelect: () => void
  /** The row's ⋯ menu (b:952m). */
  readonly menu?: ReactNode
  /** Drag the row to another folder or before another row (b:952m). */
  readonly drag?: { readonly onDropBefore: (viewId: string) => void } | undefined
  /** While Settings searches: the row's matches; none dims it. */
  readonly count?: number | undefined
  /** A row under the row above it (a category's settings under its page). */
  readonly nested?: boolean
  /**
   * The place's tone (round nine B2, kit A1): a destination's, or any CSS colour (a Settings group's identity tone). The
   * selected row's glyph sits on a 14% tile of it; at rest a destination row's glyph stays in the secondary ink.
   */
  readonly place?: { readonly tone: PlaceTone } | { readonly color: string } | undefined
}): JSX.Element => {
  const descriptionId = useId()
  const [dropping, setDropping] = useState(false)
  const { drag, panelId } = props
  return (
    <div
      className={cn('dshx:group/row dshx:relative dshx:flex dshx:items-start dshx:rounded-md', dropping && 'dshx:ring-2 dshx:ring-ring')}
      draggable={drag !== undefined && panelId !== undefined}
      onDragStart={event => {
        if (panelId !== undefined) viewDrag.start(event, panelId)
      }}
      onDragOver={event => {
        if (drag === undefined || !viewDrag.accepts(event)) return
        event.preventDefault()
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={event => {
        setDropping(false)
        const viewId = viewDrag.read(event)
        if (drag === undefined || viewId === undefined || viewId === panelId) return
        event.preventDefault()
        drag.onDropBefore(viewId)
      }}
    >
      <button
        type="button"
        data-section={props.panelId}
        aria-label={props.label}
        aria-current={props.selected ? 'page' : undefined}
        aria-describedby={props.description === undefined ? undefined : descriptionId}
        onClick={props.onSelect}
        className={cn(
          'dshx:relative dshx:flex dshx:w-full dshx:min-w-0 dshx:items-start dshx:gap-2 dshx:rounded-md dshx:px-2.5 dshx:py-1.5 dshx:text-left dshx:outline-none dshx:transition-colors',
          'dshx:hover:bg-accent/60 dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring',
          // A child row starts 12px past its parent's text edge (council round 6 B3): 10px inset, 16px glyph, 8px gap.
          props.nested === true && 'dshx:pl-11.5',
          props.count === 0 && 'dshx:opacity-45',
          // A row whose glyph carries a count keeps room for it at its trailing edge, before the row's own menu.
          SECTION_ROW_BADGE_ROOM,
          // The open page (round five T3, A1; council round 3 B2): the neutral selected wash and its leading marker, which
          // carries the accent, with an ink icon and label: the current place is lit once, here.
          props.selected && 'dshx:bg-selected-wash dshx:selected-marker dshx:text-foreground dshx:hover:bg-selected-wash',
          // A row led by its glyph or place seat draws no pill: the kit's selected edge outlines its wash (council round 12 B1).
          props.selected && props.icon !== undefined && props.icon !== null && SELECTED_EDGE,
        )}
      >
        {props.icon === undefined || props.icon === null ? null : props.place === undefined ? (
          <span
            className={cn(
              'dshx:mt-0.5 dshx:inline-flex dshx:size-4 dshx:shrink-0 dshx:items-center dshx:justify-center',
              props.selected ? 'dshx:text-foreground' : 'dshx:text-muted-foreground',
              SECTION_ROW_GLYPH,
              SECTION_ROW_BADGE,
            )}
            aria-hidden="true"
            data-section-icon=""
            // A row led by its glyph draws no marker pill beside it (council round 11 B3, kit A1): the wash and the 550
            // label carry the selection. A place seat is found by the kit rule itself.
            {...LEADING_GLYPH_ATTRIBUTE}
          >
            {props.icon}
          </span>
        ) : (
          // The selected-place seat (round nine B2, kit A1): 24px on the 16px glyph's footprint (negative margins), so
          // the tile it draws under `aria-current` never moves the row or its label.
          <span
            className={cn(
              'dshx:place-seat dshx:size-6 dshx:-mx-1 dshx:-mt-0.5 dshx:-mb-1 dshx:rounded-md',
              'tone' in props.place && props.selected ? PLACE_TONE_CLASS[props.place.tone] : undefined,
              SECTION_ROW_GLYPH,
              SECTION_ROW_BADGE,
            )}
            style={'color' in props.place ? placeToneStyle(props.place.color) : props.selected ? undefined : placeToneStyle(PLACE_REST_TONE)}
            aria-hidden="true"
            data-section-icon=""
          >
            {props.icon}
          </span>
        )}
        <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
          <span className={cn('dshx:truncate dshx:text-sm', props.selected && 'dshx:font-selected')}>{props.label}</span>
          {props.description === undefined ? null : (
            // One line at most (round five T4): the row is a destination, the page itself says the rest.
            <span id={descriptionId} className="dshx:line-clamp-1 dshx:text-xs dshx:text-muted-foreground">
              {props.description}
            </span>
          )}
        </span>
        {props.count === undefined || props.count === 0 ? null : (
          <span className="dshx:self-center dshx:rounded-full dshx:bg-secondary dshx:px-1.5 dshx:text-2xs dshx:leading-4 dshx:text-muted-foreground dshx:tabular-nums">
            {props.count}
          </span>
        )}
      </button>
      {props.menu === undefined ? null : <div className="dshx:absolute dshx:top-1.5 dshx:right-1">{props.menu}</div>}
    </div>
  )
}

/** A side-column row's glyph at rest: the secondary ink, as before it had a place seat. */
const PLACE_REST_TONE = 'var(--dsw-alias-label-secondary)'

/** The tone a folder's selected row carries: its destination's, or none for a user folder. */
const placeOf = (folder: RailFolder, toneGroup: 'pages' | 'developer' | undefined): { readonly tone: PlaceTone } | { readonly color: string } | undefined =>
  toneGroup !== undefined ? { color: SettingsIcons.toneOf(toneGroup) } : isDestinationId(folder.id) ? { tone: folder.id } : undefined

/** The rows of one folder: a page opens in the stage, any other view through the Workbench (b:952m). */
const EntryRows = (props: {
  readonly folder: RailFolder
  readonly entries: readonly ResolvedEntry[]
  readonly activePanelId: string | null
  readonly openEntry: (entry: ResolvedEntry) => void
  readonly renderPanelIcon: DestinationShellProps['renderPanelIcon']
  readonly folderUi: SidebarFolderUi | undefined
  readonly descriptions?: boolean
  /** In the Settings column: the group whose tone the rows' own icons take (council round 8 B4, no grey group). */
  readonly toneGroup?: 'pages' | 'developer' | undefined
}): JSX.Element => (
  <>
    {props.entries.map(entry => {
      const destination = props.folder.destination
      const icon =
        entry.kind !== 'page' ? (
          <ViewGlyph />
        ) : destination !== undefined && DESTINATION_GLYPH_PAGES.has(entry.viewId) ? (
          // The destination's own act (Review under Land): its tab's glyph, so the row and the tab name it alike.
          <DestinationGlyph icon={destination.icon} />
        ) : (
          props.renderPanelIcon(entry.viewId, 16, props.activePanelId === entry.viewId)
        )
      return (
        <SectionButton
          key={entry.viewId}
          panelId={entry.viewId}
          label={entry.title}
          description={props.descriptions === false ? undefined : entry.description}
          icon={props.toneGroup === undefined ? icon : <SettingsToneMark group={props.toneGroup}>{icon}</SettingsToneMark>}
          place={placeOf(props.folder, props.toneGroup)}
          selected={props.activePanelId === entry.viewId}
          onSelect={() => props.openEntry(entry)}
          menu={props.folderUi === undefined ? undefined : <EntryMenu entry={entry} folderId={props.folder.id} ui={props.folderUi} />}
          drag={props.folderUi === undefined ? undefined : { onDropBefore: viewId => props.folderUi?.actions.movePanel(viewId, props.folder.id, entry.viewId) }}
        />
      )
    })}
  </>
)

/** Pages whose row draws their destination's glyph, the one their tab shows (council round 10 B2). */
const DESTINATION_GLYPH_PAGES: ReadonlySet<string> = new Set(KNOWN_SECTIONS.flatMap(section => (section.glyph === 'destination' ? [section.panelId] : [])))

const DestinationGlyph = (props: { readonly icon: DestinationIcon }): JSX.Element => {
  const Icon = ICONS[props.icon]
  return <Icon className="dshx:size-4" strokeWidth={1.5} />
}

/** The phone bar's title: the bar row's 17/22, at 600 (council round 4 B3, round 7 B5). */
const PHONE_TITLE_CLASS = 'dshx:min-w-0 dshx:truncate dshx:font-semibold'

const SETTINGS_GROUP_HEAD = 'dshx:px-2.5 dshx:pb-1 dshx:text-sm dshx:font-semibold dshx:text-muted-foreground'

/**
 * The Settings column (council round 4 B1): Settings' categories by task group and the destination's pages, one list
 * with no entry twice. While it shows, the Settings page drops its own list (`attach`).
 */
const SettingsColumnList = (props: {
  readonly navigation: SettingsNavigationService
  readonly folder: RailFolder
  /** The destination's mapped pages: a category claims its own, the rest follow under Pages. */
  readonly entries: readonly ResolvedEntry[]
  readonly activePanelId: string | null
  readonly openEntry: (entry: ResolvedEntry) => void
  readonly selectPanel: (panelId: string) => void
  readonly folderUi: SidebarFolderUi | undefined
  readonly rows: (entries: readonly ResolvedEntry[], toneGroup?: 'pages' | 'developer') => JSX.Element
  readonly addPanel: ReactNode
}): JSX.Element => {
  const { navigation, folder, folderUi } = props
  const state: SettingsNavigationState = useSyncExternalStore(navigation.state.subscribe, navigation.state.get, navigation.state.get)
  useEffect(() => navigation.attach(), [navigation])
  const { groups, rest } = useMemo(() => SettingsColumn.merge({ state, entries: props.entries }), [state, props.entries])
  const open = (row: SettingsColumnRow): void => {
    if (row.page === undefined) navigation.select(row.id)
    else if (row.entry !== undefined) props.openEntry(row.entry)
    else props.selectPanel(row.page)
  }
  return (
    <nav aria-label={`${folder.label} pages`} className="dshx:flex dshx:flex-col" data-settings-column="">
      {groups.map(group => (
        <div
          key={group.id}
          role="group"
          aria-label={group.label}
          data-settings-group={group.id}
          // Group heads 13/600 in the secondary ink (round five B5), 16px under the group above and 4px over their first
          // row (council round 6 B3).
          className="dshx:mt-4 dshx:flex dshx:flex-col dshx:gap-0.5 dshx:first:mt-0"
        >
          {group.named ? <h3 className={SETTINGS_GROUP_HEAD}>{group.label}</h3> : null}
          {group.rows.map(row => {
            const here = SettingsColumn.isCurrent(row, { state, activePanelId: props.activePanelId })
            const category = row.category
            const settingsHere = category !== undefined && state.activeId === category
            const entry = row.entry
            return (
              <Fragment key={row.id}>
                <SectionButton
                  label={row.label}
                  // Every category's 16px glyph in its group's tone (round five B5, council round 6 B3), as its phone tile.
                  icon={<SettingsEntryGlyph group={group.id} label={row.label} />}
                  // The selected category's glyph on a 14% tile of its group's tone (round nine B2).
                  place={{ color: SettingsIcons.toneOf(group.id) }}
                  selected={here}
                  onSelect={() => open(row)}
                  count={state.searching ? row.count : undefined}
                  panelId={entry?.viewId}
                  menu={folderUi === undefined || entry === undefined ? undefined : <EntryMenu entry={entry} folderId={folder.id} ui={folderUi} />}
                  drag={
                    folderUi === undefined || entry === undefined
                      ? undefined
                      : { onDropBefore: viewId => folderUi.actions.movePanel(viewId, folder.id, entry.viewId) }
                  }
                />
                {/* The category's own settings, one row under its page while either is the current place. */}
                {category !== undefined && (here || settingsHere) ? (
                  <SectionButton nested label={`${row.label} settings`} selected={settingsHere} onSelect={() => navigation.select(category)} />
                ) : null}
              </Fragment>
            )
          })}
        </div>
      ))}
      {rest.length === 0 ? null : (
        <div role="group" aria-label="Pages" data-settings-group="pages" className="dshx:mt-4 dshx:flex dshx:flex-col dshx:gap-0.5">
          <h3 className={SETTINGS_GROUP_HEAD}>Pages</h3>
          {props.rows(rest, 'pages')}
        </div>
      )}
      {props.addPanel}
    </nav>
  )
}

/** One folder's list: its rows, opened in the stage, and + Add panel. Threads shows the thread list instead. */
const FolderIndex = (props: {
  readonly folder: RailFolder
  readonly activePanelId: string | null
  readonly openEntry: (entry: ResolvedEntry) => void
  readonly openSettings: (() => void) | null
  readonly renderPanelIcon: DestinationShellProps['renderPanelIcon']
  readonly folderUi: SidebarFolderUi | undefined
  /** Phone: the top bar already names the destination, so the heading stays for assistive tech only. */
  readonly phone?: boolean
  /** List the pages for plugin authors, in their own group at the end of Settings. */
  readonly showDeveloperPages?: boolean | undefined
  /** Settings › Plugins, where a page that did not load is diagnosed. */
  readonly openPlugins?: (() => void) | undefined
  /** Settings' categories, listed with the Settings pages (council round 4 B1). */
  readonly settingsNavigation?: SettingsNavigationService | undefined
  readonly selectPanel: (panelId: string) => void
}): JSX.Element => {
  const { folder, folderUi } = props
  const [renaming, setRenaming] = useState(false)
  const resolved = folderUi?.folders.find(candidate => candidate.id === folder.id)
  // Settings lists the pages nobody mapped, and the panels of a deleted folder, under Other pages.
  const other = (entry: ResolvedEntry): boolean => entry.unmapped || (folder.id === 'settings' && !entry.mapped)
  // Pages for plugin authors sit apart, after everything a user came for; a sidebar setting hides the group.
  const developerEntries = folder.entries.filter(entry => entry.developer === true)
  const developer = props.showDeveloperPages === false ? [] : developerEntries
  const mapped = folder.entries.filter(entry => !other(entry) && entry.developer !== true)
  const unmapped = folder.entries.filter(entry => other(entry) && entry.developer !== true)
  const settings = folder.id === 'settings' ? props.openSettings : null
  // With the Settings page on stage the column folds to the rail (round five B1); opened by hand, this list drops its
  // header line and reads as a plain list of the other Settings pages.
  const settingsOnStage = folder.id === 'settings' && props.activePanelId === SETTINGS_PANEL_ID
  // The one Settings navigation (council round 4 B1): categories and pages in one list, beside the stage; a phone keeps
  // its list of pages and the page's own Sections select.
  const settingsNavigation = folder.id === 'settings' && props.phone !== true ? props.settingsNavigation : undefined
  // The column keeps its "Settings" head, with the folder's ⋯, on every Settings page (council round 7 B2): the Settings
  // page's h1 names its category ("General"), so nothing reads "Settings Settings" and the list never jumps between pages.
  const empty = mapped.length === 0 && unmapped.length === 0 && developer.length === 0 && settings === null
  const missingPage = Destinations.expectedPageOf(folder.id)
  // Rows are names only (round five B1): the header's one line describes the destination, each page says the rest.
  const rows = (entries: readonly ResolvedEntry[], toneGroup?: 'pages' | 'developer'): JSX.Element => (
    <EntryRows
      folder={folder}
      entries={entries}
      activePanelId={props.activePanelId}
      openEntry={props.openEntry}
      renderPanelIcon={props.renderPanelIcon}
      folderUi={folderUi}
      descriptions={false}
      toneGroup={toneGroup}
    />
  )
  return (
    <div className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:flex-col" data-destination-index={folder.id}>
      {/* The right padding keeps the folder's ⋯ clear of the pane's own top-right Show tab row control (b:952m). */}
      <header
        className={cn(
          'dshx:flex dshx:shrink-0 dshx:items-start dshx:gap-1 dshx:pt-1 dshx:pb-2 dshx:pl-3',
          props.phone === true ? 'dshx:pr-3' : 'dshx:pr-9',
        )}
      >
        <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
          <h2 className={cn('dshx:text-sm dshx:font-semibold', props.phone === true && 'dshx:sr-only')}>{folder.label}</h2>
          {settingsOnStage || settingsNavigation !== undefined ? null : <p className="dshx:text-xs dshx:text-muted-foreground">{folder.description}</p>}
        </div>
        {folderUi === undefined || resolved === undefined || props.phone === true ? null : (
          <FolderMenu folder={resolved} ui={folderUi} onRename={() => setRenaming(true)} />
        )}
      </header>
      <div className="dshx:min-h-0 dshx:flex-1 dshx:overflow-y-auto dshx:px-1.5">
        {empty && missingPage !== undefined ? (
          // A page this destination is known for did not register: its plugin did not load (D6).
          <LoadError
            subject={missingPage}
            sentence={`${missingPage} did not load. Reload the page; if it keeps failing, open Settings › Plugins.`}
            data-destination-load-error={folder.id}
            actions={
              <>
                <Button type="button" size="sm" variant="outline" onClick={() => window.location.reload()}>
                  Reload
                </Button>
                {props.openPlugins === undefined ? null : (
                  <Button type="button" size="sm" variant="ghost" onClick={props.openPlugins}>
                    Open Plugins
                  </Button>
                )}
              </>
            }
          />
        ) : null}
        {settingsNavigation !== undefined ? (
          <SettingsColumnList
            navigation={settingsNavigation}
            folder={folder}
            entries={mapped}
            activePanelId={props.activePanelId}
            openEntry={props.openEntry}
            selectPanel={props.selectPanel}
            folderUi={folderUi}
            rows={rows}
            addPanel={folderUi === undefined || resolved === undefined ? null : <AddPanelButton folder={resolved} ui={folderUi} />}
          />
        ) : empty && folderUi === undefined ? (
          missingPage === undefined ? <EmptyState>No page here yet. Plugins add their pages to this list.</EmptyState> : null
        ) : (
          <nav aria-label={`${folder.label} pages`} className="dshx:flex dshx:flex-col dshx:gap-0.5">
            {settings === null ? null : (
              <SectionButton label="All settings" selected={settingsOnStage} onSelect={settings} />
            )}
            {rows(mapped)}
            {folderUi === undefined || resolved === undefined || props.phone === true ? null : <AddPanelButton folder={resolved} ui={folderUi} />}
          </nav>
        )}
        {unmapped.length === 0 ? null : (
          <section className="dshx:mt-3" aria-label="Other pages">
            <h3 className="dshx:px-2 dshx:pb-1 dshx:text-xs dshx:font-medium dshx:text-muted-foreground">Other pages</h3>
            <div className="dshx:flex dshx:flex-col dshx:gap-0.5">{rows(unmapped)}</div>
          </section>
        )}
        {developer.length === 0 ? null : (
          // In Settings the group's head is one more Settings group head (round nine B1): the same step, indent and 16px
          // above it, no rule of its own; elsewhere it stays a quiet label under a rule.
          <section
            className={folder.id === 'settings' ? 'dshx:mt-4' : 'dshx:mt-3 dshx:border-t dshx:border-border dshx:pt-3'}
            aria-label="Developer"
            data-destination-group="developer"
          >
            <h3 className={folder.id === 'settings' ? SETTINGS_GROUP_HEAD : 'dshx:px-2 dshx:pb-1 dshx:text-xs dshx:font-medium dshx:text-muted-foreground'}>
              Developer
            </h3>
            <div className="dshx:flex dshx:flex-col dshx:gap-0.5">{rows(developer, folder.id === 'settings' ? 'developer' : undefined)}</div>
          </section>
        )}
      </div>
      {folderUi === undefined || resolved === undefined ? null : (
        <FolderDialog
          open={renaming}
          onOpenChange={setRenaming}
          initial={{ title: resolved.title, icon: resolved.icon }}
          onSubmit={(title, icon) => folderUi.actions.updateFolder(resolved.id, { title, icon })}
        />
      )}
    </div>
  )
}

/** Publish the Threads pages (Board) and the customize toggle to the list's Filter menu (productivity pass Q5, T5.3). */
const ThreadsHeaderExtras = (props: {
  readonly entries: readonly ResolvedEntry[]
  readonly activePanelId: string | null
  readonly openEntry: (entry: ResolvedEntry) => void
  readonly renderPanelIcon: DestinationShellProps['renderPanelIcon']
  readonly customizeThreads: DestinationShellProps['customizeThreads']
  readonly scopeSlot: HTMLElement | null
}): null => {
  const { entries, activePanelId, openEntry, renderPanelIcon, customizeThreads, scopeSlot } = props
  useLayoutEffect(
    () =>
      ListHeaderExtras.publish({
        sections: entries.map(entry => ({
          panelId: entry.viewId,
          label: entry.title,
          active: activePanelId === entry.viewId,
          icon: entry.kind === 'page' ? renderPanelIcon(entry.viewId, 16, activePanelId === entry.viewId) : <ViewGlyph />,
          open: () => openEntry(entry),
        })),
        customize: customizeThreads,
        scopeSlot,
      }),
    [entries, activePanelId, openEntry, renderPanelIcon, customizeThreads, scopeSlot],
  )
  return null
}

type ListPaneProps = DestinationShellProps & { readonly folder: RailFolder; readonly openEntry: (entry: ResolvedEntry) => void; readonly phone?: boolean }

const ThreadsPane = (props: ListPaneProps): JSX.Element => {
  // The phone's one toolbar row (council round 10 B1): the list draws its scope button into this seat after the search.
  const [scopeSlot, setScopeSlot] = useState<HTMLElement | null>(null)
  const phone = props.phone === true
  return (
    <div className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:flex-col" data-destination-index="threads">
      <ThreadsHeaderExtras
        entries={props.folder.entries}
        activePanelId={props.activePanelId}
        openEntry={props.openEntry}
        renderPanelIcon={props.renderPanelIcon}
        customizeThreads={props.customizeThreads}
        scopeSlot={phone && props.searchThreads !== null ? scopeSlot : null}
      />
      {/* One search entry above the list (T5.3/T5.4): Board and Customize live in the list's Filter menu. */}
      {props.searchThreads === null ? null : (
        // The phone gutter (round nine B4): fields fill from 12px, their text and glyphs start at 24px. On a phone the row
        // is the list's one toolbar (council round 10 B1): the search and the list's scope button, 8px apart, 6px over the
        // first group head (its own half-leading makes about 12px to the label).
        <div
          className={cn('dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:px-2 dshx:pb-1', phone && 'dshx:gap-2 dshx:px-3 dshx:pb-1.5')}
          data-threads-toolbar=""
        >
          <Button
            // The one control height (round nine B5, kit A4): 32px beside the project and Filter fields, 44px on touch.
            size="field"
            // A launcher that looks like a field is drawn as one (council round 8 B1): the kit field look, so no
            // outline `dark:border-input` replaces the field edge in dark; left-aligned, its label in placeholder ink.
            variant="field"
            className={cn(
              // It stands for a text field, so it keeps the text field's 3:1 edge and paper fill where the value triggers
              // beside it are quiet filled chips (council round 10 A1).
              fieldLook,
              'dshx:min-w-0 dshx:flex-1 dshx:justify-start dshx:text-muted-foreground',
              // On a phone its glyph starts on the 24px text edge (round nine B4).
              phone && 'dshx:gap-2 dshx:px-3',
            )}
            onClick={props.searchThreads}
          >
            <SearchIcon className="dshx:size-3.5" aria-hidden="true" />
            {props.labels.searchThreads}
          </Button>
          {phone ? <div ref={setScopeSlot} data-thread-list-scope="" className="dshx:flex dshx:max-w-[45%] dshx:min-w-0 dshx:shrink-0 dshx:empty:hidden" /> : null}
        </div>
      )}
      <div className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:overflow-hidden dshx:*:w-full dshx:*:min-w-0">{props.threadList}</div>
    </div>
  )
}

const ListPane = (props: ListPaneProps): JSX.Element =>
  props.folder.id === 'threads' ? (
    <ThreadsPane {...props} />
  ) : (
    <FolderIndex
      folder={props.folder}
      activePanelId={props.activePanelId}
      openEntry={props.openEntry}
      openSettings={props.openSettings}
      renderPanelIcon={props.renderPanelIcon}
      folderUi={props.folderUi}
      phone={props.phone === true}
      showDeveloperPages={props.showDeveloperPages}
      openPlugins={() => props.selectPanel('plugins')}
      settingsNavigation={props.settingsNavigation}
      selectPanel={props.selectPanel}
    />
  )

/**
 * The left column (plan §4.1, one sidebar layout b:952m): a labelled rail of folders (the eight destinations and the
 * person's own) and the list of the selected one. Collapsed, only the rail stays, and a folder opens a flyout of its
 * rows; on a phone the rail becomes a bottom tab bar and the list a full screen.
 */
export const DestinationShell = (props: DestinationShellProps): JSX.Element => {
  const destinations = useMemo(() => Destinations.resolve(props.panels, props.contributed), [props.panels, props.contributed])
  const [destinationId, setDestination] = useDestination(destinations, props.activePanelId, props.folderUi)
  const phone = usePhoneLayout()
  const listId = useId()
  const { collapsed, toggleSidebar, folderUi } = props
  const railFolders = useMemo(() => railFoldersOf(destinations, folderUi), [destinations, folderUi])
  const [flyout, setFlyout] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  // Set once the desktop rail renders; the phone tab bar has no rail to choose from.
  const chooseRef = useRef<((next: RailFolder, surface?: NavigationRecord['surface'], openFirst?: boolean) => void) | null>(null)
  useEffect(() => {
    const onGo = (event: Event): void => {
      const next = event instanceof CustomEvent ? event.detail : undefined
      const target = railFolders.find(candidate => candidate.id === next)
      if (target === undefined) return
      if (chooseRef.current !== null) chooseRef.current(target, 'rail', true)
      else {
        setDestination(target.id)
        if (collapsed) toggleSidebar()
      }
      // A key that went somewhere lands focus in that place's list, so J/K work at once (plan Q2 keymap).
      if (isDestinationId(target.id)) {
        const id = target.id
        window.setTimeout(() => focusLanding(id), GO_FOCUS_DELAY_MS)
      }
    }
    window.addEventListener(GO_DESTINATION_EVENT, onGo)
    return () => window.removeEventListener(GO_DESTINATION_EVENT, onGo)
  }, [collapsed, railFolders, setDestination, toggleSidebar])
  useEffect(() => {
    const onShow = (event: Event): void => {
      const next = event instanceof CustomEvent ? event.detail : undefined
      const id = railFolders.find(candidate => candidate.id === next)?.id
      if (id === undefined) return
      setDestination(id)
      if (collapsed) toggleSidebar()
    }
    window.addEventListener(SHOW_DESTINATION_EVENT, onShow)
    return () => window.removeEventListener(SHOW_DESTINATION_EVENT, onShow)
  }, [collapsed, toggleSidebar, setDestination, railFolders])
  // Reset layout (Workbench) brings the default Sidebar pane back: show its thread list, the list a Reset recovers.
  useEffect(() => WorkbenchPorts.layoutReset().subscribe(() => setDestination(HOME_DESTINATION)), [setDestination])
  useEffect(() => {
    const onNewFolder = (): void => {
      if (collapsed) toggleSidebar()
      setCreating(true)
    }
    window.addEventListener(NEW_FOLDER_EVENT, onNewFolder)
    return () => window.removeEventListener(NEW_FOLDER_EVENT, onNewFolder)
  }, [collapsed, toggleSidebar])
  const folder = railFolders.find(candidate => candidate.id === destinationId) ?? railFolders[0]
  // The phone shell and the top bar keep the eight destinations: user folders live in More's tree there.
  const destination = destinations.find(candidate => candidate.id === destinationId) ?? destinations[0]
  // One navigation (round five B1, B2): Settings and a one-page destination fold the column to the rail while their
  // page is on the stage. A phone has no column beside the stage.
  const stageFolded = useStageFold(
    folder !== undefined &&
      StageFold.wants({
        folderId: folder.id,
        builtIn: folder.builtIn,
        activePanelId: props.activePanelId,
        settingsPanelId: SETTINGS_PANEL_ID,
        solePanelId: soleEntry(folder),
      }),
    collapsed,
    toggleSidebar,
    !phone,
  )
  if (folder === undefined || destination === undefined) return <></>
  const openSection = (panelId: string, surface: NavigationRecord['surface'] = 'index'): void => {
    props.selectPanel(panelId)
    if (isDestinationId(folder.id)) props.record({ destination: folder.id, section: panelId, surface })
  }
  const openEntryIn =
    (owner: RailFolder) =>
    (entry: ResolvedEntry): void => {
      if (entry.kind === 'page') {
        props.selectPanel(entry.viewId)
        if (isDestinationId(owner.id)) props.record({ destination: owner.id, section: entry.viewId, surface: 'index' })
      } else folderUi?.open(entry)
    }
  if (phone) {
    chooseRef.current = null
    return (
      <PhoneNavigation
        {...props}
        destinations={destinations}
        destination={destination}
        setDestination={setDestination}
        openSection={openSection}
        railFolders={railFolders}
        openEntryIn={openEntryIn}
      />
    )
  }
  const choose = (next: RailFolder, surface: NavigationRecord['surface'] = 'rail', openFirst = false): void => {
    // Collapsed, a folder of pages opens a flyout of its rows instead of the whole column (b:952m). A column the stage
    // folded behaves as open: the next destination's page decides whether it stays folded.
    const handCollapsed = props.collapsed && !stageFolded
    // The folded destination's own item again opens its list: Settings' other pages stay one click away.
    if (stageFolded && next.id === folder.id) {
      props.toggleSidebar()
      return
    }
    if (handCollapsed && folderUi !== undefined && next.id !== 'threads' && next.id !== 'settings' && next.entries.length > 0 && !openFirst) {
      setFlyout(current => (current === next.id ? null : next.id))
      return
    }
    setDestination(next.id)
    if (handCollapsed) props.toggleSidebar()
    // G then a key opens the destination's first page too: a keyboard user has no index to click through.
    const firstPage = next.entries.find(entry => entry.kind === 'page')?.viewId
    const sole = soleEntry(next) ?? (openFirst && next.id !== 'threads' && next.id !== 'settings' ? firstPage : undefined)
    // Settings is one page in the stage (plan §4.6): the rail opens it at once, its list keeps the deep links.
    if (next.id === 'settings') openSettingsPage()
    if (!isDestinationId(next.id)) {
      if (sole !== undefined) props.selectPanel(sole)
      return
    }
    if (sole === undefined) props.record({ destination: next.id, surface })
    else {
      props.selectPanel(sole)
      props.record({ destination: next.id, section: sole, surface })
    }
  }
  chooseRef.current = choose
  // One chrome (round five B1): folding the column never changes the rail. It keeps its labels, its order and its
  // active item; only the list beside it hides (sidebar-fold.ts).
  const railButton = (candidate: RailFolder): JSX.Element => {
    const active = candidate.id === folder.id
    const button = (
      <RailButton
        key={candidate.id}
        folder={candidate}
        active={active}
        // The bottom cluster (New folder, the rail actions, Settings) is glyphs only, each with its tooltip: label all of
        // a cluster or none of it (council round 4 B6).
        showLabel={!candidate.bottom}
        controls={props.collapsed ? undefined : listId}
        icon={folderIcon(props, candidate, active)}
        onSelect={() => choose(candidate)}
        onDropView={folderUi === undefined || candidate.id === 'threads' ? undefined : viewId => folderUi.actions.movePanel(viewId, candidate.id)}
      />
    )
    if (!props.collapsed || stageFolded || folderUi === undefined) return button
    return (
      <Popover key={candidate.id} open={flyout === candidate.id} onOpenChange={open => setFlyout(open ? candidate.id : null)}>
        <PopoverAnchor asChild>
          <div>{button}</div>
        </PopoverAnchor>
        <PopoverContent side="right" align="start" className="dshx-root dshx:w-64 dshx:p-1" aria-label={candidate.label} data-sidebar-flyout={candidate.id}>
          <h2 className="dshx:px-2.5 dshx:pt-1 dshx:pb-1.5 dshx:text-xs dshx:font-medium dshx:text-muted-foreground">{candidate.label}</h2>
          <nav aria-label={`${candidate.label} pages`} className="dshx:flex dshx:flex-col dshx:gap-0.5">
            <EntryRows
              folder={candidate}
              entries={candidate.entries}
              activePanelId={props.activePanelId}
              openEntry={entry => {
                setFlyout(null)
                openEntryIn(candidate)(entry)
              }}
              renderPanelIcon={props.renderPanelIcon}
              folderUi={undefined}
              descriptions={false}
            />
          </nav>
        </PopoverContent>
      </Popover>
    )
  }
  const hiddenFolders = folderUi?.folders.filter(candidate => candidate.hidden) ?? []
  return (
    <div className="dshx:flex dshx:min-h-0 dshx:w-full dshx:min-w-0 dshx:flex-1" data-destination-shell="">
      <nav
        aria-label="Destinations"
        className={cn(
          'dshx:flex dshx:min-h-0 dshx:shrink-0 dshx:flex-col dshx:overflow-y-auto dshx:pb-2 dshx:[scrollbar-width:none]',
          // One width open and folded: the frame's folded track (60px, frame-layout's SIDEBAR_COLLAPSED) holds the rail
          // whole (round five B1, B3). Unpadded buttons: "Knowledge", the longest destination, fits whole at the label
          // size (productivity pass Q5, T5.3).
          'dshx:w-15 dshx:px-0',
          // One rail surface open and folded, on every destination (council round 4 B2): the panel step the frame's folded
          // track paints, not the base of the pane the open column sits in.
          'dshx:bg-[var(--dsw-specific-sidebar-fill)]',
        )}
        data-stage-folded={stageFolded ? '' : undefined}
      >
        {/* New thread sits in the header row, which a folded column keeps over the stage; where it cannot (no tab strip,
            zen mode) the rail keeps it reachable (client.css). */}
        {props.collapsed && props.showNewThread ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={props.labels.newThread}
                data-sidebar-folded-new-thread=""
                className="dshx:mb-1 dshx:w-full dshx:shrink-0"
                onClick={props.startSession}
              >
                <SquarePenIcon className="dshx:size-[18px]" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{props.labels.newThread}</TooltipContent>
          </Tooltip>
        ) : null}
        <div role="tablist" aria-orientation="vertical" aria-label="Destinations" className="dshx:flex dshx:flex-1 dshx:flex-col dshx:gap-0.5">
          {railFolders.filter(candidate => !candidate.bottom).map(railButton)}
          <div className="dshx:mt-auto dshx:flex dshx:flex-col dshx:pt-2">
            {/* The labelled destinations and the glyph-only bottom cluster are two instruments: one hairline between
                them, inset like the icon tiles (round five B3). */}
            <div aria-hidden="true" data-rail-divider="" className="dshx:mx-3 dshx:mb-1.5 dshx:border-t dshx:border-border" />
            {folderUi === undefined ? null : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    aria-label="New sidebar folder"
                    data-sidebar-new-folder=""
                    onClick={() => setCreating(true)}
                    className="dshx:flex dshx:w-full dshx:shrink-0 dshx:flex-col dshx:items-center dshx:gap-0.5 dshx:rounded-md dshx:py-1.5 dshx:text-muted-foreground dshx:outline-none dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring"
                  >
                    <PlusIcon className="dshx:size-4" strokeWidth={1.5} aria-hidden="true" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right">New sidebar folder</TooltipContent>
              </Tooltip>
            )}
            <RailActionGroup actions={props.railActions ?? NO_RAIL_ACTIONS} />
            {railFolders.filter(candidate => candidate.bottom).map(railButton)}
          </div>
        </div>
      </nav>
      {props.collapsed ? null : (
        // Every navigation column sits on the nav surface (round five B5, kit A4); the page beside it is on stage.
        <div id={listId} role="tabpanel" aria-label={folder.label} className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:surface-nav">
          <ListPane {...props} folder={folder} openEntry={openEntryIn(folder)} />
          {folderUi === undefined ? null : <FolderNotice notice={folderUi.notice} dismiss={folderUi.dismissNotice} />}
        </div>
      )}
      {folderUi === undefined ? null : (
        <FolderDialog
          open={creating}
          onOpenChange={setCreating}
          hidden={hiddenFolders}
          onShow={id => folderUi.actions.updateFolder(id, { hidden: false })}
          onSubmit={(title, icon) => folderUi.actions.createFolder(title, icon)}
        />
      )}
    </div>
  )
}

/** Phone tab bar (productivity pass E8): Threads, Inbox (with its count), Land, More; New is the `+` in the Threads header. */
export const PHONE_TABS = ['threads', 'inbox', 'land', 'more'] as const
/**
 * The current phone tab's seat (council round 13 B2): one neutral pill on every tab, the secondary ink at 14% (what
 * Inbox already drew), so the selection never changes colour between tabs. The glyph on it carries the tab's tone;
 * Inbox and More, the neutral destinations, draw ink. Tone glyphs keep 3:1 on it (list-colour-contrast.test.ts).
 */
export const PHONE_TAB_PILL = 'dshx:bg-[color-mix(in_oklab,var(--dsw-alias-label-secondary)_14%,transparent)]'
type PhoneTab = (typeof PHONE_TABS)[number]
/** The destinations with a tab of their own; More lists the rest. */
const TABBED_DESTINATIONS: readonly DestinationId[] = ['threads', 'inbox', 'land']

/**
 * Phone: Threads, Inbox, Land and More along the bottom. Threads, Inbox and Land open their list full screen; opening
 * a thread or a page closes it again, so the stage is pushed. The list is the frame's left column "expanded" state,
 * so the frame's own reveal (Reset layout, recovery) opens it too. New thread is the `+` in the Threads header.
 */
const PhoneNavigation = (
  props: DestinationShellProps & {
    readonly destinations: readonly ResolvedDestination[]
    readonly destination: ResolvedDestination
    readonly setDestination: (next: string) => void
    readonly openSection: (panelId: string, surface?: NavigationRecord['surface']) => void
    readonly railFolders: readonly RailFolder[]
    readonly openEntryIn: (owner: RailFolder) => (entry: ResolvedEntry) => void
  },
): JSX.Element => {
  // Drawer mode: the list is a drawer over the stage, so "list open" means the drawer is open. That is this component's
  // own state, not the frame's left column: flipping the column re-renders the frame and the whole sidebar (a 100-180ms
  // task at 4x CPU throttle), which would stall the slide. The column stays collapsed; a frame reveal opens the drawer.
  const drawer = props.phoneNavigation === 'drawer'
  const [drawerOpen, setDrawerOpen] = useState(false)
  const listOpen = drawer ? drawerOpen : !props.collapsed
  const toggleDrawer = useRef((): void => setDrawerOpen(open => !open)).current
  const toggleSidebar = drawer ? toggleDrawer : props.toggleSidebar
  const drawerId = useId()
  const sidebarButton = useRef<HTMLButtonElement>(null)
  // The drawer's list mounts once (an edge touch, the button, a thread link, or idle time) and then stays, hidden.
  const [drawerMounted, setDrawerMounted] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  // More's tree (b:952m): the folders whose rows are shown inline, by id.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  // The list is the frame's left column, flipped by a toggle; inside a View Transition that toggle runs a frame later,
  // so several requests in one gesture (the pick effect and the tap handler) must still flip it once.
  const listOpenRef = useRef(listOpen)
  listOpenRef.current = listOpen
  const stackMotionPending = useRef(false)
  const moveStack = (motion: 'push' | 'pop', open: boolean, before?: () => void): void => {
    // The drawer slides itself; no View Transition of the whole page.
    if (drawer) {
      before?.()
      if (listOpenRef.current !== open) {
        listOpenRef.current = open
        toggleSidebar()
      }
      return
    }
    if (stackMotionPending.current) {
      before?.()
      return
    }
    stackMotionPending.current = true
    runStackMotion(motion, () => {
      stackMotionPending.current = false
      before?.()
      if (listOpenRef.current !== open) {
        listOpenRef.current = open
        toggleSidebar()
      }
    })
  }
  /** Push the stage over the list (a thread or page was picked): close the list once. */
  const pushStage = (): void => moveStack('push', false)
  // The selection effect below pushes with the latest stack mover without re-running on its identity.
  const pushStageLatest = useRef(pushStage)
  pushStageLatest.current = pushStage
  useLayoutEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-shell-phone-nav', '')
    root.style.setProperty('--dsh-phone-nav-height', PHONE_NAV_HEIGHT)
    root.style.setProperty('--dsh-phone-top-height', PHONE_TOP_HEIGHT)
    // Safe-area insets only resolve under viewport-fit=cover; the bars pad by them (home indicator, notch, landscape).
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
    const previous = meta?.getAttribute('content') ?? null
    if (meta !== null && previous !== null && !/viewport-fit\s*=/u.test(previous)) meta.setAttribute('content', `${previous}, viewport-fit=cover`)
    return () => {
      root.removeAttribute('data-shell-phone-nav')
      root.style.removeProperty('--dsh-phone-nav-height')
      root.style.removeProperty('--dsh-phone-top-height')
      if (meta !== null && previous !== null) meta.setAttribute('content', previous)
    }
  }, [])
  // Only the Threads list resolves a page loaded on a thread link, and it is unmounted while the stage covers it: a
  // reload inside a thread restored the previous stage (often a New thread) and ignored the link. Show the list first;
  // resolving the link selects the thread, which pushes the stage like a tap.
  useLayoutEffect(() => {
    const linked = pageLoadThreadRoute.pending(window.location.href)
    // The drawer's home is the stage: a page load starts with it closed, its list mounted hidden for a thread link.
    if (drawer) {
      if (!props.collapsed) props.toggleSidebar()
      if (linked === null || linked === props.selectedThreadId) return
      props.setDestination('threads')
      setDrawerMounted(true)
      return
    }
    if (linked === null || linked === props.selectedThreadId) return
    if (props.destination.id !== 'threads') props.setDestination('threads')
    if (listOpenRef.current) return
    listOpenRef.current = true
    toggleSidebar()
  }, [])
  // A frame reveal (Reset layout, a palette "Go to…", recovery) expands the column: in drawer mode that opens the drawer
  // on the list it chose, and the column folds back. The page-load fold above is not a reveal.
  const revealSeen = useRef(false)
  const { collapsed, toggleSidebar: toggleColumn } = props
  useEffect(() => {
    if (!revealSeen.current) {
      revealSeen.current = true
      return
    }
    if (!drawer || collapsed) return
    setDrawerMounted(true)
    listOpenRef.current = true
    setDrawerOpen(true)
    toggleColumn()
  }, [drawer, collapsed, toggleColumn])
  useSoftwareKeyboard()
  useStandaloneStatusBar()
  // Opening a thread or a page from the list pushes the stage: close the list.
  const shown = useRef({
    thread: props.selectedThreadId,
    panel: props.activePanelId,
    stage: props.stageThreadId ?? null,
    session: props.stageSessionId ?? null,
  })
  // A thread opened from a page on the stage (an Inbox item's Open) remembers that page for Back; any other route
  // to a thread (the list, New, the palette) forgets it.
  const [origin, setOrigin] = useState<{ readonly panelId: string } | undefined>(undefined)
  useEffect(() => {
    // A selection that only catches up with the thread already on the stage (a draft's first message created it, or a
    // typed draft was kept as a Session when Back opened the list) is not a pick: it must not close a list the user
    // just opened. The stage it is compared with is the previous render's, so a real pick, which moves the stage in
    // the same render, still closes the list.
    const caughtUp =
      shown.current.panel === props.activePanelId &&
      props.selectedThreadId !== null &&
      (props.selectedThreadId === shown.current.stage || props.selectedThreadId === shown.current.session)
    const changed = !caughtUp && (shown.current.thread !== props.selectedThreadId || shown.current.panel !== props.activePanelId)
    const from = shown.current.panel
    const owned = (panelId: string | null): boolean => panelId !== null && Destinations.owning(props.destinations, panelId) !== undefined
    if (changed) setOrigin(!listOpen && owned(from) && !owned(props.activePanelId) && from !== null ? { panelId: from } : undefined)
    shown.current = { thread: props.selectedThreadId, panel: props.activePanelId, stage: props.stageThreadId ?? null, session: props.stageSessionId ?? null }
    if (changed && listOpen) {
      setMoreOpen(false)
      pushStageLatest.current()
    }
  }, [props.selectedThreadId, props.activePanelId, props.stageThreadId, props.stageSessionId, listOpen, toggleSidebar, props.destinations])
  const open = (next: DestinationId): void => {
    props.setDestination(next)
    setMoreOpen(false)
    const target = props.destinations.find(candidate => candidate.id === next)
    const sole = target === undefined ? undefined : soleSection(target)
    // Settings opens its page in the stage, which closes the list, like a destination with one page.
    // Already on stage, the page does not change, so nothing else closes the list.
    const alreadyShown = props.activePanelId === SETTINGS_PANEL_ID
    if (next === 'settings' && openSettingsPage()) {
      props.record({ destination: next, surface: 'tab-bar' })
      if (alreadyShown && listOpen) toggleSidebar()
      return
    }
    if (sole !== undefined) {
      // The page is the list: show it in the stage, which closes the list.
      props.record({ destination: next, section: sole, surface: 'tab-bar' })
      props.selectPanel(sole)
      return
    }
    props.record({ destination: next, surface: 'tab-bar' })
    if (!listOpen) toggleSidebar()
  }
  const stageOwner = Destinations.owning(props.destinations, props.activePanelId)?.id
  /**
   * The highlighted tab: with the list closed, an Inbox or Land page in the stage, or More for Settings and any other
   * destination's page (council round 3 B6: you reached it through More); with it open, the shown destination.
   */
  const currentTab = (): PhoneTab | null => {
    if (!listOpen) {
      if (stageOwner === 'inbox' || stageOwner === 'land') return stageOwner
      const morePage = props.activePanelId === SETTINGS_PANEL_ID || (stageOwner !== undefined && stageOwner !== 'threads')
      return morePage ? 'more' : null
    }
    if (moreOpen || !TABBED_DESTINATIONS.includes(props.destination.id)) return 'more'
    return props.destination.id === 'inbox' ? 'inbox' : props.destination.id === 'land' ? 'land' : 'threads'
  }
  const current = currentTab()
  const startThread = (): void => {
    props.startSession()
    if (listOpen) pushStage()
  }
  const select = (tab: PhoneTab): void => {
    if (tab === 'more') {
      if (current === 'more' && moreOpen) {
        setMoreOpen(false)
        toggleSidebar()
        return
      }
      setMoreOpen(true)
      if (!listOpen) toggleSidebar()
      return
    }
    // A second tap on the open tab goes back to the stage.
    if (current === tab) {
      toggleSidebar()
      return
    }
    open(tab)
  }
  const tabLabel = { threads: 'Threads', inbox: 'Inbox', land: 'Land', more: 'More' } satisfies Record<PhoneTab, string>
  const tabIcon = (tab: PhoneTab): ReactNode => {
    if (tab === 'more') return <EllipsisIcon className="dshx:size-5" strokeWidth={1.5} />
    const target = props.destinations.find(candidate => candidate.id === tab)
    return target === undefined ? null : destinationIcon(props, target, current === tab, 20)
  }
  // A profile without a Land page keeps three tabs rather than a dead one.
  const tabs = PHONE_TABS.filter(tab => tab === 'more' || props.destinations.some(candidate => candidate.id === tab))
  // The phone list shows the selected destination as its folder; a user folder lives in More's tree.
  const phoneFolder =
    props.railFolders.find(candidate => candidate.id === props.destination.id) ??
    ({
      id: props.destination.id,
      label: props.destination.label,
      description: props.destination.description,
      icon: props.destination.icon,
      builtIn: true,
      bottom: props.destination.bottom === true,
      destination: props.destination,
      entries: entriesOfSections(props.destination),
    } satisfies RailFolder)
  // More: every folder without a tab of its own, in rail order, user folders included; each expands to its rows.
  const others = props.railFolders.filter(candidate => !TABBED_DESTINATIONS.some(tabbed => tabbed === candidate.id))
  // New thread sits in the Threads list header (E8); ⌘⇧O and `c` keep starting one on a keyboard.
  const showNew = listOpen && !moreOpen && props.destination.id === 'threads'
  // The status control (council round 3 B6, frame-layout C2): a 44px button in the Threads bar opens the status sheet,
  // instead of a permanent band above the tab bar. Without frame-layout the bar shows none.
  const phoneStatus = useContract(PhoneStatus)
  const stack = {
    listOpen,
    moreOpen,
    destination: props.destination,
    destinations: props.destinations,
    activePanelId: props.activePanelId,
    selectedThreadId: props.stageThreadId === undefined ? props.selectedThreadId : props.stageThreadId,
    stageTitle: props.stageTitle,
    pendingTitle: props.pendingTitle,
    origin,
  }
  const bar = PhoneTopBarModel.resolve(stack)
  // The drawer never covers the stage, so its top bar always names what the stage shows.
  const stageBar = drawer ? PhoneTopBarModel.resolve({ ...stack, listOpen: false, moreOpen: false }) : bar
  // A page or a list centres its title (council round 4 B3); a thread's title leads, after the back chevron.
  const centred = !(stageBar.thread && (drawer || !listOpen))
  // Only a thread's title carries a second line; a page or a list keeps its one centred line.
  const subtitle = centred ? undefined : props.stageSubtitle
  // Drawer mode keeps one Back: a thread opened from a page on the stage (an Inbox item's Open) returns to that page.
  const pageBack = drawer && stageBar.back?.to === 'page' ? stageBar.back : null
  const backToPage = (): void => {
    if (pageBack === null) return
    setOrigin(undefined)
    props.selectPanel(pageBack.panelId)
  }
  const openDrawer = (): void => {
    setDrawerMounted(true)
    props.setDestination('threads')
    setMoreOpen(false)
    if (listOpenRef.current) return
    listOpenRef.current = true
    toggleSidebar()
  }
  const closeDrawer = (): void => {
    if (!listOpenRef.current) return
    listOpenRef.current = false
    toggleSidebar()
  }
  // Inside the drawer, More and the lists opened from it go back towards Threads; Threads itself closes.
  const drawerView: 'threads' | 'more' | 'list' = moreOpen ? 'more' : props.destination.id === 'threads' ? 'threads' : 'list'
  const drawerBackTo = drawerView === 'list' && !TABBED_DESTINATIONS.includes(props.destination.id) ? 'more' : 'threads'
  const drawerBack = (): void => {
    if (drawerView === 'threads') {
      closeDrawer()
      return
    }
    props.setDestination('threads')
    setMoreOpen(drawerBackTo === 'more' && drawerView === 'list')
  }
  useEffect(() => {
    if (!drawer || drawerMounted) return
    const idle = window.requestIdleCallback?.(() => setDrawerMounted(true), { timeout: 2000 })
    const timer = idle === undefined ? window.setTimeout(() => setDrawerMounted(true), 1000) : undefined
    return () => {
      if (idle !== undefined) window.cancelIdleCallback(idle)
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [drawer, drawerMounted])
  // Back pops one level of the stack: the stage returns to the list it came from, a destination list to More.
  const back = (): void => {
    const target = bar.back
    if (target === null) return
    if (target.to === 'page') {
      runStackMotion('pop', () => {
        setOrigin(undefined)
        props.selectPanel(target.panelId)
      })
      return
    }
    if (target.to === 'more') {
      moveStack('pop', true, () => setMoreOpen(true))
      return
    }
    const destination = target.to
    moveStack('pop', true, () => {
      props.setDestination(destination)
      setMoreOpen(false)
      props.record({ destination, surface: 'back' })
    })
  }
  // The iOS back swipe (T5.3): a left-edge swipe is Back wherever the bar offers one.
  useEdgeSwipe({ side: 'left', enabled: !drawer && bar.back !== null, onSwipe: back })
  // Android's back gesture (and a browser Back) pops the same stack: each level is one history entry. A push drops the
  // thread from the entry it leaves below, so going back never switches to another thread through the URL route.
  // In drawer mode the open drawer is one level (two inside More or a list opened there): system Back closes it first.
  const drawerDepth = (pageBack === null ? 0 : 1) + (listOpen ? (drawerView === 'threads' ? 1 : 2) : 0)
  const depth = drawer ? drawerDepth : PhoneTopBarModel.depth(stack)
  const drawerPop = (): void => (listOpen ? drawerBack() : backToPage())
  usePhoneHistoryLayer({ key: 'dshfilesPhoneStack', depth, enabled: true, pop: drawer ? drawerPop : back, baseUrl: clearThreadUrl })
  // Inside a thread the stage owns the bottom edge (plan phone rules): no tab bar, Back returns to the list.
  const inThread = !listOpen && stageBar.thread
  // The drawer holds every destination, so drawer mode has no tab bar at all.
  const tabBar = !drawer && !inThread
  useLayoutEffect(() => {
    const root = document.documentElement
    root.toggleAttribute('data-phone-in-thread', inThread)
    root.style.setProperty('--dsh-phone-nav-height', tabBar ? PHONE_NAV_HEIGHT : PHONE_NAV_HIDDEN_HEIGHT)
    return () => root.removeAttribute('data-phone-in-thread')
  }, [inThread, tabBar])
  const togglePanels = props.togglePanels ?? null
  // The thread panel from the right edge (opt-in); an open sheet is modal, so the swipe never closes it again.
  useEdgeSwipe({ side: 'right', enabled: inThread && props.edgeSwipePanels === true && togglePanels !== null, onSwipe: () => togglePanels?.() })
  // Tapping the row of the thread (or the page) already on the stage changes no selection, so the effect above would
  // leave the list open: close it after the click, unless the selection change already did.
  const closeAfterPick = (event: React.MouseEvent<HTMLElement>): void => {
    if (!(event.target instanceof Element) || event.target.closest('[data-thread-main-action], [data-section]') === null) return
    requestAnimationFrame(() => {
      if (listOpenRef.current) pushStage()
    })
  }
  const listContent = moreOpen ? (
    <nav aria-label="More destinations" className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:overflow-y-auto dshx:px-2 dshx:pb-2">
      <EntityList aria-label="More destinations">
        {others.map(candidate => {
          const shown = expanded.has(candidate.id)
          const rowsId = `more-${candidate.id}`
          const toggle = (): void =>
            setExpanded(current => {
              const next = new Set(current)
              if (next.has(candidate.id)) next.delete(candidate.id)
              else next.add(candidate.id)
              return next
            })
          return (
            <div key={candidate.id} role="listitem">
              <div className="dshx:flex dshx:items-center">
                <div className="dshx:min-w-0 dshx:flex-1">
                  <EntityRow
                    data-destination={candidate.id}
                    leading={
                      <span className="dshx:inline-flex dshx:size-5 dshx:items-center dshx:justify-center dshx:text-muted-foreground">
                        {folderIcon(props, candidate, false)}
                      </span>
                    }
                    heading={candidate.label}
                    description={candidate.description}
                    trailing={candidate.builtIn ? <ChevronRightIcon className="dshx:size-4 dshx:text-muted-foreground" aria-hidden="true" /> : null}
                    onSelect={() => (candidate.builtIn && isDestinationId(candidate.id) ? open(candidate.id) : toggle())}
                  />
                </div>
                {candidate.entries.length === 0 ? null : (
                  <button
                    type="button"
                    aria-label={`${shown ? 'Hide' : 'Show'} ${candidate.label} pages`}
                    aria-expanded={shown}
                    aria-controls={rowsId}
                    data-more-expand={candidate.id}
                    onClick={toggle}
                    className="dshx:flex dshx:size-11 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:text-muted-foreground dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:active:bg-accent"
                  >
                    <ChevronDownIcon className={cn('dshx:size-4 dshx:transition-transform', shown && 'dshx:rotate-180')} aria-hidden="true" />
                  </button>
                )}
              </div>
              {shown ? (
                <nav
                  id={rowsId}
                  aria-label={`${candidate.label} pages`}
                  data-more-folder={candidate.id}
                  className="dshx:flex dshx:flex-col dshx:gap-0.5 dshx:pb-1 dshx:pl-6"
                >
                  <EntryRows
                    folder={candidate}
                    entries={candidate.entries}
                    activePanelId={props.activePanelId}
                    openEntry={entry => {
                      if (entry.kind !== 'page') {
                        // A thread facet opens in the thread panel's sheet; the list closes over the stage.
                        props.openEntryIn(candidate)(entry)
                        setMoreOpen(false)
                        pushStage()
                        return
                      }
                      props.openEntryIn(candidate)(entry)
                    }}
                    renderPanelIcon={props.renderPanelIcon}
                    folderUi={undefined}
                    descriptions={false}
                  />
                </nav>
              ) : null}
            </div>
          )
        })}
      </EntityList>
      <PhoneRailActions actions={props.railActions ?? NO_RAIL_ACTIONS} />
    </nav>
  ) : (
    <ListPane
      {...props}
      phone
      folder={phoneFolder}
      openEntry={entry => (entry.kind === 'page' ? props.openSection(entry.viewId, 'index') : props.openEntryIn(phoneFolder)(entry))}
    />
  )
  // The drawer's own header: close (or back inside More), the view's name and New thread; Threads lists the other
  // destinations above the threads, since drawer mode has no tab bar.
  const drawerLinks = (['inbox', 'land'] as const).flatMap(id => {
    const target = props.destinations.find(candidate => candidate.id === id)
    return target === undefined ? [] : [target]
  })
  const drawerButtonClass =
    'dshx:flex dshx:size-11 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:text-muted-foreground dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:active:bg-accent'
  const drawerRowClass =
    'dshx:flex dshx:h-11 dshx:w-full dshx:items-center dshx:gap-3 dshx:rounded-md dshx:px-2.5 dshx:text-left dshx:text-sm dshx:text-foreground dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:active:bg-accent'
  const drawerElement = (
    <PhoneDrawer
      id={drawerId}
      label={drawerView === 'more' ? 'More' : props.destination.label}
      open={listOpen}
      onOpenChange={next => (next ? openDrawer() : closeDrawer())}
      swipeToOpen={!listOpen}
      onPrepare={() => setDrawerMounted(true)}
      restoreFocus={() => sidebarButton.current?.focus({ preventScroll: true })}
    >
      <header data-phone-drawer-header="" className="dshx:flex dshx:h-11 dshx:shrink-0 dshx:items-center dshx:gap-0.5 dshx:px-1">
        {drawerView === 'threads' ? (
          <button type="button" data-phone-drawer-close="" aria-label="Hide threads" onClick={closeDrawer} className={drawerButtonClass}>
            <PanelLeftIcon className="dshx:size-5" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            data-phone-drawer-back=""
            aria-label={`Back to ${drawerBackTo === 'more' ? 'More' : 'Threads'}`}
            onClick={drawerBack}
            className={drawerButtonClass}
          >
            <ChevronLeftIcon className="dshx:size-5" aria-hidden="true" />
          </button>
        )}
        <h2 className="dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-heading">
          {drawerView === 'more' ? 'More' : props.destination.label}
        </h2>
        {drawerView === 'threads' ? (
          <button type="button" data-phone-new="" aria-label="New thread" onClick={startThread} className={cn(drawerButtonClass, 'dshx:text-foreground')}>
            <PlusIcon className="dshx:size-5" strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : null}
      </header>
      {drawerView === 'threads' ? (
        <nav aria-label="Destinations" data-phone-drawer-destinations="" className="dshx:flex dshx:shrink-0 dshx:flex-col dshx:px-2 dshx:pb-2">
          {drawerLinks.map(target => (
            <button key={target.id} type="button" data-phone-drawer-destination={target.id} onClick={() => open(target.id)} className={drawerRowClass}>
              <span className="dshx:inline-flex dshx:size-5 dshx:items-center dshx:justify-center dshx:text-muted-foreground" aria-hidden="true">
                {destinationIcon(props, target, false, 20)}
              </span>
              {target.label}
            </button>
          ))}
          <button type="button" data-phone-drawer-destination="more" onClick={() => setMoreOpen(true)} className={drawerRowClass}>
            <span className="dshx:inline-flex dshx:size-5 dshx:items-center dshx:justify-center dshx:text-muted-foreground" aria-hidden="true">
              <EllipsisIcon className="dshx:size-5" strokeWidth={1.5} />
            </span>
            More
          </button>
        </nav>
      ) : null}
      <div data-phone-list="" onClick={closeAfterPick} className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col">
        {drawerMounted || listOpen ? listContent : null}
      </div>
    </PhoneDrawer>
  )
  return createPortal(
    <div className="dshx-root">
      <header
        data-phone-top-bar=""
        data-phone-stage={listOpen && !drawer ? undefined : stageBar.thread ? 'thread' : (props.activePanelId ?? 'none')}
        className={cn(
          'dshx:fixed dshx:inset-x-0 dshx:top-0 dshx:z-[41] dshx:flex dshx:translate-y-[var(--dsh-visual-offset-top,0px)] dshx:items-end dshx:border-b dshx:border-border dshx:bg-background dshx:pt-[env(safe-area-inset-top,0px)] dshx:pl-[max(4px,env(safe-area-inset-left,0px))] dshx:text-foreground',
          // A thread on the stage puts its Changes pill and one `⋯` menu (rich-composer, T1.4/T3.2) in the trailing
          // corner, publishing that bar's width; the status strip is a pill above the tab bar (frame-layout, T1.6).
          stageBar.thread && (drawer || !listOpen) ? 'dshx:pr-[calc(var(--dsh-phone-bar-width,44px)+4px)]' : 'dshx:pr-1',
        )}
        style={{ height: PHONE_TOP_HEIGHT }}
      >
        {/* A page or a list centres its title between the way back and the trailing controls (council round 4 B3); a
            thread's title starts 12px after the back chevron, its length needs the width. */}
        <div
          data-phone-bar-layout={centred ? 'centred' : 'leading'}
          className={cn(
            // Back and title read at 17px (council round 4 B3); the title adds the weight.
            'dshx:h-11 dshx:w-full dshx:min-w-0 dshx:items-center dshx:text-[17px] dshx:leading-[22px]',
            centred ? 'dshx:grid dshx:grid-cols-[minmax(0,1fr)_minmax(0,auto)_minmax(0,1fr)] dshx:gap-1' : 'dshx:flex dshx:gap-0.5',
          )}
        >
          <div className={centred ? 'dshx:flex dshx:min-w-0 dshx:items-center dshx:justify-self-start' : 'dshx:contents'}>
          {pageBack === null ? null : (
            <button
              type="button"
              data-phone-back=""
              aria-label={`Back to ${pageBack.label}`}
              onClick={backToPage}
              className="dshx:flex dshx:size-11 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:text-muted-foreground dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:active:bg-accent"
            >
              <ChevronLeftIcon className="dshx:size-5" aria-hidden="true" />
            </button>
          )}
          {drawer ? (
            <button
              ref={sidebarButton}
              type="button"
              data-phone-sidebar=""
              aria-label="Show threads"
              aria-haspopup="dialog"
              aria-expanded={listOpen}
              aria-controls={drawerId}
              onClick={openDrawer}
              className="dshx:flex dshx:size-11 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:text-muted-foreground dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:active:bg-accent"
            >
              <PanelLeftIcon className="dshx:size-5" aria-hidden="true" />
            </button>
          ) : bar.back === null ? null : (
            <button
              type="button"
              data-phone-back=""
              aria-label={`Back to ${bar.back.label}`}
              onClick={back}
              className={cn(
                'dshx:relative dshx:flex dshx:h-11 dshx:shrink-0 dshx:items-center dshx:gap-0.5 dshx:rounded-md dshx:pl-1 dshx:text-muted-foreground dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:active:bg-accent',
                // On a thread the chevron alone goes back, as in other chat apps: 28px wide so the title starts 12px after
                // the glyph, with a 44px touch area that reaches under the title's first pixels.
                bar.thread
                  ? "dshx:w-7 dshx:after:absolute dshx:after:inset-y-0 dshx:after:left-0 dshx:after:w-11 dshx:after:content-['']"
                  : 'dshx:min-w-11 dshx:max-w-full dshx:pr-2',
              )}
            >
              <ChevronLeftIcon className="dshx:size-5 dshx:shrink-0" aria-hidden="true" />
              <span className={cn('dshx:min-w-0 dshx:truncate', bar.thread && 'dshx:sr-only')}>{bar.back.label}</span>
            </button>
          )}
          {/* The status gauge leads, in the seat the Inbox bar gives it (council round 6 B1); + stays trailing. */}
          {showNew && !drawer && phoneStatus.status === 'active' ? <phoneStatus.value.Button /> : null}
          </div>
          {subtitle === undefined ? (
            <h1
              data-phone-title=""
              className={cn(
                PHONE_TITLE_CLASS,
                centred ? 'dshx:text-center' : 'dshx:flex-1',
                !centred && !drawer && bar.back === null && 'dshx:pl-2.5',
              )}
            >
              {stageBar.title}
            </h1>
          ) : (
            // A thread's title over its 13px status line, as the desktop header's title and chip (council round 7 B5).
            <div className={cn('dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:justify-center', !drawer && bar.back === null && 'dshx:pl-2.5')}>
              <h1 data-phone-title="" className={PHONE_TITLE_CLASS}>
                {stageBar.title}
              </h1>
              <p data-phone-subtitle="" className="dshx:m-0 dshx:flex dshx:min-w-0 dshx:items-center dshx:gap-1 dshx:text-sm dshx:leading-4 dshx:text-muted-foreground">
                {subtitle.working ? <StatusGlyph status="working" decorative /> : null}
                <span className="dshx:min-w-0 dshx:truncate">{subtitle.label}</span>
              </p>
            </div>
          )}
          <div className={centred ? 'dshx:flex dshx:min-w-0 dshx:items-center dshx:justify-self-end' : 'dshx:contents'}>
          {showNew && !drawer ? (
            <button
              type="button"
              data-phone-new=""
              aria-label="New thread"
              onClick={startThread}
              className="dshx:flex dshx:size-11 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:text-foreground dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:active:bg-accent"
            >
              <PlusIcon className="dshx:size-5" strokeWidth={1.75} aria-hidden="true" />
            </button>
          ) : null}
          {stageBar.thread && togglePanels !== null ? (
            <button
              type="button"
              data-phone-panels=""
              aria-label="Thread panels"
              onClick={togglePanels}
              className="dshx:flex dshx:size-11 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:text-muted-foreground dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:active:bg-accent"
            >
              <PanelBottomOpenIcon className="dshx:size-5" aria-hidden="true" />
            </button>
          ) : null}
          </div>
        </div>
      </header>
      {listOpen && !drawer ? (
        <div
          data-phone-list=""
          onClick={closeAfterPick}
          className={cn(
            // 12px under the top bar's rule (round nine B4, the phone shell grid).
            'dshx:fixed dshx:inset-x-0 dshx:z-40 dshx:flex dshx:flex-col dshx:bg-(--dsw-specific-sidebar-fill) dshx:pt-3 dshx:text-foreground',
            // The Threads toolbar band measures 48px (council round 11 B2): 4px under the rule, then the 44px search row.
            'dshx:has-[[data-threads-toolbar]]:pt-1',
            // The frame's status pill row (44px, just above the tab bar) stays visible under a full-screen list: the list
            // ends above it whenever the frame draws it (round five, lane C asked), and covers it while the keyboard is up.
            'dshx:[html:not([data-phone-keyboard]):has([data-status-strip=compact])_&]:[--phone-list-status-room:44px]',
          )}
          style={{ top: PHONE_TOP_HEIGHT, bottom: `calc(${PHONE_NAV_HEIGHT} + var(--phone-list-status-room, 0px))` }}
        >
          {listContent}
        </div>
      ) : null}
      {tabBar ? (
        <nav
          aria-label="Destinations"
          data-phone-tab-bar=""
          // Dimmer than content (T1.3): the sidebar fill, a hairline, quiet labels; the current tab is ink, not colour.
          className="dshx:fixed dshx:inset-x-0 dshx:bottom-0 dshx:z-40 dshx:flex dshx:border-t dshx:border-border dshx:bg-(--dsw-specific-sidebar-fill) dshx:pr-[env(safe-area-inset-right,0px)] dshx:pb-[env(safe-area-inset-bottom,0px)] dshx:pl-[env(safe-area-inset-left,0px)] dshx:in-data-phone-keyboard:hidden"
        >
          {tabs.map(tab => (
            <button
              key={tab}
              type="button"
              data-phone-tab={tab}
              aria-current={current === tab ? 'page' : undefined}
              onClick={() => select(tab)}
              className={cn(
                'dshx:flex dshx:h-14 dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:items-center dshx:justify-center dshx:gap-0.5 dshx:text-(--dsw-alias-label-tertiary) dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:focus-visible:ring-inset dshx:active:text-foreground',
                // Colour on the current tab only (council round 12 B3, reversing round nine B3): a tinted glyph reads as
                // "selected" on a phone, so the others rest in tertiary ink. The current glyph takes its destination's tone
                // on one neutral pill (round 13 B2), with an ink label at 600; Inbox and More draw ink. The
                // desktop rail keeps its always-toned glyphs: a launcher, not a tab bar.
                NAV_TONE[tab === 'more' ? 'settings' : tab],
                current === tab && 'dshx:text-foreground',
              )}
            >
              <span
                className={cn(
                  'dshx:inline-flex dshx:h-7 dshx:w-11 dshx:items-center dshx:justify-center dshx:rounded-full',
                  current === tab
                    ? cn(PHONE_TAB_PILL, tab === 'inbox' || tab === 'more' ? 'dshx:text-foreground' : 'dshx:text-nav-tone')
                    : 'dshx:text-(--dsw-alias-label-tertiary)',
                )}
                aria-hidden="true"
                data-phone-tab-seat=""
              >
                {tabIcon(tab)}
              </span>
              <span className={cn('dshx:text-2xs dshx:leading-tight', current === tab && 'dshx:font-semibold')}>{tabLabel[tab]}</span>
            </button>
          ))}
        </nav>
      ) : null}
      {drawer ? drawerElement : null}
    </div>,
    document.body,
  )
}
