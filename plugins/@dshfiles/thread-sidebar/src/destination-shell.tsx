import { EmptyState } from '@dshfiles/plugin-ui/components/page'
import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import {
  ActivityIcon,
  BotIcon,
  ChevronRightIcon,
  EllipsisIcon,
  GitMergeIcon,
  InboxIcon,
  LibraryIcon,
  ListTodoIcon,
  MessagesSquareIcon,
  PlusIcon,
  SettingsIcon,
  SearchIcon,
  SignpostIcon,
  SlidersHorizontalIcon,
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

const ICONS: Record<DestinationIcon, LucideIcon> = {
  'messages-square': MessagesSquareIcon,
  inbox: InboxIcon,
  'git-merge': GitMergeIcon,
  'list-todo': ListTodoIcon,
  bot: BotIcon,
  activity: ActivityIcon,
  library: LibraryIcon,
  settings: SettingsIcon,
}

/** The palette's "Go to …" commands ask the left column to show one destination's list. */
export const SHOW_DESTINATION_EVENT = 'dshfiles:thread-sidebar-show-destination'

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
const storedDestination = createStoredValue({
  key: 'dshfiles.thread-sidebar.destination.v1',
  schema: Schema.Literals(DESTINATION_IDS),
  fallback: 'threads' as DestinationId,
  storage: () => memoryStorage,
})

/** iPhone-class widths (plan §4.1): the rail becomes a bottom tab bar. Matches the frame's 640px phone rule. */
/** A destination whose list holds one page opens that page at once (the Inbox): the list would only repeat it. */
const soleSection = (destination: ResolvedDestination): string | undefined =>
  destination.id !== 'threads' && destination.id !== 'settings' && destination.sections.length === 1 ? destination.sections[0]?.panelId : undefined

const PHONE_QUERY = '(max-width: 639.98px)'
const PHONE_NAV_HEIGHT = 'calc(56px + env(safe-area-inset-bottom, 0px))'

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
  readonly openMovedTo: () => void
  /** Settings › Layout: switch to free docking (the Workbench left panes). */
  readonly useDocking: () => void
  readonly toggleSidebar: () => void
  readonly record: (record: NavigationRecord) => void
}

const setStoredDestination = (next: DestinationId): void => void storedDestination.set(next)

/** The stored destination, for a test or a command that resets the column to Threads. */
export const DestinationSelection = { get: storedDestination.get, set: setStoredDestination } as const

/** The page the stage shows maps back onto its destination, so the list follows the palette and deep links. */
const useDestination = (destinations: readonly ResolvedDestination[], activePanelId: string | null): [DestinationId, (next: DestinationId) => void] => {
  const destination = storedDestination.useValue()
  const owner = Destinations.owning(destinations, activePanelId)?.id
  const previous = useRef(activePanelId)
  useEffect(() => {
    if (previous.current === activePanelId) return
    previous.current = activePanelId
    if (owner !== undefined && owner !== storedDestination.get()) storedDestination.set(owner)
  }, [activePanelId, owner])
  return [destination, setStoredDestination]
}

const RailButton = (props: {
  readonly destination: ResolvedDestination
  readonly active: boolean
  readonly showLabel: boolean
  readonly icon: ReactNode
  readonly controls: string | undefined
  readonly onSelect: () => void
}): JSX.Element => {
  const button = (
    <button
      type="button"
      role="tab"
      data-destination={props.destination.id}
      aria-label={props.destination.label}
      aria-selected={props.active}
      aria-controls={props.controls}
      onClick={props.onSelect}
      className={cn(
        'dshx:flex dshx:w-full dshx:shrink-0 dshx:flex-col dshx:items-center dshx:gap-0.5 dshx:rounded-md dshx:px-0.5 dshx:py-1.5 dshx:text-muted-foreground dshx:outline-none dshx:transition-colors',
        'dshx:hover:bg-accent dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring',
        props.active && 'dshx:bg-accent dshx:text-foreground',
      )}
    >
      <span className="dshx:inline-flex dshx:size-5 dshx:items-center dshx:justify-center" aria-hidden="true">
        {props.icon}
      </span>
      {props.showLabel ? <span className="dshx:max-w-full dshx:truncate dshx:text-[11px] dshx:leading-tight">{props.destination.label}</span> : null}
    </button>
  )
  if (props.showLabel) return button
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent side="right">{props.destination.label}</TooltipContent>
    </Tooltip>
  )
}

const destinationIcon = (props: Pick<DestinationShellProps, 'panels' | 'renderPanelIcon'>, destination: ResolvedDestination, active: boolean): ReactNode => {
  const badgePanel = destination.badgeFromPanel
  if (badgePanel !== undefined && props.panels.some(panel => panel.id === badgePanel)) return props.renderPanelIcon(badgePanel, 18, active)
  const Icon = ICONS[destination.icon]
  return <Icon className="dshx:size-[18px]" />
}

/** One section: its label is the button's whole name, so a reach or a screen reader finds it by that alone. */
const SectionButton = (props: {
  readonly label: string
  readonly description?: string | undefined
  readonly selected: boolean
  readonly panelId?: string
  /** The page's own sidebar glyph, which may carry its badge (RAM's detached memory, the Inbox count). */
  readonly icon?: ReactNode
  readonly onSelect: () => void
}): JSX.Element => {
  const descriptionId = useId()
  return (
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
        <span className="dshx:mt-0.5 dshx:inline-flex dshx:size-4 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:text-muted-foreground" aria-hidden="true">
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
  )
}

/** One destination's list: its sections, opened in the stage. Threads shows the thread list instead. */
const DestinationIndex = (props: {
  readonly destination: ResolvedDestination
  readonly activePanelId: string | null
  readonly openSection: (panelId: string) => void
  readonly openSettings: (() => void) | null
  readonly openMovedTo: () => void
  readonly useDocking: () => void
  readonly renderPanelIcon: DestinationShellProps['renderPanelIcon']
}): JSX.Element => {
  const mapped = props.destination.sections.filter(section => !section.unmapped)
  const unmapped = props.destination.sections.filter(section => section.unmapped)
  const settings = props.destination.id === 'settings' ? props.openSettings : null
  const empty = mapped.length === 0 && unmapped.length === 0 && settings === null
  return (
    <div className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:flex-col" data-destination-index={props.destination.id}>
      <header className="dshx:flex dshx:shrink-0 dshx:flex-col dshx:gap-0.5 dshx:px-3 dshx:pt-1 dshx:pb-2">
        <h2 className="dshx:text-sm dshx:font-semibold">{props.destination.label}</h2>
        <p className="dshx:text-xs dshx:text-muted-foreground">{props.destination.description}</p>
      </header>
      <div className="dshx:min-h-0 dshx:flex-1 dshx:overflow-y-auto dshx:px-1.5">
        {empty ? (
          <EmptyState>
            {props.destination.id === 'inbox'
              ? 'The inbox is not installed in this profile yet. Threads that need you are marked in the thread list.'
              : 'No page here yet. Plugins add their pages to this list.'}
          </EmptyState>
        ) : (
          <nav aria-label={`${props.destination.label} pages`} className="dshx:flex dshx:flex-col dshx:gap-0.5">
            {settings === null ? null : <SectionButton label="All settings" description="Appearance, models, agents, tools and more." selected={false} onSelect={settings} />}
            {mapped.map(section => (
              <SectionButton
                key={section.panelId}
                panelId={section.panelId}
                label={section.label}
                description={section.description}
                icon={props.renderPanelIcon(section.panelId, 16, props.activePanelId === section.panelId)}
                selected={props.activePanelId === section.panelId}
                onSelect={() => props.openSection(section.panelId)}
              />
            ))}
          </nav>
        )}
        {props.destination.id === 'settings' ? (
          <section aria-label="Layout" className="dshx:mt-3 dshx:flex dshx:flex-col dshx:gap-1.5 dshx:px-2.5">
            <h3 className="dshx:text-xs dshx:font-medium dshx:text-muted-foreground">Layout</h3>
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              value="fixed"
              aria-label="Layout"
              onValueChange={value => {
                if (value === 'docking') props.useDocking()
              }}
            >
              <ToggleGroupItem value="fixed">Fixed</ToggleGroupItem>
              <ToggleGroupItem value="docking">Free docking</ToggleGroupItem>
            </ToggleGroup>
            <p className="dshx:text-xs dshx:text-muted-foreground">Free docking brings back the movable panes and your saved layout.</p>
          </section>
        ) : null}
        {unmapped.length === 0 ? null : (
          <section className="dshx:mt-3" aria-label="Other pages">
            <h3 className="dshx:px-2 dshx:pb-1 dshx:text-xs dshx:font-medium dshx:text-muted-foreground">Other pages</h3>
            <div className="dshx:flex dshx:flex-col dshx:gap-0.5">
              {unmapped.map(section => (
                <SectionButton
                  key={section.panelId}
                  panelId={section.panelId}
                  label={section.label}
                  icon={props.renderPanelIcon(section.panelId, 16, props.activePanelId === section.panelId)}
                  selected={props.activePanelId === section.panelId}
                  onSelect={() => props.openSection(section.panelId)}
                />
              ))}
            </div>
          </section>
        )}
      </div>
      <div className="dshx:shrink-0 dshx:px-1.5 dshx:py-2">
        <Button variant="ghost" size="sm" className="dshx:w-full dshx:justify-start dshx:font-normal dshx:text-muted-foreground" onClick={props.openMovedTo}>
          <SignpostIcon className="dshx:size-4" aria-hidden="true" />
          Where did a page go?
        </Button>
      </div>
    </div>
  )
}

const ListPane = (props: DestinationShellProps & { readonly destination: ResolvedDestination; readonly openSection: (panelId: string) => void }): JSX.Element =>
  props.destination.id === 'threads' ? (
    <div className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:flex-col" data-destination-index="threads">
      {props.searchThreads === null && props.customizeThreads === undefined ? null : (
        <div className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:px-2 dshx:pb-2">
          {props.searchThreads === null ? null : (
            <Button size="sm" variant="outline" className="dshx:min-w-0 dshx:flex-1 dshx:justify-start dshx:font-normal dshx:text-muted-foreground" onClick={props.searchThreads}>
              <SearchIcon className="dshx:size-3.5" aria-hidden="true" />
              {props.labels.searchThreads}
            </Button>
          )}
          {props.customizeThreads === undefined ? null : (
            <Button
              size="icon-sm"
              variant="ghost"
              className="dshx:ml-auto dshx:shrink-0 dshx:text-muted-foreground"
              aria-label={props.customizeThreads.label}
              aria-expanded={props.customizeThreads.expanded}
              onClick={props.customizeThreads.toggle}
            >
              <SlidersHorizontalIcon className="dshx:size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      )}
      {props.destination.sections.length === 0 ? null : (
        <nav aria-label="Threads pages" className="dshx:flex dshx:shrink-0 dshx:flex-wrap dshx:gap-1 dshx:px-2 dshx:pb-1">
          {props.destination.sections.map(section => (
            <Button
              key={section.panelId}
              data-section={section.panelId}
              size="xs"
              variant={props.activePanelId === section.panelId ? 'secondary' : 'ghost'}
              aria-current={props.activePanelId === section.panelId ? 'page' : undefined}
              className="dshx:font-normal"
              onClick={() => props.openSection(section.panelId)}
            >
              {section.label}
            </Button>
          ))}
        </nav>
      )}
      <div className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:overflow-hidden dshx:*:w-full dshx:*:min-w-0">{props.threadList}</div>
    </div>
  ) : (
    <DestinationIndex
      destination={props.destination}
      activePanelId={props.activePanelId}
      openSection={props.openSection}
      openSettings={props.openSettings}
      openMovedTo={props.openMovedTo}
      useDocking={props.useDocking}
      renderPanelIcon={props.renderPanelIcon}
    />
  )

/**
 * The fixed left column (plan §4.1): a labelled rail of eight destinations and the list of the selected one. Collapsed,
 * only the rail stays, with labels in tooltips; on a phone the rail becomes a bottom tab bar and the list a full screen.
 */
export const DestinationShell = (props: DestinationShellProps): JSX.Element => {
  const destinations = useMemo(() => Destinations.resolve(props.panels, props.contributed), [props.panels, props.contributed])
  const [destinationId, setDestination] = useDestination(destinations, props.activePanelId)
  const phone = usePhoneLayout()
  const listId = useId()
  const { collapsed, toggleSidebar } = props
  useEffect(() => {
    const onShow = (event: Event): void => {
      const next = event instanceof CustomEvent ? event.detail : undefined
      const id = DESTINATION_IDS.find(candidate => candidate === next)
      if (id === undefined) return
      setDestination(id)
      if (collapsed) toggleSidebar()
    }
    window.addEventListener(SHOW_DESTINATION_EVENT, onShow)
    return () => window.removeEventListener(SHOW_DESTINATION_EVENT, onShow)
  }, [collapsed, toggleSidebar, setDestination])
  const destination = destinations.find(candidate => candidate.id === destinationId) ?? destinations[0]
  if (destination === undefined) return <></>
  const openSection = (panelId: string, surface: NavigationRecord['surface'] = 'index'): void => {
    props.selectPanel(panelId)
    props.record({ destination: destination.id, section: panelId, surface })
  }
  if (phone) return <PhoneNavigation {...props} destinations={destinations} destination={destination} setDestination={setDestination} openSection={openSection} />
  const choose = (next: ResolvedDestination): void => {
    setDestination(next.id)
    if (props.collapsed) props.toggleSidebar()
    const sole = soleSection(next)
    if (sole === undefined) props.record({ destination: next.id, surface: 'rail' })
    else {
      props.selectPanel(sole)
      props.record({ destination: next.id, section: sole, surface: 'rail' })
    }
  }
  const rail = (bottom: boolean) =>
    destinations
      .filter(candidate => (candidate.bottom === true) === bottom)
      .map(candidate => {
        const active = !props.collapsed && candidate.id === destination.id
        return (
          <RailButton
            key={candidate.id}
            destination={candidate}
            active={active}
            showLabel={!props.collapsed}
            controls={props.collapsed ? undefined : listId}
            icon={destinationIcon(props, candidate, active)}
            onSelect={() => choose(candidate)}
          />
        )
      })
  return (
    <div className="dshx:flex dshx:min-h-0 dshx:w-full dshx:min-w-0 dshx:flex-1" data-destination-shell="">
      <nav
        aria-label="Destinations"
        className={cn('dshx:flex dshx:min-h-0 dshx:shrink-0 dshx:flex-col dshx:overflow-y-auto dshx:pb-2 dshx:[scrollbar-width:none]', props.collapsed ? 'dshx:w-full dshx:px-2' : 'dshx:w-16 dshx:px-1')}
      >
        {/* Expanded, New thread sits in the header row; collapsed, the rail keeps it reachable. */}
        {props.collapsed && props.showNewThread ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={props.labels.newThread} className="dshx:mb-1 dshx:w-full dshx:shrink-0" onClick={props.startSession}>
                <SquarePenIcon className="dshx:size-[18px]" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right">{props.labels.newThread}</TooltipContent>
          </Tooltip>
        ) : null}
        <div role="tablist" aria-orientation="vertical" aria-label="Destinations" className="dshx:flex dshx:flex-1 dshx:flex-col dshx:gap-0.5">
          {rail(false)}
          <div className="dshx:mt-auto dshx:flex dshx:flex-col dshx:pt-2">{rail(true)}</div>
        </div>
      </nav>
      {props.collapsed ? null : (
        <div id={listId} role="tabpanel" aria-label={destination.label} className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:border-l dshx:border-border/60">
          <ListPane {...props} destination={destination} openSection={openSection} />
        </div>
      )}
    </div>
  )
}

const PHONE_TABS = ['threads', 'inbox', 'new', 'more'] as const
type PhoneTab = (typeof PHONE_TABS)[number]

/**
 * Phone: Threads, Inbox, New and More along the bottom. Threads and Inbox open their list full screen; opening a
 * thread or a page closes it again, so the stage is pushed. The list is the frame's left column "expanded" state,
 * so the frame's own reveal (Reset layout, recovery) opens it too.
 */
const PhoneNavigation = (
  props: DestinationShellProps & {
    readonly destinations: readonly ResolvedDestination[]
    readonly destination: ResolvedDestination
    readonly setDestination: (next: DestinationId) => void
    readonly openSection: (panelId: string, surface?: NavigationRecord['surface']) => void
  },
): JSX.Element => {
  const listOpen = !props.collapsed
  const [moreOpen, setMoreOpen] = useState(false)
  useLayoutEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-shell-phone-nav', '')
    root.style.setProperty('--dsh-phone-nav-height', PHONE_NAV_HEIGHT)
    return () => {
      root.removeAttribute('data-shell-phone-nav')
      root.style.removeProperty('--dsh-phone-nav-height')
    }
  }, [])
  // Opening a thread or a page from the list pushes the stage: close the list.
  const shown = useRef({ thread: props.selectedThreadId, panel: props.activePanelId })
  useEffect(() => {
    const changed = shown.current.thread !== props.selectedThreadId || shown.current.panel !== props.activePanelId
    shown.current = { thread: props.selectedThreadId, panel: props.activePanelId }
    if (changed && listOpen) {
      setMoreOpen(false)
      props.toggleSidebar()
    }
  }, [props.selectedThreadId, props.activePanelId, listOpen, props.toggleSidebar])
  const open = (next: DestinationId): void => {
    props.setDestination(next)
    setMoreOpen(false)
    const target = props.destinations.find(candidate => candidate.id === next)
    const sole = target === undefined ? undefined : soleSection(target)
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
  const current: PhoneTab | null = !listOpen ? (stageOwner === 'inbox' ? 'inbox' : null) : moreOpen || !['threads', 'inbox'].includes(props.destination.id) ? 'more' : props.destination.id === 'inbox' ? 'inbox' : 'threads'
  const select = (tab: PhoneTab): void => {
    if (tab === 'new') {
      props.startSession()
      if (listOpen) props.toggleSidebar()
      return
    }
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
  const tabLabel: Record<PhoneTab, string> = { threads: 'Threads', inbox: 'Inbox', new: 'New', more: 'More' }
  const tabIcon = (tab: PhoneTab): ReactNode => {
    if (tab === 'new') return <PlusIcon className="dshx:size-5" />
    if (tab === 'more') return <EllipsisIcon className="dshx:size-5" />
    const target = props.destinations.find(candidate => candidate.id === tab)
    return target === undefined ? null : destinationIcon(props, target, current === tab)
  }
  const others = props.destinations.filter(candidate => candidate.id !== 'threads' && candidate.id !== 'inbox')
  return createPortal(
    <div className="dshx-root">
      {listOpen ? (
        <div
          data-phone-list=""
          className="dshx:fixed dshx:inset-x-0 dshx:top-0 dshx:z-40 dshx:flex dshx:flex-col dshx:bg-(--dsw-specific-sidebar-fill) dshx:text-foreground dshx:pt-[env(safe-area-inset-top,0px)]"
          style={{ bottom: PHONE_NAV_HEIGHT }}
        >
          {moreOpen ? (
            <nav aria-label="More destinations" className="dshx:flex dshx:min-h-0 dshx:flex-1 dshx:flex-col dshx:overflow-y-auto dshx:p-2">
              <h2 className="dshx:px-2 dshx:pt-1 dshx:pb-2 dshx:text-sm dshx:font-semibold">More</h2>
              <EntityList aria-label="More destinations">
                {others.map(candidate => (
                  <EntityRow
                    key={candidate.id}
                    data-destination={candidate.id}
                    leading={<span className="dshx:inline-flex dshx:size-5 dshx:items-center dshx:justify-center dshx:text-muted-foreground">{destinationIcon(props, candidate, false)}</span>}
                    heading={candidate.label}
                    description={candidate.description}
                    trailing={<ChevronRightIcon className="dshx:size-4 dshx:text-muted-foreground" aria-hidden="true" />}
                    onSelect={() => open(candidate.id)}
                  />
                ))}
                <EntityRow
                  leading={<SignpostIcon className="dshx:size-5 dshx:text-muted-foreground" aria-hidden="true" />}
                  heading="Where did a page go?"
                  description="Every former sidebar page and where it lives now."
                  onSelect={props.openMovedTo}
                />
              </EntityList>
            </nav>
          ) : (
            <ListPane {...props} destination={props.destination} openSection={panelId => props.openSection(panelId, 'index')} />
          )}
        </div>
      ) : null}
      <nav
        aria-label="Destinations"
        data-phone-tab-bar=""
        className="dshx:fixed dshx:inset-x-0 dshx:bottom-0 dshx:z-40 dshx:flex dshx:border-t dshx:border-border dshx:bg-background dshx:pb-[env(safe-area-inset-bottom,0px)]"
      >
        {PHONE_TABS.map(tab => (
          <button
            key={tab}
            type="button"
            data-phone-tab={tab}
            aria-current={current === tab ? 'page' : undefined}
            onClick={() => select(tab)}
            className={cn(
              'dshx:flex dshx:h-14 dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:items-center dshx:justify-center dshx:gap-0.5 dshx:text-muted-foreground dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:focus-visible:ring-inset',
              current === tab && 'dshx:text-foreground',
            )}
          >
            <span className="dshx:inline-flex dshx:size-6 dshx:items-center dshx:justify-center" aria-hidden="true">
              {tabIcon(tab)}
            </span>
            <span className={cn('dshx:text-[11px] dshx:leading-tight', current === tab && 'dshx:font-semibold')}>{tabLabel[tab]}</span>
          </button>
        ))}
      </nav>
    </div>,
    document.body,
  )
}
