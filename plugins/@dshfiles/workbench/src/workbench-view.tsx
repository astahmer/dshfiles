import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { PlusIcon, RotateCcwIcon, XIcon } from '@dshfiles/plugin-ui/icons'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import {
  DockviewReact,
  getPanelData,
  type DockviewApi,
  type DockviewDidDropEvent,
  type DockviewDndOverlayEvent,
  type DockviewGroupPanel,
  type DockviewReadyEvent,
  type DockviewTheme,
  type IDockviewPanelProps,
} from 'dockview-react'
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent } from 'react'
import { WorkbenchLayout, WORKBENCH_COMPONENT, type LayoutStore, type WorkbenchDefaultLayout } from './layout-store.js'
import type { WorkbenchTranslate } from './locales.js'
import { workbenchRegions, type WorkbenchRegionId } from './dock-regions.js'
import type { WorkbenchPanelDefinition, WorkbenchPanelRegistry } from './registry.js'

/** Variables live in the injected dockview sheet (`dockview-theme.css`), mapped to the Host `--dsw-*` tokens. */
const workbenchTheme: DockviewTheme = { name: 'dshfiles', className: 'dshfiles-workbench-theme' }

/** A panel dropped onto a surface, with that surface's own instance so the embedder can adopt it. */
export interface WorkbenchPanelDrop {
  readonly panelId: string
  readonly api: DockviewApi
  /** The group under the drop when a Dockview group target took it; absent over an empty surface. */
  readonly group?: DockviewGroupPanel
}

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
  /** A panel dropped here from another region's drag: the embedder adopts it and drops the source's copy. */
  readonly onDropPanel?: (drop: WorkbenchPanelDrop) => void
  /**
   * Whether a drag from another region is accepted over this surface. Dockview
   * asks through the api's own event, which has no React prop.
   */
  readonly acceptDroppedPanel?: (event: DockviewDndOverlayEvent) => void
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

/** What a surface with no saved layout of its own opens with, by the region it is. */
const defaultLayoutOf = (surface: WorkbenchViewProps['surface']): WorkbenchDefaultLayout =>
  surface === 'dock' ? 'dock-default' : surface === 'bottom' ? 'empty' : 'editor'

export const WorkbenchView = (props: WorkbenchViewProps): JSX.Element => {
  const { acceptDroppedPanel, onOpenPanel, region, registry, store, t } = props
  const defaultLayout = defaultLayoutOf(props.surface)
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
    const Watermark = (): JSX.Element => {
      const panels = useSyncExternalStore(registry.subscribe, registry.list, registry.list)
      const ordered = panels
        .map(panel => ({ panel, preference: registry.preference(panel.id) }))
        .filter(
          (entry): entry is { readonly panel: WorkbenchPanelDefinition; readonly preference: NonNullable<ReturnType<typeof registry.preference>> } =>
            entry.preference !== undefined,
        )
        .sort((left, right) => left.preference.order - right.preference.order)
      const available = ordered.filter(entry => entry.preference.emptyState)
      return (
        <section className="dshx-root dshx:flex dshx:h-full dshx:flex-col dshx:gap-3 dshx:overflow-y-auto dshx:p-4 dshx:text-sm">
          <p className="dshx:text-muted-foreground">{t('empty')}</p>
          {available.map(({ panel }) => (
            <Button key={panel.id} size="sm" variant="outline" onClick={() => registry.open(panel.id)}>
              {panel.title}
            </Button>
          ))}
          {ordered.length > 0 ? (
            <fieldset className="dshx:flex dshx:flex-col dshx:gap-2 dshx:border-t dshx:border-border dshx:pt-3">
              <legend className="dshx:mb-2 dshx:text-xs dshx:font-medium">{t('configureSidePanelPlugins')}</legend>
              {ordered.map(({ panel, preference }, index) => (
                <div key={panel.id} className="dshx:flex dshx:items-center dshx:gap-2">
                  <span className="dshx:min-w-0 dshx:flex-1 dshx:truncate">{panel.title}</span>
                  <label className="dshx:flex dshx:items-center dshx:gap-1 dshx:text-xs">
                    <input
                      type="checkbox"
                      checked={preference.contextMenu}
                      aria-label={t('panelContextMenu', { title: panel.title })}
                      onChange={event => registry.setPreference(panel.id, { ...preference, contextMenu: event.currentTarget.checked })}
                    />
                    {t('menus')}
                  </label>
                  <label className="dshx:flex dshx:items-center dshx:gap-1 dshx:text-xs">
                    <input
                      type="checkbox"
                      checked={preference.emptyState}
                      aria-label={t('panelEmptyState', { title: panel.title })}
                      onChange={event => registry.setPreference(panel.id, { ...preference, emptyState: event.currentTarget.checked })}
                    />
                    {t('emptyState')}
                  </label>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('movePanelEarlier', { title: panel.title })}
                    disabled={index === 0}
                    onClick={() => registry.movePreference(panel.id, 'earlier')}
                  >
                    ↑
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t('movePanelLater', { title: panel.title })}
                    disabled={index === ordered.length - 1}
                    onClick={() => registry.movePreference(panel.id, 'later')}
                  >
                    ↓
                  </Button>
                </div>
              ))}
            </fieldset>
          ) : null}
        </section>
      )
    }
    return { components: { [WORKBENCH_COMPONENT]: RegisteredPanel }, Watermark }
  }, [registry, t])

  const onReady = (event: DockviewReadyEvent): void => {
    WorkbenchLayout.restoreLayout(event.api, store, registry.list(), defaultLayout)
    // Dockview only reports layout changes for later gestures, so without this a freshly applied default layout would
    // stay unsaved until the first drag: a reload would rebuild it from the default instead of restoring what it was.
    store.set(event.api.toJSON())
    setApi(event.api)
    props.onApi?.(event.api)
  }

  // The surface answers for its region while it is mounted, so a drop in any
  // other region can find the panel here and take it away.
  useEffect(() => {
    if (api === null || region === undefined) return
    return workbenchRegions().set(region, api)
  }, [api, region])

  // Dockview checks the drop overlay against this event; accepting a transfer
  // from another region is what lets a panel be dropped here at all.
  useEffect(() => {
    if (api === null || acceptDroppedPanel === undefined) return
    const subscription = api.onUnhandledDragOver(event => acceptDroppedPanel?.(event))
    return () => subscription.dispose()
  }, [acceptDroppedPanel, api])

  /**
   * `getPanelData()` is Dockview's own page-global transfer, so the panel id
   * survives a drag between two instances. A transfer from this surface is
   * Dockview's internal business and is left alone.
   */
  const foreignTransfer = (): { readonly panelId: string; readonly api: DockviewApi } | undefined => {
    const transfer = getPanelData()
    if (api === null || transfer === undefined || transfer.viewId === api.id || transfer.panelId === null) return undefined
    return { panelId: transfer.panelId, api }
  }

  const onDidDrop = (event: DockviewDidDropEvent): void => {
    const panelId = event.getData()?.panelId
    if (api === null || panelId === undefined || panelId === null) return
    props.onDropPanel?.(event.group === undefined ? { panelId, api } : { panelId, api, group: event.group })
  }

  // The wrapper answers for a foreign panel the surface's own targets refused:
  // Dockview's group, tab and content targets accept one through
  // `onUnhandledDragOver`, but its layout-edge target refuses a foreign view
  // outright, so a drop over an empty surface reaches no Dockview handler at
  // all. A drop one of its targets did take stops propagating before here. The
  // depth counts the child boundaries a drag crosses, so the mark only shows
  // while it is genuinely over the surface.
  const foreignDragDepth = useRef(0)
  const [foreignDragOver, setForeignDragOver] = useState(false)

  const enterForeignDrag = (): void => {
    foreignDragDepth.current += 1
    if (foreignDragDepth.current === 1) setForeignDragOver(true)
  }

  const leaveForeignDrag = (): void => {
    foreignDragDepth.current = Math.max(0, foreignDragDepth.current - 1)
    if (foreignDragDepth.current === 0) setForeignDragOver(false)
  }

  const endForeignDrag = (): void => {
    foreignDragDepth.current = 0
    setForeignDragOver(false)
  }

  const onForeignDragOver = (event: DragEvent<HTMLDivElement>): void => {
    if (foreignTransfer() === undefined) return
    event.preventDefault()
  }

  const onForeignDragEnter = (event: DragEvent<HTMLDivElement>): void => {
    if (foreignTransfer() === undefined) return
    event.preventDefault()
    enterForeignDrag()
  }

  const onForeignDrop = (event: DragEvent<HTMLDivElement>): void => {
    const transfer = foreignTransfer()
    if (transfer === undefined) return
    event.preventDefault()
    endForeignDrag()
    props.onDropPanel?.(transfer)
  }

  useEffect(() => {
    if (!foreignDragOver) return
    // A drag that ends anywhere else (Escape, or a target that took the drop)
    // must not leave the surface marked as the drop target.
    const reset = (): void => endForeignDrag()
    document.addEventListener('dragend', reset)
    return () => document.removeEventListener('dragend', reset)
  }, [foreignDragOver])

  const open = useCallback(
    (definition: WorkbenchPanelDefinition): void => {
      if (api === null) return
      if (onOpenPanel !== undefined) onOpenPanel(definition, api)
      else WorkbenchLayout.openPanel(api, definition)
    },
    [api, onOpenPanel],
  )

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
  }, [api, open, registry, store])

  // Panels another region already shows are not "closed": adding one here moves
  // it, so the menu lists what no surface holds yet.
  const regions = workbenchRegions()
  const closed = definitions.filter(definition => !openIds.includes(definition.id) && !regions.holds(definition.id))

  return (
    <div className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-1 dshx:flex-col">
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
              WorkbenchLayout.applyDefaultLayout(api, registry.list(), defaultLayout)
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
      <div
        className={cn('dshx:relative dshx:min-h-0 dshx:flex-1', foreignDragOver && 'dshx:ring-2 dshx:ring-ring/60 dshx:ring-inset')}
        onDragEnter={onForeignDragEnter}
        onDragOver={onForeignDragOver}
        onDragLeave={leaveForeignDrag}
        onDrop={onForeignDrop}
      >
        <DockviewReact
          components={components}
          defaultRenderer="always"
          theme={workbenchTheme}
          watermarkComponent={Watermark}
          onReady={onReady}
          onDidDrop={onDidDrop}
        />
      </div>
    </div>
  )
}
