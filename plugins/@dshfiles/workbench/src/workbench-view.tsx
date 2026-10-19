import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { PlusIcon, RotateCcwIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import {
  DockviewReact, type DockviewApi, type DockviewDidDropEvent, type DockviewReadyEvent, type DockviewTheme,
  type DockviewUnhandledDragOverEvent, type IDockviewPanelProps,
} from 'dockview-react'
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { WorkbenchLayout, WORKBENCH_COMPONENT, type LayoutStore } from './layout-store.js'
import type { WorkbenchTranslate } from './locales.js'
import { workbenchRegions, type WorkbenchRegionId } from './dock-regions.js'
import type { WorkbenchPanelDefinition, WorkbenchPanelRegistry } from './registry.js'

/** Variables live in the injected dockview sheet (`dockview-theme.css`), mapped to the Host `--dsw-*` tokens. */
const workbenchTheme: DockviewTheme = { name: 'dshfiles', className: 'dshfiles-workbench-theme' }

interface WorkbenchViewProps {
  readonly registry: WorkbenchPanelRegistry
  readonly store: LayoutStore
  readonly t: WorkbenchTranslate
  /** Receives the Dockview API once the saved layout is restored, for callers that drive the layout (commands, tests). */
  readonly onApi?: (api: DockviewApi) => void
  /** `dock` is the global right-column surface: its default layout leads with the panel marked `dockDefault`. */
  readonly surface?: 'main' | 'side-panel' | 'dock' | 'bottom'
  /** The region this surface is, registered page-wide so a panel can move between regions. */
  readonly region?: WorkbenchRegionId
  /** A drop from another region's drag: the embedder adopts the panel and drops the source's copy. */
  readonly onDrop?: (event: DockviewDidDropEvent) => void
  /** Whether a drag from another region is accepted over this surface. */
  readonly onUnhandledDragOver?: (event: DockviewUnhandledDragOverEvent) => void
  /**
   * Where an "Add panel" or a queued open goes. The embedder routes it so a
   * panel already shown in another region moves here instead of being duplicated.
   */
  readonly onOpenPanel?: (definition: WorkbenchPanelDefinition, api: DockviewApi) => void
  /** Renders a close control in the header, for a surface the embedder can hide. */
  readonly onClose?: () => void
  /** Header text; defaults to the workbench title. */
  readonly heading?: string
  /**
   * Per-surface actions in the view's header, given the live API and the open
   * panel ids, so a surface can offer the moves it owns.
   */
  readonly headerActions?: (context: { readonly api: DockviewApi | null; readonly openIds: readonly string[] }) => JSX.Element | null
}

const usePanelDefinitions = (registry: WorkbenchPanelRegistry) => useSyncExternalStore(registry.subscribe, registry.list, registry.list)

export const WorkbenchView = (props: WorkbenchViewProps): JSX.Element => {
  const { registry, store, t } = props
  const definitions = usePanelDefinitions(registry)
  const [api, setApi] = useState<DockviewApi | null>(null)
  const [openIds, setOpenIds] = useState<readonly string[]>([])

  const { components, Watermark } = useMemo(() => {
    const RegisteredPanel = (panelProps: IDockviewPanelProps): JSX.Element => {
      const id = panelProps.api.id
      const definition = useSyncExternalStore(
        registry.subscribe,
        () => registry.get(id),
        () => registry.get(id),
      )
      if (definition === undefined) {
        return (
          <div className="dshx-root dshx:flex dshx:h-full dshx:flex-col dshx:items-start dshx:gap-3 dshx:p-4 dshx:text-sm dshx:text-muted-foreground">
            <p>{t('missingPanel', { id })}</p>
            <Button size="sm" variant="outline" onClick={() => panelProps.api.close()}>
              {t('closePanel')}
            </Button>
          </div>
        )
      }
      const Panel = definition.component
      return <Panel panelId={id} />
    }
    const Watermark = (): JSX.Element => <p className="dshx-root dshx:p-4 dshx:text-sm dshx:text-muted-foreground">{t('empty')}</p>
    return { components: { [WORKBENCH_COMPONENT]: RegisteredPanel }, Watermark }
  }, [registry, t])

  const onReady = (event: DockviewReadyEvent): void => {
    WorkbenchLayout.restoreLayout(event.api, store, registry.list(), props.surface === 'dock' || props.surface === 'bottom')
    // Dockview only reports layout changes for later gestures, so without this a freshly applied default layout would
    // stay unsaved until the first drag: a reload would rebuild it from the default instead of restoring what it was.
    store.set(event.api.toJSON())
    setApi(event.api)
    props.onApi?.(event.api)
  }

  // The surface answers for its region while it is mounted, so a drop in any
  // other region can find the panel here and take it away.
  useEffect(() => {
    if (api === null || props.region === undefined) return
    return workbenchRegions().set(props.region, api)
  }, [api, props.region])

  const open = (definition: WorkbenchPanelDefinition): void => {
    if (api === null) return
    if (props.onOpenPanel !== undefined) props.onOpenPanel(definition, api)
    else WorkbenchLayout.openPanel(api, definition)
  }

  useEffect(() => {
    if (api === null) return
    const syncOpenIds = (): void => setOpenIds(api.panels.map(panel => panel.id))
    syncOpenIds()
    const persist = api.onDidLayoutChange(() => {
      store.set(api.toJSON())
      syncOpenIds()
    })
    const takeOpenRequests = (): void => {
      for (const id of registry.takeOpenRequests()) open(registry.get(id) ?? { id, title: id, component: () => null })
    }
    takeOpenRequests()
    const unsubscribe = registry.subscribe(takeOpenRequests)
    return () => {
      persist.dispose()
      unsubscribe()
    }
  }, [api, registry, store])

  // Panels another region already shows are not "closed": adding one here moves
  // it, so the menu lists what no surface holds yet.
  const regions = workbenchRegions()
  const closed = definitions.filter(definition => !openIds.includes(definition.id) && !regions.holds(definition.id))

  return (
    <div className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col">
      <header className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2 dshx:border-b dshx:border-border dshx:px-3 dshx:py-1.5">
        <h2 className="dshx:text-sm dshx:font-medium">{props.heading ?? t('title')}</h2>
        <div className="dshx:flex dshx:items-center dshx:gap-1">
          {props.headerActions?.({ api, openIds })}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" disabled={api === null}>
                <PlusIcon /> {t('addPanel')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {closed.length === 0 ? (
                <DropdownMenuItem disabled>{t('noMorePanels')}</DropdownMenuItem>
              ) : (
                closed.map(definition => (
                  <DropdownMenuItem key={definition.id} onSelect={() => open(definition)}>
                    {definition.title}
                  </DropdownMenuItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            variant="ghost"
            disabled={api === null}
            onClick={() => {
              if (api === null) return
              store.remove()
              WorkbenchLayout.applyDefaultLayout(api, registry.list(), props.surface === 'dock' || props.surface === 'bottom')
            }}
          >
            <RotateCcwIcon /> {t('resetLayout')}
          </Button>
          {props.onClose !== undefined && (
            <Button size="sm" variant="ghost" aria-label={t('hidePanel')} title={t('hidePanel')} onClick={props.onClose}>
              <XIcon />
            </Button>
          )}
        </div>
      </header>
      <div className="dshx:relative dshx:min-h-0 dshx:flex-1">
        <DockviewReact
          components={components}
          defaultRenderer="always"
          theme={workbenchTheme}
          watermarkComponent={Watermark}
          onReady={onReady}
          {...(props.onDrop === undefined ? {} : { onDidDrop: props.onDrop })}
          {...(props.onUnhandledDragOver === undefined ? {} : { onUnhandledDragOver: props.onUnhandledDragOver })}
        />
      </div>
    </div>
  )
}
