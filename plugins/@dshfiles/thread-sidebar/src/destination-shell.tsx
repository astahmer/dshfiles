import { WorkbenchPorts } from '@dshfiles/workbench/shell-merge'
import { usePhoneHistoryLayer } from '@dshfiles/workbench/phone-history'
import { EmptyState } from '@dshfiles/plugin-ui/components/page'
import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
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
  PlusIcon,
  SettingsIcon,
  SearchIcon,
  SquarePenIcon,
  type LucideIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import * as Schema from 'effect/Schema'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import {
  DESTINATION_IDS,
  Destinations,
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
import { PhoneTopBarModel, SETTINGS_PANEL_ID, useSoftwareKeyboard, useStandaloneStatusBar } from './phone-shell.js'
import { useEdgeSwipe } from './edge-swipe.js'
import { runStackMotion } from './stack-motion.js'
import { clearThreadUrl, pageLoadThreadRoute } from './thread-url.js'
import { PhoneRailActions, RailActionGroup, type RailAction } from './rail-actions.js'
import { dispatchOpenSettings } from '@dshfiles/settings-shell/open-settings'

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

const PHONE_QUERY = '(max-width: 639.98px)'

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

const subscribePhone = (listener: () => void): (() => void) => {
  if (typeof window.matchMedia !== 'function') return () => undefined
  const query = window.matchMedia(PHONE_QUERY)
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}
const readPhone = (): boolean => typeof window.matchMedia === 'function' && window.matchMedia(PHONE_QUERY).matches

export const usePhoneLayout = (): boolean => useSyncExternalStore(subscribePhone, readPhone, () => false)

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
  /** The thread the stage shows, as its title (the phone top bar names the stage). */
  readonly stageTitle?: string | undefined
  /** Opens or closes the thread panel (a bottom sheet on a phone); null when no owner serves it. */
  readonly togglePanels?: (() => void) | null
  /** A swipe in from the right edge, inside a thread, opens the thread panel (Settings › phoneEdgeSwipePanels). */
  readonly edgeSwipePanels?: boolean
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
        'dshx:flex dshx:w-full dshx:shrink-0 dshx:flex-col dshx:items-center dshx:gap-0.5 dshx:rounded-md dshx:px-0 dshx:py-1.5 dshx:text-muted-foreground dshx:outline-none dshx:transition-colors',
        'dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring',
        props.active && 'dshx:bg-accent dshx:text-foreground',
        dropping && 'dshx:ring-2 dshx:ring-ring',
      )}
    >
      <span className="dshx:inline-flex dshx:size-5 dshx:items-center dshx:justify-center" aria-hidden="true">
        {props.icon}
      </span>
      {props.showLabel ? (
        <span className="dshx:max-w-full dshx:truncate dshx:text-2xs dshx:leading-tight dshx:tracking-tight">{props.folder.label}</span>
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

/** One section: its label is the button's whole name, so a reach or a screen reader finds it by that alone. */
const SectionButton = (props: {
  readonly label: string
  readonly description?: string | undefined
  readonly selected: boolean
  readonly panelId?: string
  /** The page's own sidebar glyph, which may carry its badge (RAM's detached memory, the Inbox count). */
  readonly icon?: ReactNode
  readonly onSelect: () => void
  /** The row's ⋯ menu (b:952m). */
  readonly menu?: ReactNode
  /** Drag the row to another folder or before another row (b:952m). */
  readonly drag?: { readonly onDropBefore: (viewId: string) => void } | undefined
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
          'dshx:flex dshx:w-full dshx:min-w-0 dshx:items-start dshx:gap-2 dshx:rounded-md dshx:px-2.5 dshx:py-1.5 dshx:text-left dshx:outline-none dshx:transition-colors',
          'dshx:hover:bg-accent/60 dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring',
          props.selected && 'dshx:bg-accent',
        )}
      >
        {props.icon === undefined || props.icon === null ? null : (
          <span
            className="dshx:mt-0.5 dshx:inline-flex dshx:size-4 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:text-muted-foreground"
            aria-hidden="true"
          >
            {props.icon}
          </span>
        )}
        <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
          <span className={cn('dshx:truncate dshx:text-sm', props.selected && 'dshx:font-medium')}>{props.label}</span>
          {props.description === undefined ? null : (
            <span id={descriptionId} className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">
              {props.description}
            </span>
          )}
        </span>
      </button>
      {props.menu === undefined ? null : <div className="dshx:absolute dshx:top-1.5 dshx:right-1">{props.menu}</div>}
    </div>
  )
}

/** The rows of one folder: a page opens in the stage, any other view through the Workbench (b:952m). */
const EntryRows = (props: {
  readonly folder: RailFolder
  readonly entries: readonly ResolvedEntry[]
  readonly activePanelId: string | null
  readonly openEntry: (entry: ResolvedEntry) => void
  readonly renderPanelIcon: DestinationShellProps['renderPanelIcon']
  readonly folderUi: SidebarFolderUi | undefined
  readonly descriptions?: boolean
}): JSX.Element => (
  <>
    {props.entries.map(entry => (
      <SectionButton
        key={entry.viewId}
        panelId={entry.viewId}
        label={entry.title}
        description={props.descriptions === false ? undefined : entry.description}
        icon={entry.kind === 'page' ? props.renderPanelIcon(entry.viewId, 16, props.activePanelId === entry.viewId) : <ViewGlyph />}
        selected={props.activePanelId === entry.viewId}
        onSelect={() => props.openEntry(entry)}
        menu={props.folderUi === undefined ? undefined : <EntryMenu entry={entry} folderId={props.folder.id} ui={props.folderUi} />}
        drag={props.folderUi === undefined ? undefined : { onDropBefore: viewId => props.folderUi?.actions.movePanel(viewId, props.folder.id, entry.viewId) }}
      />
    ))}
  </>
)

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
}): JSX.Element => {
  const { folder, folderUi } = props
  const [renaming, setRenaming] = useState(false)
  const resolved = folderUi?.folders.find(candidate => candidate.id === folder.id)
  // Settings lists the pages nobody mapped, and the panels of a deleted folder, under Other pages.
  const other = (entry: ResolvedEntry): boolean => entry.unmapped || (folder.id === 'settings' && !entry.mapped)
  const mapped = folder.entries.filter(entry => !other(entry))
  const unmapped = folder.entries.filter(other)
  const settings = folder.id === 'settings' ? props.openSettings : null
  const empty = mapped.length === 0 && unmapped.length === 0 && settings === null
  const rows = (entries: readonly ResolvedEntry[], descriptions = true): JSX.Element => (
    <EntryRows
      folder={folder}
      entries={entries}
      activePanelId={props.activePanelId}
      openEntry={props.openEntry}
      renderPanelIcon={props.renderPanelIcon}
      folderUi={folderUi}
      descriptions={descriptions}
    />
  )
  return (
    <div className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:flex-col" data-destination-index={folder.id}>
      {/* The right padding keeps the folder's ⋯ clear of the pane's own top-right Show tab row control (b:952m). */}
      <header
        className={cn('dshx:flex dshx:shrink-0 dshx:items-start dshx:gap-1 dshx:pt-1 dshx:pb-2 dshx:pl-3', props.phone === true ? 'dshx:pr-3' : 'dshx:pr-9')}
      >
        <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
          <h2 className={cn('dshx:text-sm dshx:font-semibold', props.phone === true && 'dshx:sr-only')}>{folder.label}</h2>
          <p className="dshx:text-xs dshx:text-muted-foreground">{folder.description}</p>
        </div>
        {folderUi === undefined || resolved === undefined || props.phone === true ? null : (
          <FolderMenu folder={resolved} ui={folderUi} onRename={() => setRenaming(true)} />
        )}
      </header>
      <div className="dshx:min-h-0 dshx:flex-1 dshx:overflow-y-auto dshx:px-1.5">
        {empty && folderUi === undefined ? (
          <EmptyState>
            {folder.id === 'inbox'
              ? 'The inbox is not installed in this profile yet. Threads that need you are marked in the thread list.'
              : 'No page here yet. Plugins add their pages to this list.'}
          </EmptyState>
        ) : (
          <nav aria-label={`${folder.label} pages`} className="dshx:flex dshx:flex-col dshx:gap-0.5">
            {settings === null ? null : (
              <SectionButton label="All settings" description="Appearance, models, agents, tools and more." selected={false} onSelect={settings} />
            )}
            {rows(mapped)}
            {folderUi === undefined || resolved === undefined || props.phone === true ? null : <AddPanelButton folder={resolved} ui={folderUi} />}
          </nav>
        )}
        {unmapped.length === 0 ? null : (
          <section className="dshx:mt-3" aria-label="Other pages">
            <h3 className="dshx:px-2 dshx:pb-1 dshx:text-xs dshx:font-medium dshx:text-muted-foreground">Other pages</h3>
            <div className="dshx:flex dshx:flex-col dshx:gap-0.5">{rows(unmapped, false)}</div>
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
}): null => {
  const { entries, activePanelId, openEntry, renderPanelIcon, customizeThreads } = props
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
      }),
    [entries, activePanelId, openEntry, renderPanelIcon, customizeThreads],
  )
  return null
}

const ListPane = (
  props: DestinationShellProps & { readonly folder: RailFolder; readonly openEntry: (entry: ResolvedEntry) => void; readonly phone?: boolean },
): JSX.Element =>
  props.folder.id === 'threads' ? (
    <div className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:flex-col" data-destination-index="threads">
      <ThreadsHeaderExtras
        entries={props.folder.entries}
        activePanelId={props.activePanelId}
        openEntry={props.openEntry}
        renderPanelIcon={props.renderPanelIcon}
        customizeThreads={props.customizeThreads}
      />
      {/* One search entry above the list (T5.3/T5.4): Board and Customize live in the list's Filter menu. */}
      {props.searchThreads === null ? null : (
        <div className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:px-2 dshx:pb-1">
          <Button
            size="sm"
            variant="outline"
            className="dshx:min-w-0 dshx:flex-1 dshx:justify-start dshx:font-normal dshx:text-muted-foreground"
            onClick={props.searchThreads}
          >
            <SearchIcon className="dshx:size-3.5" aria-hidden="true" />
            {props.labels.searchThreads}
          </Button>
        </div>
      )}
      <div className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:overflow-hidden dshx:*:w-full dshx:*:min-w-0">{props.threadList}</div>
    </div>
  ) : (
    <FolderIndex
      folder={props.folder}
      activePanelId={props.activePanelId}
      openEntry={props.openEntry}
      openSettings={props.openSettings}
      renderPanelIcon={props.renderPanelIcon}
      folderUi={props.folderUi}
      phone={props.phone === true}
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
    // Collapsed, a folder of pages opens a flyout of its rows instead of the whole column (b:952m).
    if (props.collapsed && folderUi !== undefined && next.id !== 'threads' && next.id !== 'settings' && next.entries.length > 0 && !openFirst) {
      setFlyout(current => (current === next.id ? null : next.id))
      return
    }
    setDestination(next.id)
    if (props.collapsed) props.toggleSidebar()
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
  const railButton = (candidate: RailFolder): JSX.Element => {
    const active = !props.collapsed && candidate.id === folder.id
    const button = (
      <RailButton
        key={candidate.id}
        folder={candidate}
        active={active}
        showLabel={!props.collapsed}
        controls={props.collapsed ? undefined : listId}
        icon={folderIcon(props, candidate, active)}
        onSelect={() => choose(candidate)}
        onDropView={folderUi === undefined || candidate.id === 'threads' ? undefined : viewId => folderUi.actions.movePanel(viewId, candidate.id)}
      />
    )
    if (!props.collapsed || folderUi === undefined) return button
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
          // 2px gutters and unpadded buttons: "Knowledge", the longest destination, fits whole at the label size without
          // widening the rail (productivity pass Q5, T5.3).
          props.collapsed ? 'dshx:w-full dshx:px-2' : 'dshx:w-16 dshx:px-0.5',
        )}
      >
        {/* Expanded, New thread sits in the header row; collapsed, the rail keeps it reachable. */}
        {props.collapsed && props.showNewThread ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={props.labels.newThread}
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
        <div id={listId} role="tabpanel" aria-label={folder.label} className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:flex-col">
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
  const { toggleSidebar } = props
  const listOpen = !props.collapsed
  const [moreOpen, setMoreOpen] = useState(false)
  // More's tree (b:952m): the folders whose rows are shown inline, by id.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  // The list is the frame's left column, flipped by a toggle; inside a View Transition that toggle runs a frame later,
  // so several requests in one gesture (the pick effect and the tap handler) must still flip it once.
  const listOpenRef = useRef(listOpen)
  listOpenRef.current = listOpen
  const stackMotionPending = useRef(false)
  const moveStack = (motion: 'push' | 'pop', open: boolean, before?: () => void): void => {
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
    if (linked === null || linked === props.selectedThreadId) return
    if (props.destination.id !== 'threads') props.setDestination('threads')
    if (listOpenRef.current) return
    listOpenRef.current = true
    toggleSidebar()
  }, [])
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
      if (alreadyShown && listOpen) props.toggleSidebar()
      return
    }
    if (sole !== undefined) {
      // The page is the list: show it in the stage, which closes the list.
      props.record({ destination: next, section: sole, surface: 'tab-bar' })
      props.selectPanel(sole)
      return
    }
    props.record({ destination: next, surface: 'tab-bar' })
    if (!listOpen) props.toggleSidebar()
  }
  const stageOwner = Destinations.owning(props.destinations, props.activePanelId)?.id
  /** The highlighted tab: with the list closed, an Inbox or Land page in the stage; with it open, the shown destination. */
  const currentTab = (): PhoneTab | null => {
    if (!listOpen) return stageOwner === 'inbox' || stageOwner === 'land' ? stageOwner : null
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
        props.toggleSidebar()
        return
      }
      setMoreOpen(true)
      if (!listOpen) props.toggleSidebar()
      return
    }
    // A second tap on the open tab goes back to the stage.
    if (current === tab) {
      props.toggleSidebar()
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
  const stack = {
    listOpen,
    moreOpen,
    destination: props.destination,
    destinations: props.destinations,
    activePanelId: props.activePanelId,
    selectedThreadId: props.stageThreadId === undefined ? props.selectedThreadId : props.stageThreadId,
    stageTitle: props.stageTitle,
    origin,
  }
  const bar = PhoneTopBarModel.resolve(stack)
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
  useEdgeSwipe({ side: 'left', enabled: bar.back !== null, onSwipe: back })
  // Android's back gesture (and a browser Back) pops the same stack: each level is one history entry. A push drops the
  // thread from the entry it leaves below, so going back never switches to another thread through the URL route.
  usePhoneHistoryLayer({ key: 'dshfilesPhoneStack', depth: PhoneTopBarModel.depth(stack), enabled: true, pop: back, baseUrl: clearThreadUrl })
  // Inside a thread the stage owns the bottom edge (plan phone rules): no tab bar, Back returns to the list.
  const inThread = !listOpen && bar.thread
  useLayoutEffect(() => {
    const root = document.documentElement
    root.toggleAttribute('data-phone-in-thread', inThread)
    root.style.setProperty('--dsh-phone-nav-height', inThread ? PHONE_NAV_HIDDEN_HEIGHT : PHONE_NAV_HEIGHT)
    return () => root.removeAttribute('data-phone-in-thread')
  }, [inThread])
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
  return createPortal(
    <div className="dshx-root">
      <header
        data-phone-top-bar=""
        data-phone-stage={listOpen ? undefined : bar.thread ? 'thread' : (props.activePanelId ?? 'none')}
        className={cn(
          'dshx:fixed dshx:inset-x-0 dshx:top-0 dshx:z-[41] dshx:flex dshx:translate-y-[var(--dsh-visual-offset-top,0px)] dshx:items-end dshx:border-b dshx:border-border dshx:bg-background dshx:pt-[env(safe-area-inset-top,0px)] dshx:pl-[max(4px,env(safe-area-inset-left,0px))] dshx:text-foreground',
          // A thread on the stage puts its Changes pill and one `⋯` menu (rich-composer, T1.4/T3.2) in the trailing
          // corner, publishing that bar's width; the status strip is a pill above the tab bar (frame-layout, T1.6).
          bar.thread && !listOpen ? 'dshx:pr-[calc(var(--dsh-phone-bar-width,44px)+4px)]' : 'dshx:pr-1',
        )}
        style={{ height: PHONE_TOP_HEIGHT }}
      >
        <div className="dshx:flex dshx:h-11 dshx:w-full dshx:min-w-0 dshx:items-center dshx:gap-0.5">
          {bar.back === null ? null : (
            <button
              type="button"
              data-phone-back=""
              aria-label={`Back to ${bar.back.label}`}
              onClick={back}
              className="dshx:flex dshx:h-11 dshx:min-w-11 dshx:max-w-[40%] dshx:shrink-0 dshx:items-center dshx:gap-0.5 dshx:rounded-md dshx:pr-2 dshx:pl-1 dshx:text-sm dshx:text-muted-foreground dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:active:bg-accent"
            >
              <ChevronLeftIcon className="dshx:size-5 dshx:shrink-0" aria-hidden="true" />
              <span className="dshx:min-w-0 dshx:truncate">{bar.back.label}</span>
            </button>
          )}
          <h1
            data-phone-title=""
            className={cn('dshx:min-w-0 dshx:flex-1 dshx:truncate dshx:text-[15px] dshx:leading-tight dshx:font-semibold', bar.back === null && 'dshx:pl-2.5')}
          >
            {bar.title}
          </h1>
          {showNew ? (
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
          {bar.thread && togglePanels !== null ? (
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
      </header>
      {listOpen ? (
        <div
          data-phone-list=""
          onClick={closeAfterPick}
          className="dshx:fixed dshx:inset-x-0 dshx:z-40 dshx:flex dshx:flex-col dshx:bg-(--dsw-specific-sidebar-fill) dshx:pt-2 dshx:text-foreground"
          style={{ top: PHONE_TOP_HEIGHT, bottom: PHONE_NAV_HEIGHT }}
        >
          {moreOpen ? (
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
          )}
        </div>
      ) : null}
      {inThread ? null : (
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
                current === tab && 'dshx:text-foreground',
              )}
            >
              <span className="dshx:inline-flex dshx:size-6 dshx:items-center dshx:justify-center" aria-hidden="true">
                {tabIcon(tab)}
              </span>
              <span className={cn('dshx:text-2xs dshx:leading-tight', current === tab && 'dshx:font-medium')}>{tabLabel[tab]}</span>
            </button>
          ))}
        </nav>
      )}
    </div>,
    document.body,
  )
}
