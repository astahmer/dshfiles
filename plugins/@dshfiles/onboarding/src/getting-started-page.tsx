import { EmptyState, Page, PageSection } from '@dshfiles/plugin-ui/components/page'
import { Badge } from '@dshfiles/plugin-ui/components/ui/badge'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@dshfiles/plugin-ui/components/ui/input-group'
import { useDebouncedValue } from '@dshfiles/plugin-ui/hooks/debounced-value'
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  CircleHelpIcon,
  CircleOffIcon,
  CopyIcon,
  ExternalLinkIcon,
  LocateFixedIcon,
  PlayIcon,
  SearchIcon,
  SettingsIcon,
} from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useQuery, useQueryClient } from '@dshfiles/plugin-ui/query'
import type * as Types from 'effect/Types'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { DESTINATION_ORDER, type ChecklistItem, type FeatureRow, type Overview, type OverviewInput, type PackView } from './overview-model.js'
import { PackChangeDialog, type PackChangeDialogProps, type PackTarget } from './pack-change-dialog.js'
import type { PackAction, PluginState } from './pack-plan.js'
import { Routes, type RouteServices } from './routes.js'
import type { OnboardingSettings } from './settings.js'

/** 44 px on phones and touch screens, the kit's own height elsewhere. */
export const TOUCH = 'dshx:max-sm:min-h-[44px] dshx:pointer-coarse:min-h-[44px]'
const TOUCH_FIELD = 'dshx:max-sm:h-[44px] dshx:pointer-coarse:h-[44px]'

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

const STATE_ICON = { done: CheckCircle2Icon, todo: CircleDashedIcon, unknown: CircleHelpIcon, off: CircleOffIcon } as const
const STATE_LABEL = { done: 'Done', todo: 'To do', unknown: 'Unknown', off: 'Off' } as const
const PLUGIN_VARIANT = { enabled: 'success', disabled: 'warning', 'not-installed': 'outline', unknown: 'outline' } as const satisfies Record<
  PluginState,
  string
>
const PLUGIN_LABEL = { enabled: 'enabled', disabled: 'disabled', 'not-installed': 'not installed', unknown: 'unknown' } as const satisfies Record<
  PluginState,
  string
>

export interface GettingStartedProps {
  readonly settings: OnboardingSettings
  readonly loadOverview: (input: OverviewInput, signal: AbortSignal) => Promise<Overview>
  readonly routes: RouteServices
  readonly copy: (text: string) => Promise<boolean>
  readonly startWizard: () => void
  readonly applyPack: PackChangeDialogProps['applyPack']
  /** Start Show me where on one feature's `reach` steps. */
  readonly showWhere: (featureKey: string) => void
}

const ChecklistRow = (props: {
  readonly item: ChecklistItem
  readonly routes: RouteServices
  readonly copy: (text: string) => Promise<boolean>
}): ReactNode => {
  const { item } = props
  const Icon = STATE_ICON[item.state]
  const [copied, setCopied] = useState(false)
  const route = item.fix.route
  const routeOpen = route !== null && Routes.available(route, props.routes)
  const link = item.fix.shellCommand?.startsWith('https://') === true ? item.fix.shellCommand : null
  return (
    <li
      className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-x-3 dshx:gap-y-2 dshx:py-2"
      data-checklist-item={item.id}
      data-state={item.state}
    >
      <Icon
        aria-label={STATE_LABEL[item.state]}
        className={cn('dshx:size-5 dshx:shrink-0', item.state === 'done' ? 'dshx:text-success' : 'dshx:text-muted-foreground')}
        role="img"
      />
      <div className="dshx:min-w-0 dshx:flex-1">
        <p className="dshx:text-sm dshx:font-medium">{item.title}</p>
        <p className="dshx:text-xs dshx:text-muted-foreground">{item.detail}</p>
      </div>
      {item.state === 'done' || item.state === 'off' ? null : (
        <div className="dshx:flex dshx:shrink-0 dshx:flex-wrap dshx:gap-2">
          {routeOpen ? (
            <Button className={TOUCH} onClick={() => Routes.open(route, props.routes)} size="sm" variant="outline">
              {item.fix.label}
            </Button>
          ) : null}
          {link !== null ? (
            <Button asChild className={TOUCH} size="sm" variant="outline">
              <a href={link} rel="noopener noreferrer" target="_blank">
                <ExternalLinkIcon /> {item.fix.label}
              </a>
            </Button>
          ) : null}
          {item.fix.shellCommand !== null && link === null ? (
            <Button
              aria-label={`Copy ${item.fix.shellCommand}`}
              className={TOUCH}
              onClick={() => void props.copy(item.fix.shellCommand ?? '').then(setCopied)}
              size="sm"
              variant="ghost"
            >
              <CopyIcon /> <code className="dshx:font-mono!">{copied ? 'Copied' : item.fix.shellCommand}</code>
            </Button>
          ) : null}
        </div>
      )}
    </li>
  )
}

const PackCard = (props: {
  readonly pack: PackView
  readonly routes: RouteServices
  readonly onChange: (action: PackAction, trigger: HTMLButtonElement) => void
}): ReactNode => {
  const { pack } = props
  const enabled = pack.plugins.filter(plugin => plugin.state === 'enabled').length
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
            <Badge data-plugin-state={plugin.state} variant={PLUGIN_VARIANT[plugin.state]}>
              {plugin.name} · {PLUGIN_LABEL[plugin.state]}
            </Badge>
          </li>
        ))}
      </ul>
      {pack.prerequisites.length === 0 ? null : (
        <p className="dshx:flex dshx:flex-wrap dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:text-muted-foreground">
          Needs
          {pack.prerequisites.map(prerequisite => {
            const Icon = STATE_ICON[prerequisite.state]
            return (
              <span className="dshx:inline-flex dshx:items-center dshx:gap-1" key={prerequisite.id}>
                <Icon aria-label={STATE_LABEL[prerequisite.state]} className="dshx:size-3.5" role="img" />
                {prerequisite.id}
              </span>
            )
          })}
        </p>
      )}
      {pack.keySettings.length === 0 || !props.routes.hasSettings() ? null : (
        <div className="dshx:flex dshx:flex-wrap dshx:gap-2">
          {pack.keySettings.map(setting => (
            <Button
              className={cn('dshx:h-auto dshx:shrink dshx:py-1.5 dshx:text-left dshx:whitespace-normal', TOUCH)}
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
      {pack.core || pack.plugins.every(plugin => plugin.state === 'unknown') ? null : (
        <div className="dshx:flex dshx:flex-wrap dshx:gap-2 dshx:border-t dshx:border-border dshx:pt-2">
          <Button
            aria-label={`Enable pack: ${pack.title}`}
            className={TOUCH}
            onClick={event => props.onChange('enable', event.currentTarget)}
            size="sm"
            variant="outline"
          >
            Enable pack
          </Button>
          <Button
            aria-label={`Disable pack: ${pack.title}`}
            className={TOUCH}
            onClick={event => props.onChange('disable', event.currentTarget)}
            size="sm"
            variant="ghost"
          >
            Disable pack
          </Button>
        </div>
      )}
    </li>
  )
}

const FeatureItem = (props: { readonly row: FeatureRow; readonly routes: RouteServices; readonly showWhere: (featureKey: string) => void }): ReactNode => {
  const { row } = props
  const route = row.route
  const canOpen = route !== null && Routes.available(route, props.routes)
  return (
    <li className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-start dshx:gap-x-3 dshx:gap-y-2 dshx:py-2.5" data-feature={row.key}>
      <div className="dshx:min-w-0 dshx:flex-1">
        <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-baseline dshx:gap-x-2">
          <p className="dshx:min-w-0 dshx:text-sm dshx:font-medium">{row.title}</p>
          <span className="dshx:text-xs dshx:text-muted-foreground">{row.plugin}</span>
        </div>
        <p className="dshx:line-clamp-2 dshx:text-xs dshx:text-muted-foreground">{row.firstAction ?? row.summary}</p>
        {row.currentSurface === null ? null : <p className="dshx:truncate dshx:text-xs dshx:text-muted-foreground">{row.currentSurface}</p>}
      </div>
      {row.walkable ? (
        <Button
          aria-label={`Show me where: ${row.title}`}
          className={cn('dshx:shrink-0', TOUCH)}
          onClick={() => props.showWhere(row.key)}
          size="sm"
          variant="ghost"
        >
          <LocateFixedIcon /> Show me where
        </Button>
      ) : null}
      {canOpen ? (
        <Button
          aria-label={`Open ${row.title}`}
          className={cn('dshx:shrink-0', TOUCH)}
          onClick={() => Routes.open(route, props.routes)}
          size="sm"
          variant="outline"
        >
          Open
        </Button>
      ) : null}
    </li>
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
  const trigger = useRef<HTMLButtonElement | null>(null)
  const loadOverview = props.loadOverview
  const loadPreview = useCallback(
    async (target: PackTarget, signal: AbortSignal) => {
      const value = await loadOverview({ preview: { pack: target.pack, action: target.action }, curatedOnly: true, limit: 1 }, signal)
      if (value.preview === null) throw new Error('This Host returned no pack preview.')
      return value.preview
    },
    [loadOverview],
  )
  const refresh = useCallback(() => void queryClient.invalidateQueries({ queryKey: ['onboarding', 'overview'] }), [queryClient])
  const done = checklist?.filter(item => item.state === 'done').length ?? 0

  return (
    <main aria-label="Getting started" className="dshx-root dshx:@container dshx:h-full">
      <Page heading="Getting started" scroll>
        <div className="dshx:flex dshx:max-w-3xl dshx:min-w-0 dshx:flex-col dshx:gap-6">
          <div>
            <Button className={TOUCH} onClick={props.startWizard}>
              <PlayIcon /> Start setup
            </Button>
          </div>
          {overview.isError && data === undefined ? (
            <EmptyState action={{ label: 'Try again', onSelect: () => void overview.refetch() }}>
              Getting started could not read this Host. Check that the onboarding plugin is enabled in Settings › Plugins, then try again.
            </EmptyState>
          ) : null}
          {props.settings.checklist && checklist !== null ? (
            <PageSection heading="Setup checklist" meta={`${String(done)} of ${String(checklist.length)}`}>
              <ul className="dshx:flex dshx:flex-col dshx:divide-y dshx:divide-border">
                {checklist.map(item => (
                  <ChecklistRow copy={props.copy} item={item} key={item.id} routes={props.routes} />
                ))}
              </ul>
            </PageSection>
          ) : null}
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
                    pack={pack}
                    routes={props.routes}
                  />
                ))}
              </ul>
            </PageSection>
          ) : null}
          <PageSection heading="Features" meta={data === undefined ? undefined : String(data.features.total)}>
            <InputGroup className={TOUCH_FIELD}>
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                aria-label="Search features"
                className={TOUCH_FIELD}
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
            <div
              aria-label="Destinations"
              className="dshx:flex dshx:flex-wrap dshx:gap-1.5 dshx:pb-1 dshx:@max-pane-narrow:flex-nowrap dshx:@max-pane-narrow:overflow-x-auto"
              role="toolbar"
            >
              {[
                { id: undefined, label: 'All', count: undefined },
                ...(data?.features.destinations ?? []).flatMap(entry => {
                  const id = DESTINATION_ORDER.find(candidate => candidate === entry.id)
                  return id === undefined ? [] : [{ id, label: destinationLabel(id), count: entry.count }]
                }),
              ].map(chip => (
                <Button
                  aria-pressed={destination === chip.id}
                  className={cn('dshx:shrink-0', TOUCH)}
                  key={chip.id ?? 'all'}
                  onClick={() => setDestination(chip.id)}
                  size="sm"
                  variant={destination === chip.id ? 'secondary' : 'ghost'}
                >
                  {chip.label}
                  {chip.count === undefined ? null : <span className="dshx:text-muted-foreground dshx:tabular-nums">{String(chip.count)}</span>}
                </Button>
              ))}
            </div>
            {data !== undefined && data.features.rows.length === 0 ? (
              <EmptyState action={{ label: 'Clear the search', onSelect: () => setSearch('') }}>No feature matches every word.</EmptyState>
            ) : (
              <ul aria-label="Features" className="dshx:flex dshx:flex-col dshx:divide-y dshx:divide-border">
                {(data?.features.rows ?? []).map(row => (
                  <FeatureItem key={row.key} routes={props.routes} row={row} showWhere={props.showWhere} />
                ))}
              </ul>
            )}
          </PageSection>
        </div>
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
    </main>
  )
}
