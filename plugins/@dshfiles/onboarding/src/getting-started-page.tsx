import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { EmptyState, Page, PageSection } from '@dshfiles/plugin-ui/components/page'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import { ToggleGroup, ToggleGroupItem } from '@dshfiles/plugin-ui/components/ui/toggle-group'
import { StatusGlyph } from '@dshfiles/plugin-ui/components/work-status'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import { CopyIcon, ExternalLinkIcon, LocateFixedIcon, PlayIcon, SearchIcon, SettingsIcon, SparklesIcon } from '@dshfiles/plugin-ui/icons'
import { useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import type * as Types from 'effect/Types'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { DESTINATION_ORDER, type ChecklistItem, type FeatureRow, type Overview, type OverviewInput, type PackView } from './overview-model.js'
import { PackChangeDialog, type PackChangeDialogProps, type PackTarget } from './pack-change-dialog.js'
import { CHECKLIST_GLYPH, CHECKLIST_LABEL, PLUGIN_GLYPH, PLUGIN_STATE_LABEL, PREREQUISITE_LABELS, pluginLabel } from './labels.js'
import type { PackAction } from './pack-plan.js'
import { Routes, type RouteServices } from './routes.js'
import { onboardingSettings, type OnboardingSettings } from './settings.js'
import { SuggestionsSection, type SuggestionsSectionProps } from './suggestions-section.js'
import { SuggestionsStore } from './suggestions-store.js'
import { SuggestionsWindow } from './suggestions-window.js'
import { TryItDialog, type TryItDialogProps, type TryItTarget } from './try-it-dialog.js'
import { WhatsNewSection, type WhatsNewSectionProps } from './whats-new-section.js'
import { WhatsNewStore } from './whats-new-store.js'

const DESTINATION_LABELS = {
  threads: 'Threads',
  inbox: 'Inbox',
  land: 'Land',
  work: 'Work',
  agents: 'Agents',
  observe: 'Observe',
  knowledge: 'Knowledge',
  settings: 'Settings',
  'thread-panel': 'Thread panel',
  composer: 'Composer',
  transcript: 'Transcript',
  none: 'Agent tools',
} as const satisfies Record<(typeof DESTINATION_ORDER)[number], string>
const destinationLabels = new Map<string, string>(Object.entries(DESTINATION_LABELS))
export const destinationLabel = (id: string): string => destinationLabels.get(id) ?? id

/** The All chip's value: a single toggle group needs a value for every item. */
const ALL = 'all'

export interface GettingStartedProps {
  readonly settings: OnboardingSettings
  readonly loadOverview: (input: OverviewInput, signal: AbortSignal) => Promise<Overview>
  readonly routes: RouteServices
  readonly copy: (text: string) => Promise<boolean>
  readonly startWizard: () => void
  readonly applyPack: PackChangeDialogProps['applyPack']
  /** Start Show me where on one feature's `reach` steps. */
  readonly showWhere: (featureKey: string) => void
  readonly loadWhatsNew: WhatsNewSectionProps['loadWhatsNew']
  readonly loadSuggestions: SuggestionsSectionProps['loadSuggestions']
  readonly startTryIt: TryItDialogProps['startTryIt']
  readonly openThread: TryItDialogProps['openThread']
  readonly project: TryItDialogProps['project']
}

const ChecklistRow = (props: {
  readonly item: ChecklistItem
  readonly routes: RouteServices
  readonly copy: (text: string) => Promise<boolean>
}): ReactNode => {
  const { item } = props
  const [copied, setCopied] = useState(false)
  const route = item.fix.route
  const routeOpen = route !== null && Routes.available(route, props.routes)
  const link = item.fix.shellCommand?.startsWith('https://') === true ? item.fix.shellCommand : null
  const open = item.state !== 'done' && item.state !== 'off'
  return (
    <EntityRow
      data-checklist-item={item.id}
      data-state={item.state}
      description={item.detail}
      heading={item.title}
      role="listitem"
      status={CHECKLIST_GLYPH[item.state]}
      statusLabel={CHECKLIST_LABEL[item.state]}
      trailing={
        open ? (
          <>
            {routeOpen ? (
              <Button onClick={() => Routes.open(route, props.routes)} size="sm" variant="outline">
                {item.fix.label}
              </Button>
            ) : null}
            {link !== null ? (
              <Button asChild size="sm" variant="outline">
                <a href={link} rel="noopener noreferrer" target="_blank">
                  <ExternalLinkIcon /> {item.fix.label}
                </a>
              </Button>
            ) : null}
            {item.fix.shellCommand !== null && link === null ? (
              <Button
                aria-label={`Copy ${item.fix.shellCommand}`}
                className="dshx:shrink"
                onClick={async () => setCopied(await props.copy(item.fix.shellCommand ?? ''))}
                size="sm"
                variant="ghost"
              >
                <CopyIcon /> <code className="dshx:font-mono!">{copied ? 'Copied' : item.fix.shellCommand}</code>
              </Button>
            ) : null}
          </>
        ) : null
      }
    />
  )
}

const PackCard = (props: {
  readonly pack: PackView
  readonly routes: RouteServices
  readonly onChange: (action: PackAction, trigger: HTMLButtonElement) => void
  /** Absent while the `tryIt` setting is off. */
  readonly onTryIt: ((trigger: HTMLButtonElement) => void) | null
}): ReactNode => {
  const { pack } = props
  const enabled = pack.plugins.filter(plugin => plugin.state === 'enabled').length
  const onTryIt = enabled > 0 ? props.onTryIt : null
  const changeable = !pack.core && !pack.plugins.every(plugin => plugin.state === 'unknown')
  return (
    <li className="dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2 dshx:rounded-lg dshx:border dshx:border-border dshx:p-3" data-pack={pack.id}>
      <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-baseline dshx:gap-2">
        <h3 className="dshx:min-w-0 dshx:text-sm dshx:font-semibold">{pack.title}</h3>
        {pack.core ? <Badge variant="secondary">Core</Badge> : null}
        <span className="dshx:text-xs dshx:text-muted-foreground dshx:tabular-nums">
          {String(enabled)} of {String(pack.plugins.length)} enabled
        </span>
      </div>
      <p className="dshx:text-xs dshx:text-muted-foreground">{pack.summary}</p>
      <ul aria-label={`${pack.title} plugins`} className="dshx:flex dshx:flex-wrap dshx:gap-1.5">
        {pack.plugins.map(plugin => (
          <li key={plugin.name}>
            <Badge className="dshx:gap-1 dshx:font-normal" data-plugin={plugin.name} data-plugin-state={plugin.state} variant="outline">
              <StatusGlyph className="dshx:size-3" label={PLUGIN_STATE_LABEL[plugin.state]} status={PLUGIN_GLYPH[plugin.state]} />
              {pluginLabel(plugin.name)}
            </Badge>
          </li>
        ))}
      </ul>
      {pack.prerequisites.length === 0 ? null : (
        <p className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:text-muted-foreground">
          Needs
          {pack.prerequisites.map(prerequisite => (
            <span className="dshx:inline-flex dshx:items-center dshx:gap-1" data-prerequisite={prerequisite.id} key={prerequisite.id}>
              <StatusGlyph className="dshx:size-3" label={CHECKLIST_LABEL[prerequisite.state]} status={CHECKLIST_GLYPH[prerequisite.state]} />
              {PREREQUISITE_LABELS[prerequisite.id]}
            </span>
          ))}
        </p>
      )}
      {pack.keySettings.length === 0 || !props.routes.hasSettings() ? null : (
        <div className="dshx:flex dshx:flex-wrap dshx:gap-2">
          {pack.keySettings.map(setting => (
            <Button
              className="dshx:h-auto dshx:shrink dshx:py-1.5 dshx:text-left dshx:whitespace-normal"
              key={`${setting.entryId}.${setting.fieldPath.join('.')}`}
              onClick={() => props.routes.openSettings({ setting: { entryId: setting.entryId, fieldPath: setting.fieldPath } })}
              size="sm"
              variant="ghost"
            >
              <SettingsIcon /> {setting.label}
            </Button>
          ))}
        </div>
      )}
      {!changeable && onTryIt === null ? null : (
        <div className="dshx:flex dshx:flex-wrap dshx:gap-2 dshx:border-t dshx:border-border dshx:pt-2">
          {onTryIt === null ? null : (
            <Button aria-label={`Try it: ${pack.title}`} onClick={event => onTryIt(event.currentTarget)} size="sm" variant="outline">
              <SparklesIcon /> Try it
            </Button>
          )}
          {changeable ? (
            <>
              <Button aria-label={`Enable pack: ${pack.title}`} onClick={event => props.onChange('enable', event.currentTarget)} size="sm" variant="outline">
                Enable pack
              </Button>
              <Button aria-label={`Disable pack: ${pack.title}`} onClick={event => props.onChange('disable', event.currentTarget)} size="sm" variant="ghost">
                Disable pack
              </Button>
            </>
          ) : null}
        </div>
      )}
    </li>
  )
}

const FeatureItem = (props: {
  readonly row: FeatureRow
  readonly routes: RouteServices
  readonly showWhere: (featureKey: string) => void
  /** Absent while the `tryIt` setting is off. */
  readonly onTryIt: ((trigger: HTMLButtonElement) => void) | null
}): ReactNode => {
  const { row } = props
  const onTryIt = props.onTryIt
  const route = row.route
  const canOpen = route !== null && Routes.available(route, props.routes)
  const verbs = row.walkable || onTryIt !== null || canOpen
  return (
    <EntityRow
      data-feature={row.key}
      description={
        <>
          <span className="dshx:line-clamp-2">{row.firstAction ?? row.summary}</span>
          {row.currentSurface === null ? null : <span className="dshx:truncate">{row.currentSurface}</span>}
        </>
      }
      heading={row.title}
      meta={destinationLabel(row.destination)}
      role="listitem"
      trailing={
        verbs ? (
          <>
            {row.walkable ? (
              <Button aria-label={`Show me where: ${row.title}`} onClick={() => props.showWhere(row.key)} size="sm" variant="ghost">
                <LocateFixedIcon /> {onTryIt === null ? 'Show me where' : <span className="dshx:@max-pane-narrow:sr-only">Show me where</span>}
              </Button>
            ) : null}
            {onTryIt === null ? null : (
              <Button aria-label={`Try it: ${row.title}`} onClick={event => onTryIt(event.currentTarget)} size="sm" variant="ghost">
                <SparklesIcon /> <span className="dshx:@max-pane-narrow:sr-only">Try it</span>
              </Button>
            )}
            {canOpen ? (
              <Button aria-label={`Open ${row.title}`} onClick={() => Routes.open(route, props.routes)} size="sm" variant="outline">
                Open
              </Button>
            ) : null}
          </>
        ) : null
      }
    />
  )
}

/** `/` focuses the search field unless the user is typing somewhere already. */
const useSlashFocus = (target: React.RefObject<HTMLInputElement | null>): void => {
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return
      const active = document.activeElement
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || (active instanceof HTMLElement && active.isContentEditable)) return
      if (target.current === null || target.current.offsetParent === null) return
      event.preventDefault()
      target.current.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [target])
}

export const GettingStartedPage = (props: GettingStartedProps): ReactNode => {
  const [search, setSearch] = useState('')
  const [destination, setDestination] = useState<OverviewInput['destination']>()
  const query = useDebouncedValue({ value: search.trim(), delayMs: 200 })
  const searchInput = useRef<HTMLInputElement>(null)
  useSlashFocus(searchInput)
  const request: Types.Mutable<OverviewInput> = {}
  if (query !== '') request.query = query
  if (destination !== undefined) request.destination = destination
  const overview = useQuery({
    queryKey: ['onboarding', 'overview', query, destination ?? null],
    queryFn: ({ signal }) => props.loadOverview(request, signal),
    placeholderData: previous => previous,
    retry: false,
  })
  const data = overview.data
  const checklist = data?.checklist ?? null
  const queryClient = useQueryClient()
  const [packTarget, setPackTarget] = useState<PackTarget | null>(null)
  const [tryItTarget, setTryItTarget] = useState<TryItTarget | null>(null)
  const tryIt = props.settings.tryIt
  const openTryIt = (target: TryItTarget, button: HTMLButtonElement): void => {
    trigger.current = button
    setTryItTarget(target)
  }
  const trigger = useRef<HTMLButtonElement | null>(null)
  const loadOverview = props.loadOverview
  const loadPreview = useCallback(
    async (target: PackTarget, signal: AbortSignal) => {
      const value = await loadOverview({ preview: { pack: target.pack, action: target.action }, curatedOnly: true, limit: 1 }, signal)
      if (value.preview === null) throw new Error('No preview of this pack came back.')
      return value.preview
    },
    [loadOverview],
  )
  const refresh = useCallback(() => void queryClient.invalidateQueries({ queryKey: ['onboarding', 'overview'] }), [queryClient])
  const done = checklist?.filter(item => item.state === 'done').length ?? 0
  const lastSeen = WhatsNewStore.useLastSeen()
  const featured = SuggestionsStore.useFeatured()
  const [today] = useState(() => SuggestionsWindow.localDay(new Date()))
  const dismissed = SuggestionsStore.useDismissed()
  const routes = props.routes
  const openSuggestionsSetting = useCallback(
    () => routes.openSettings({ setting: { entryId: onboardingSettings.namespace, fieldPath: ['suggestions'] } }),
    [routes],
  )
  const showFeatures = useCallback((plugin: string) => {
    setDestination(undefined)
    // The plugin's name as people read it: every word of it still matches the plugin's own features.
    setSearch(pluginLabel(plugin))
    searchInput.current?.focus()
  }, [])

  return (
    <main aria-label="Getting started" className="dshx-root dshx:@container dshx:h-full">
      <Page
        bodyClassName="dshx:gap-6 dshx:@max-pane-narrow:gap-5"
        description="What this setup can do and what it still needs."
        heading="Getting started"
        primaryAction={{ id: 'start-setup', label: 'Start setup', icon: <PlayIcon />, onSelect: props.startWizard }}
        scroll
      >
        {overview.isError && data === undefined ? (
          <EmptyState action={{ label: 'Try again', onSelect: () => void overview.refetch() }}>
            The checklist, packs and features could not be loaded. Try again; if it keeps failing, restart DSH from the bottom of the rail.
          </EmptyState>
        ) : null}
        {props.settings.checklist && checklist !== null ? (
          <PageSection heading="Setup checklist" meta={`${String(done)} of ${String(checklist.length)}`}>
            <EntityList aria-label="Setup checklist">
              {checklist.map(item => (
                <ChecklistRow copy={props.copy} item={item} key={item.id} routes={props.routes} />
              ))}
            </EntityList>
          </PageSection>
        ) : null}
        {props.settings.whatsNew ? (
          <WhatsNewSection
            copy={props.copy}
            lastSeen={lastSeen}
            loadWhatsNew={props.loadWhatsNew}
            markSeen={WhatsNewStore.markSeen}
            showFeatures={showFeatures}
          />
        ) : null}
        <SuggestionsSection
          dismiss={SuggestionsStore.dismiss}
          dismissed={dismissed}
          enabled={props.settings.suggestions}
          featured={featured}
          findFeature={showFeatures}
          loadSuggestions={props.loadSuggestions}
          openSetting={props.routes.hasSettings() ? openSuggestionsSetting : null}
          remember={SuggestionsStore.remember}
          restoreDismissed={SuggestionsStore.restoreDismissed}
          showWhere={props.showWhere}
          today={today}
        />
        {props.settings.packs && data !== undefined ? (
          <PageSection heading="Packs" meta={String(data.packs.length)}>
            <ul className="dshx:grid dshx:grid-cols-2 dshx:gap-3 dshx:@max-pane-compact:grid-cols-1">
              {data.packs.map(pack => (
                <PackCard
                  key={pack.id}
                  onChange={(action, button) => {
                    trigger.current = button
                    setPackTarget({ pack: pack.id, title: pack.title, action })
                  }}
                  onTryIt={tryIt ? button => openTryIt({ pack: pack.id, title: pack.title }, button) : null}
                  pack={pack}
                  routes={props.routes}
                />
              ))}
            </ul>
          </PageSection>
        ) : null}
        <PageSection heading="Features" meta={data === undefined ? undefined : String(data.features.total)}>
          <InputGroup>
            <InputGroupAddon>
              <SearchIcon />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Search features"
              className="dshx:h-auto dshx:self-stretch"
              onChange={event => setSearch(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Escape' && search !== '') {
                  event.preventDefault()
                  setSearch('')
                }
              }}
              placeholder="Search features"
              ref={searchInput}
              value={search}
            />
          </InputGroup>
          {/* A filter over one list: one Tab stop, arrow keys between destinations; a phone pane scrolls it sideways. */}
          <ToggleGroup
            aria-label="Destinations"
            role="group"
            className="dshx:w-full dshx:flex-wrap dshx:pb-1 dshx:@max-pane-narrow:flex-nowrap dshx:@max-pane-narrow:overflow-x-auto dshx:@max-pane-narrow:[scrollbar-width:none]"
            onValueChange={next => setDestination(DESTINATION_ORDER.find(candidate => candidate === next))}
            size="sm"
            spacing={1}
            type="single"
            value={destination ?? ALL}
          >
            {[
              { id: ALL, label: 'All', count: undefined },
              ...(data?.features.destinations ?? []).flatMap(entry => {
                const id = DESTINATION_ORDER.find(candidate => candidate === entry.id)
                return id === undefined ? [] : [{ id, label: destinationLabel(id), count: entry.count }]
              }),
            ].map(chip => (
              <ToggleGroupItem className="dshx:gap-1" key={chip.id} value={chip.id}>
                {chip.label}
                {chip.count === undefined ? null : <span className="dshx:text-2xs dshx:text-muted-foreground dshx:tabular-nums">{String(chip.count)}</span>}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          {data !== undefined && data.features.rows.length === 0 ? (
            <EmptyState action={{ label: 'Clear the search', onSelect: () => setSearch('') }}>No feature matches every word.</EmptyState>
          ) : (
            <EntityList aria-label="Features">
              {(data?.features.rows ?? []).map(row => (
                <FeatureItem
                  key={row.key}
                  onTryIt={tryIt ? button => openTryIt({ feature: row.key, title: row.title }, button) : null}
                  routes={props.routes}
                  row={row}
                  showWhere={props.showWhere}
                />
              ))}
            </EntityList>
          )}
        </PageSection>
      </Page>
      <PackChangeDialog
        applyPack={props.applyPack}
        copy={props.copy}
        loadPreview={loadPreview}
        onClose={() => {
          setPackTarget(null)
          // Radix returns focus on its own only to a Dialog trigger; these buttons open it from page state.
          requestAnimationFrame(() => trigger.current?.focus())
        }}
        onSettled={refresh}
        target={packTarget}
      />
      <TryItDialog
        onClose={() => {
          setTryItTarget(null)
          requestAnimationFrame(() => trigger.current?.focus())
        }}
        openThread={props.openThread}
        project={props.project}
        startTryIt={props.startTryIt}
        target={tryIt ? tryItTarget : null}
      />
    </main>
  )
}
