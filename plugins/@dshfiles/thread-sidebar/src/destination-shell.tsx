import { EmptyState } from '@dshfiles/plugin-ui/components/page'
import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { createStoredValue } from '@dshfiles/plugin-ui/hooks/stored-value'
import {
  ActivityIcon,
  BotIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EllipsisIcon,
  GitMergeIcon,
  InboxIcon,
  LibraryIcon,
  ListTodoIcon,
  MessagesSquareIcon,
  MenuIcon,
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
import { PhoneThreadMenu, PhoneTopBarModel, SETTINGS_PANEL_ID, useSoftwareKeyboard } from './phone-shell.js'

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

const storedDestination = createStoredValue({
  key: 'dshfiles.thread-sidebar.destination.v1',
  schema: Schema.Literals(DESTINATION_IDS),
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
const openSettingsPage = (): boolean => !window.dispatchEvent(new CustomEvent('dshfiles:open-settings', { detail: {}, cancelable: true }))
const PHONE_NAV_HEIGHT = 'calc(56px + env(safe-area-inset-bottom, 0px))'
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
  /** The thread the stage shows, as its title (the phone top bar names the stage). */
  readonly stageTitle?: string | undefined
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
  /** Phone: the top bar already names the destination, so the heading stays for assistive tech only. */
  readonly phone?: boolean
}): JSX.Element => {
  const mapped = props.destination.sections.filter(section => !section.unmapped)
  const unmapped = props.destination.sections.filter(section => section.unmapped)
  const settings = props.destination.id === 'settings' ? props.openSettings : null
  const empty = mapped.length === 0 && unmapped.length === 0 && settings === null
  return (
    <div className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:flex-col" data-destination-index={props.destination.id}>
      <header className="dshx:flex dshx:shrink-0 dshx:flex-col dshx:gap-0.5 dshx:px-3 dshx:pt-1 dshx:pb-2">
        <h2 className={cn('dshx:text-sm dshx:font-semibold', props.phone === true && 'dshx:sr-only')}>{props.destination.label}</h2>
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
            {settings === null ? null : (
              <SectionButton label="All settings" description="Appearance, models, agents, tools and more." selected={false} onSelect={settings} />
            )}
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

const ListPane = (
  props: DestinationShellProps & { readonly destination: ResolvedDestination; readonly openSection: (panelId: string) => void; readonly phone?: boolean },
): JSX.Element =>
  props.destination.id === 'threads' ? (
    <div className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:flex-col" data-destination-index="threads">
      {props.searchThreads === null && props.customizeThreads === undefined && props.destination.sections.length === 0 ? null : (
        <div className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:px-2 dshx:pb-2">
          {props.searchThreads === null ? null : (
            <Button
              size="sm"
              variant="outline"
              className="dshx:min-w-0 dshx:flex-1 dshx:justify-start dshx:font-normal dshx:text-muted-foreground"
              onClick={props.searchThreads}
            >
              <SearchIcon className="dshx:size-3.5" aria-hidden="true" />
              {props.labels.searchThreads}
            </Button>
          )}
          {props.destination.sections.length === 0 ? null : (
            <nav aria-label="Threads pages" className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1">
              {props.destination.sections.map(section => {
                const active = props.activePanelId === section.panelId
                return (
                  <Tooltip key={section.panelId}>
                    <TooltipTrigger asChild>
                      <Button
                        data-section={section.panelId}
                        size="icon-sm"
                        variant={active ? 'secondary' : 'ghost'}
                        className="dshx:shrink-0 dshx:text-muted-foreground"
                        aria-label={section.label}
                        aria-current={active ? 'page' : undefined}
                        onClick={() => props.openSection(section.panelId)}
                      >
                        {props.renderPanelIcon(section.panelId, 16, active)}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom">{section.label}</TooltipContent>
                  </Tooltip>
                )
              })}
            </nav>
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
      phone={props.phone === true}
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
  if (phone)
    return <PhoneNavigation {...props} destinations={destinations} destination={destination} setDestination={setDestination} openSection={openSection} />
  const choose = (next: ResolvedDestination): void => {
    setDestination(next.id)
    if (props.collapsed) props.toggleSidebar()
    const sole = soleSection(next)
    // Settings is one page in the stage (plan §4.6): the rail opens it at once, its list keeps the deep links.
    if (next.id === 'settings') openSettingsPage()
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
        className={cn(
          'dshx:flex dshx:min-h-0 dshx:shrink-0 dshx:flex-col dshx:overflow-y-auto dshx:pb-2 dshx:[scrollbar-width:none]',
          props.collapsed ? 'dshx:w-full dshx:px-2' : 'dshx:w-16 dshx:px-1',
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
          {rail(false)}
          <div className="dshx:mt-auto dshx:flex dshx:flex-col dshx:pt-2">{rail(true)}</div>
        </div>
      </nav>
      {props.collapsed ? null : (
        <div
          id={listId}
          role="tabpanel"
          aria-label={destination.label}
          className="dshx:flex dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:border-l dshx:border-border/60"
        >
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
  const { toggleSidebar } = props
  const listOpen = !props.collapsed
  const [moreOpen, setMoreOpen] = useState(false)
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
  useSoftwareKeyboard()
  // Opening a thread or a page from the list pushes the stage: close the list.
  const shown = useRef({ thread: props.selectedThreadId, panel: props.activePanelId, stage: props.stageThreadId ?? null })
  // A thread opened from a page on the stage (an Inbox item's Open) remembers that page for Back; any other route
  // to a thread (the list, New, the palette) forgets it.
  const [origin, setOrigin] = useState<{ readonly panelId: string } | undefined>(undefined)
  useEffect(() => {
    // A selection that only catches up with the thread already on the stage (a draft's first message created it) is
    // not a pick: it must not close a list the user just opened.
    const caughtUp = shown.current.panel === props.activePanelId && props.selectedThreadId !== null && props.selectedThreadId === shown.current.stage
    const changed = !caughtUp && (shown.current.thread !== props.selectedThreadId || shown.current.panel !== props.activePanelId)
    const from = shown.current.panel
    const owned = (panelId: string | null): boolean => panelId !== null && Destinations.owning(props.destinations, panelId) !== undefined
    if (changed) setOrigin(!listOpen && owned(from) && !owned(props.activePanelId) && from !== null ? { panelId: from } : undefined)
    shown.current = { thread: props.selectedThreadId, panel: props.activePanelId, stage: props.stageThreadId ?? null }
    if (changed && listOpen) {
      setMoreOpen(false)
      toggleSidebar()
    }
  }, [props.selectedThreadId, props.activePanelId, props.stageThreadId, listOpen, toggleSidebar, props.destinations])
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
  /** The highlighted tab: with the list closed, only the inbox page in the stage; with it open, the shown destination. */
  const currentTab = (): PhoneTab | null => {
    if (!listOpen) return stageOwner === 'inbox' ? 'inbox' : null
    if (moreOpen || !['threads', 'inbox'].includes(props.destination.id)) return 'more'
    return props.destination.id === 'inbox' ? 'inbox' : 'threads'
  }
  const current = currentTab()
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
  const tabLabel = { threads: 'Threads', inbox: 'Inbox', new: 'New', more: 'More' } satisfies Record<PhoneTab, string>
  const tabIcon = (tab: PhoneTab): ReactNode => {
    if (tab === 'new') return <PlusIcon className="dshx:size-5" />
    if (tab === 'more') return <EllipsisIcon className="dshx:size-5" />
    const target = props.destinations.find(candidate => candidate.id === tab)
    return target === undefined ? null : destinationIcon(props, target, current === tab)
  }
  const others = props.destinations.filter(candidate => candidate.id !== 'threads' && candidate.id !== 'inbox')
  const bar = PhoneTopBarModel.resolve({
    listOpen,
    moreOpen,
    destination: props.destination,
    destinations: props.destinations,
    activePanelId: props.activePanelId,
    selectedThreadId: props.stageThreadId === undefined ? props.selectedThreadId : props.stageThreadId,
    stageTitle: props.stageTitle,
    origin,
  })
  // Back pops one level of the stack: the stage returns to the list it came from, a destination list to More.
  const back = (): void => {
    if (bar.back === null) return
    if (bar.back.to === 'page') {
      setOrigin(undefined)
      props.selectPanel(bar.back.panelId)
      return
    }
    if (bar.back.to === 'more') {
      setMoreOpen(true)
      if (!listOpen) props.toggleSidebar()
      return
    }
    props.setDestination(bar.back.to)
    setMoreOpen(false)
    props.record({ destination: bar.back.to, surface: 'back' })
    if (!listOpen) props.toggleSidebar()
  }
  const threadMenuOpen = PhoneThreadMenu.useOpen()
  useEffect(() => {
    if (!bar.thread) PhoneThreadMenu.close()
  }, [bar.thread])
  useEffect(() => PhoneThreadMenu.close, [])
  // Tapping the row of the thread (or the page) already on the stage changes no selection, so the effect above would
  // leave the list open: close it after the click, unless the selection change already did.
  const listOpenRef = useRef(listOpen)
  listOpenRef.current = listOpen
  const closeAfterPick = (event: React.MouseEvent<HTMLElement>): void => {
    if (!(event.target instanceof Element) || event.target.closest('[data-thread-main-action], [data-section]') === null) return
    requestAnimationFrame(() => {
      if (listOpenRef.current) props.toggleSidebar()
    })
  }
  return createPortal(
    <div className="dshx-root">
      <header
        data-phone-top-bar=""
        data-phone-stage={listOpen ? undefined : bar.thread ? 'thread' : (props.activePanelId ?? 'none')}
        className="dshx:fixed dshx:inset-x-0 dshx:top-0 dshx:z-[41] dshx:flex dshx:translate-y-[var(--dsh-visual-offset-top,0px)] dshx:items-end dshx:border-b dshx:border-border dshx:bg-background dshx:pt-[env(safe-area-inset-top,0px)] dshx:pr-12 dshx:pl-[max(4px,env(safe-area-inset-left,0px))] dshx:text-foreground"
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
          {bar.thread ? (
            <button
              type="button"
              data-phone-thread-menu-toggle=""
              aria-label="Thread menu"
              aria-expanded={threadMenuOpen}
              onClick={PhoneThreadMenu.toggle}
              className={cn(
                'dshx:flex dshx:size-11 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-md dshx:text-muted-foreground dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring dshx:active:bg-accent',
                threadMenuOpen && 'dshx:bg-accent dshx:text-foreground',
              )}
            >
              <MenuIcon className="dshx:size-5" aria-hidden="true" />
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
                {others.map(candidate => (
                  <EntityRow
                    key={candidate.id}
                    data-destination={candidate.id}
                    leading={
                      <span className="dshx:inline-flex dshx:size-5 dshx:items-center dshx:justify-center dshx:text-muted-foreground">
                        {destinationIcon(props, candidate, false)}
                      </span>
                    }
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
            <ListPane {...props} phone destination={props.destination} openSection={panelId => props.openSection(panelId, 'index')} />
          )}
        </div>
      ) : null}
      <nav
        aria-label="Destinations"
        data-phone-tab-bar=""
        className="dshx:fixed dshx:inset-x-0 dshx:bottom-0 dshx:z-40 dshx:flex dshx:border-t dshx:border-border dshx:bg-background dshx:pr-[env(safe-area-inset-right,0px)] dshx:pb-[env(safe-area-inset-bottom,0px)] dshx:pl-[env(safe-area-inset-left,0px)] dshx:in-data-phone-keyboard:hidden"
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
