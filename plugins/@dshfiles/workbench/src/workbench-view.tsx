import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { EllipsisIcon, PlusIcon, XIcon } from '@dshfiles/plugin-ui/icons'
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
  type IDockviewHeaderActionsProps,
} from 'dockview-react'
import { createContext, useContext, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react'
import { WorkbenchLayout, WORKBENCH_COMPONENT, type LayoutStore, type WorkbenchDefaultLayout } from './layout-store.js'
import type { WorkbenchTranslate } from './locales.js'
import { workbenchRegions, type WorkbenchRegionId } from './dock-regions.js'
import type { WorkbenchPanelDefinition, WorkbenchPanelRegistry } from './registry.js'
import { createWorkbenchTab } from './workbench-tab.js'
import { NewViewChooser } from './new-view-chooser.js'
import { NewViewTabs, type NewViewSelection } from './new-view.js'
import { semanticTabMove } from './tab-panels.js'
import { workbenchTabs } from './tabs.js'
import type { LayoutStoreSurface } from './layout-store.js'
import { SurfaceAction } from './surface-action.js'
import { MainSurfaceGuard } from './main-surface-guard.js'
import { WindowFloatingGeometry } from './window-floating.js'
import { TabRows } from './tab-row-visibility.js'
import { HiddenTabRowRestore, TabRowVoidMenu, type TabRowMenuTarget } from './tab-row-controls.js'

/** Variables live in the injected dockview sheet (`dockview-theme.css`), mapped to the Host `--dsw-*` tokens. */
const workbenchTheme: DockviewTheme = { name: 'dshfiles', className: 'dshfiles-workbench-theme' }
const SurfaceVisibility = createContext(true)

/** A panel dropped onto a surface, with that surface's own instance so the embedder can adopt it. */
export interface WorkbenchPanelDrop {
  readonly panelId: string
  readonly api: DockviewApi
  /** The group under the drop when a Dockview group target took it; absent over an empty surface. */
  readonly group?: DockviewGroupPanel
  readonly position?: 'left' | 'right' | 'top' | 'bottom' | 'center'
}

interface WorkbenchViewProps {
  readonly registry: WorkbenchPanelRegistry
  readonly store: LayoutStore
  readonly t: WorkbenchTranslate
  /** Retained surfaces propagate real visibility to resource presenters without remounting their components. */
  readonly visible?: boolean
  /** Receives the Dockview API once the saved layout is restored, for callers that drive the layout (commands, tests). */
  readonly onApi?: (api: DockviewApi) => void
  /** `dock` is the global right-column surface: its default layout leads with the panel marked `dockDefault`. */
  readonly surface?: LayoutStoreSurface
  /** The region this surface is, registered page-wide so a panel can move between regions. */
  readonly region?: WorkbenchRegionId
  /** A panel dropped here from another region's drag: the embedder adopts it and drops the source's copy. */
  readonly onDropPanel?: (drop: WorkbenchPanelDrop) => void
  /** Admission shared by native Dockview targets and the foreign empty-edge fallback. */
  readonly acceptPanel?: (panelId: string) => boolean
  /**
   * Whether a drag from another region is accepted over this surface. Dockview
   * asks through the api's own event, which has no React prop.
   */
  readonly acceptDroppedPanel?: (event: DockviewDndOverlayEvent) => void
  /**
   * Where an "Add panel" or a queued open goes. The embedder routes it so a
   * panel already shown in another region moves here instead of being duplicated.
   */
  readonly onOpenPanel?: (definition: WorkbenchPanelDefinition, api: DockviewApi, target?: NewViewSelection) => void
  /** Renders a close control in the header, for a surface the embedder can hide. */
  readonly onClose?: () => void
  /** Composed workspaces reset all presentation owners together, not only this Dockview. */
  readonly onResetLayout?: () => void
  /** Header text; defaults to the workbench title. */
  readonly heading?: string
  /** Main-seat first-run layout; legacy surfaces retain their existing defaults. */
  readonly defaultLayout?: WorkbenchDefaultLayout
  readonly onAddSurface?: () => void
  /**
   * Per-surface actions in the view's header, given the live API and the open
   * panel ids, so a surface can offer the moves it owns.
   */
  readonly headerActions?: (context: { readonly api: DockviewApi | null; readonly openIds: readonly string[]; readonly menu: true }) => JSX.Element | null
}

const usePanelDefinitions = (registry: WorkbenchPanelRegistry) => useSyncExternalStore(registry.subscribe, registry.list, registry.list)

const Chooser = (props: {
  readonly registry: WorkbenchPanelRegistry
  readonly visible: boolean
  readonly onSelect: (definition: WorkbenchPanelDefinition) => void
  readonly onRun: () => void
}): JSX.Element => (
  <NewViewChooser definitions={usePanelDefinitions(props.registry)} onSelect={props.onSelect} onRun={props.onRun} autoFocus={props.visible} />
)

/** What a surface with no saved layout of its own opens with, by the region it is. */
const defaultLayoutOf = (surface: WorkbenchViewProps['surface']): WorkbenchDefaultLayout =>
  surface === 'dock' || surface === 'bottom' || surface === 'side-panel' || surface?.startsWith('nested/') ? 'empty' : 'editor'

export const WorkbenchView = (props: WorkbenchViewProps): JSX.Element => {
  const { registry, store, t, acceptPanel, acceptDroppedPanel, onOpenPanel, region } = props
  const parentVisible = useContext(SurfaceVisibility)
  const defaultLayout = props.defaultLayout ?? defaultLayoutOf(props.surface)
  const permanentCentre = region === 'main' || props.surface === 'main'
  const windowFloats = WindowFloatingGeometry.supports(region)
  const dropBoundary = useRef<HTMLDivElement>(null)
  const [api, setApi] = useState<DockviewApi | null>(null)
  const [openIds, setOpenIds] = useState<readonly string[]>([])
  const selectView = useRef<(definition: WorkbenchPanelDefinition, target?: NewViewSelection) => void>(() => undefined)

  const rowVisibility = useRef<ReturnType<typeof TabRows.retain>>()
  const [rowMenu, setRowMenu] = useState<TabRowMenuTarget | null>(null)
  useLayoutEffect(() => () => rowVisibility.current?.dispose(), [])

  const components = useMemo(() => {
    const RegisteredPanel = (panelProps: IDockviewPanelProps): JSX.Element => {
      const surfaceVisible = useContext(SurfaceVisibility)
      const id = panelProps.api.id
      const sourceId = NewViewTabs.sourceId(panelProps.params, id)
      const visible = useSyncExternalStore(
        listener => {
          const subscription = panelProps.api.onDidVisibilityChange(listener)
          return () => subscription.dispose()
        },
        () => panelProps.api.isVisible,
      )
      const active = useSyncExternalStore(
        listener => {
          const subscription = panelProps.containerApi.onDidActivePanelChange(listener)
          return () => subscription.dispose()
        },
        () => panelProps.containerApi.activePanel?.id === id,
      )
      const definition = useSyncExternalStore(
        registry.subscribe,
        () => registry.get(sourceId),
        () => registry.get(sourceId),
      )
      const activateOnPointer = (event: PointerEvent<HTMLDivElement>): void => {
        if (event.button !== 0 || definition?.tabId === undefined) return
        const ElementClass = event.currentTarget.ownerDocument.defaultView?.Element
        // A nested surface's own body owns its gesture, not an outer presenter.
        if (ElementClass !== undefined && event.target instanceof ElementClass && event.target.closest('[data-workbench-panel-id]') !== event.currentTarget)
          return
        // Pointer capture precedes the browser's default focus. Transfer DOM
        // ownership first so an old pane's focus echo cannot undo this intent.
        if (!event.currentTarget.contains(event.currentTarget.ownerDocument.activeElement)) event.currentTarget.focus({ preventScroll: true })
        workbenchTabs().actions.activate(definition.tabId)
      }
      if (NewViewTabs.isChooser(id) || definition?.newView === true) {
        return (
          <div
            data-workbench-panel-id={id}
            tabIndex={-1}
            className="dshx:group dshx:relative dshx:h-full dshx:min-h-0"
            onPointerDownCapture={activateOnPointer}
          >
            <HiddenTabRowRestore api={panelProps.api} containerApi={panelProps.containerApi} />
            <Chooser
              registry={registry}
              visible={active && visible && surfaceVisible}
              onSelect={definition => selectView.current(definition, { group: panelProps.api.group, replacePanelId: id })}
              onRun={() => panelProps.api.close()}
            />
          </div>
        )
      }
      if (definition === undefined) {
        return (
          <div
            data-workbench-panel-id={id}
            className="dshx-root dshx:group dshx:relative dshx:flex dshx:h-full dshx:flex-col dshx:items-start dshx:gap-3 dshx:p-4 dshx:text-sm dshx:text-muted-foreground"
          >
            <HiddenTabRowRestore api={panelProps.api} containerApi={panelProps.containerApi} />
            <p>{t('missingPanel', { id })}</p>
            <Button size="sm" variant="outline" onClick={() => panelProps.api.close()}>
              {t('closePanel')}
            </Button>
          </div>
        )
      }
      const Panel = definition.component
      return (
        // Keyed main views can contain fixed-position native chrome. Its containing
        // block must be this pane, never the window or a neighboring pane's controls.
        <div
          data-workbench-panel-id={id}
          tabIndex={-1}
          className="dshx:group dshx:relative dshx:h-full dshx:min-h-0 dshx:min-w-0"
          style={{ contain: 'layout paint' }}
          onPointerDownCapture={activateOnPointer}
        >
          <HiddenTabRowRestore api={panelProps.api} containerApi={panelProps.containerApi} />
          <Panel
            panelId={id}
            visible={visible && surfaceVisible}
            onClose={() => {
              definition.beforeClose?.()
              panelProps.api.close()
            }}
          />
        </div>
      )
    }
    return { [WORKBENCH_COMPONENT]: RegisteredPanel }
  }, [registry, t])

  const onReady = (event: DockviewReadyEvent): void => {
    rowVisibility.current?.dispose()
    // Observe group-model additions before native restoration populates members.
    rowVisibility.current = TabRows.retain(event.api, () => store.set(event.api.toJSON()))
    if (windowFloats && dropBoundary.current !== null) WindowFloatingGeometry.prepare(dropBoundary.current)
    WorkbenchLayout.restoreLayout(event.api, store, registry.list(), defaultLayout)
    // Dockview only reports layout changes for later gestures, so without this a freshly applied default layout would
    // stay unsaved until the first drag: a reload would rebuild it from the default instead of restoring what it was.
    store.set(event.api.toJSON())
    setApi(event.api)
  }

  // The surface answers for its region while it is mounted, so a drop in any
  // other region can find the panel here and take it away.
  const onApi = useRef(props.onApi)
  onApi.current = props.onApi
  useLayoutEffect(() => {
    if (api === null) return
    const unregister = props.region === undefined ? undefined : workbenchRegions().set(props.region, api)
    const releaseCentre = permanentCentre ? MainSurfaceGuard.retain(api) : undefined
    // The owner may immediately adopt queued panels at handoff. Observe layout
    // changes before that callback: Dockview can flush them before passive effects.
    const persist = api.onDidLayoutChange(() => store.set(api.toJSON()))
    // Call only after this API is addressable. Inline callback identity changes
    // must not retrigger adoption/navigation on every parent render.
    onApi.current?.(api)
    if (props.region === undefined) {
      for (const id of registry.takeOpenRequests()) {
        selectView.current(registry.get(id) ?? { id, title: id, component: () => null })
      }
    }
    if (api.panels.length === 0) NewViewTabs.open(api)
    // Startup adoption may be buffered or suppressed by Dockview's initialization
    // phase. The ready handoff must persist its final state, not the empty default.
    store.set(api.toJSON())
    return () => {
      releaseCentre?.()
      persist.dispose()
      unregister?.()
    }
  }, [api, props.region, registry, store, permanentCentre])

  const emptyPane = useRef({ visible: props.visible, onClose: props.onClose })
  emptyPane.current = { visible: props.visible, onClose: props.onClose }
  useLayoutEffect(() => {
    if (api === null || region !== 'right') return
    let panelCount = api.panels.length
    // API add/remove events are suppressed during native movingLock, and model
    // removals can expose a transient zero halfway through a split or float.
    // Decide only after the whole mutation, counting floats as well as the grid.
    const mutation = api.onDidMutateLayout(event => {
      const emptied = panelCount > 0 && api.panels.length === 0
      panelCount = api.panels.length
      if (event.kind === 'load' || event.kind === 'clear') return
      if (emptied && emptyPane.current.visible !== false) emptyPane.current.onClose?.()
    })
    return () => mutation.dispose()
  }, [api, region])

  useLayoutEffect(() => {
    // The retained API stays empty after auto-close. A manual reopen needs a
    // chooser, but an explicit resource admission already populated it first.
    if (api !== null && region === 'right' && props.visible !== false && api.panels.length === 0) NewViewTabs.open(api)
  }, [api, region, props.visible])

  // Admission is checked before native mutation too, not only after a drop.
  useEffect(() => {
    if (api === null || acceptPanel === undefined) return
    const subscription = api.onWillDrop(event => {
      const id = event.getData()?.panelId
      if (id === undefined || id === null || acceptPanel?.(id) !== false) return
      event.preventDefault()
      event.nativeEvent.stopPropagation()
    })
    return () => subscription.dispose()
  }, [api, acceptPanel])

  // Dockview checks the drop overlay against this event; accepting a transfer
  // from another region is what lets a panel be dropped here at all.
  useEffect(() => {
    if (api === null || acceptDroppedPanel === undefined) return
    const subscription = api.onUnhandledDragOver(event => {
      const id = event.getData()?.panelId
      if (id !== undefined && id !== null && acceptPanel?.(id) === false) return
      acceptDroppedPanel?.(event)
    })
    return () => subscription.dispose()
  }, [api, acceptDroppedPanel, acceptPanel])

  const onDidDrop = (event: DockviewDidDropEvent): void => {
    const panelId = event.getData()?.panelId
    if (api === null || panelId === undefined || panelId === null || acceptPanel?.(panelId) === false) return
    props.onDropPanel?.(event.group === undefined ? { panelId, api, position: event.position } : { panelId, api, group: event.group, position: event.position })
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

  useLayoutEffect(() => {
    const boundary = dropBoundary.current
    if (!windowFloats || boundary === null || api === null) return
    return WindowFloatingGeometry.retain(boundary, api)
  }, [api, windowFloats])
  const dropPanel = props.onDropPanel
  useLayoutEffect(() => {
    const boundary = dropBoundary.current
    if (boundary === null || api === null) return
    // Outer Dockviews see capture before an inner surface. Veto their overlay
    // before they mark the event used, leaving the deepest surface in charge.
    const overlay = api.onWillShowOverlay(event => {
      const target = event.nativeEvent.target
      if (!(target instanceof Element)) return
      const owner = target.closest('[data-workbench-surface]')
      if (owner !== null && owner !== boundary) event.preventDefault()
    })
    // Dockview listens natively. React's delegated bubble runs after a containing
    // Dockview, so contain the gesture at this boundary, after our own targets.
    const onOver = (event: DragEvent): void => {
      const transfer = getPanelData()
      if (transfer === undefined) return
      event.stopPropagation()
      if (transfer.viewId === api.id || transfer.panelId === null || acceptPanel?.(transfer.panelId) === false) return
      event.preventDefault()
    }
    const onEnter = (event: DragEvent): void => {
      const transfer = getPanelData()
      if (transfer === undefined) return
      event.stopPropagation()
      if (transfer.viewId === api.id || transfer.panelId === null || acceptPanel?.(transfer.panelId) === false) return
      event.preventDefault()
      enterForeignDrag()
    }
    const onDrop = (event: DragEvent): void => {
      const transfer = getPanelData()
      if (transfer === undefined) return
      event.stopPropagation()
      endForeignDrag()
      if (transfer.viewId === api.id || transfer.panelId === null || acceptPanel?.(transfer.panelId) === false) return
      event.preventDefault()
      dropPanel?.({ panelId: transfer.panelId, api })
    }
    boundary.addEventListener('dragover', onOver)
    boundary.addEventListener('dragenter', onEnter)
    boundary.addEventListener('dragleave', leaveForeignDrag)
    boundary.addEventListener('drop', onDrop)
    return () => {
      overlay.dispose()
      boundary.removeEventListener('dragover', onOver)
      boundary.removeEventListener('dragenter', onEnter)
      boundary.removeEventListener('dragleave', leaveForeignDrag)
      boundary.removeEventListener('drop', onDrop)
    }
  }, [api, acceptPanel, dropPanel])

  useEffect(() => {
    if (!foreignDragOver) return
    // A drag that ends anywhere else (Escape, or a target that took the drop)
    // must not leave the surface marked as the drop target.
    const reset = (): void => endForeignDrag()
    document.addEventListener('dragend', reset)
    return () => document.removeEventListener('dragend', reset)
  }, [foreignDragOver])

  const open = useCallback(
    (definition: WorkbenchPanelDefinition, selection?: NewViewSelection): void => {
      if (api === null) return
      const target = selection ?? {}
      target.group?.api.setActive()
      if (definition.allowMultiple) {
        const options = {
          id: `view/${definition.id}/${crypto.randomUUID()}`,
          component: WORKBENCH_COMPONENT,
          title: definition.title,
          params: { sourceId: definition.id },
        }
        const panel =
          target.group === undefined ? api.addPanel(options) : api.addPanel({ ...options, position: { referenceGroup: target.group, direction: 'within' } })
        if (target.replacePanelId !== undefined) registry.get(target.replacePanelId)?.beforeClose?.()
        NewViewTabs.completeSelection(api, panel.id, target)
        return
      }
      if (onOpenPanel !== undefined) onOpenPanel(definition, api, selection)
      else WorkbenchLayout.openPanel(api, definition)
      const snapshot = workbenchTabs().getSnapshot()
      const semantic = snapshot.tabs.find(tab => tab.target.kind === 'panel' && tab.target.panelId === definition.mainPanelId && tab.target.scope === undefined)
      const panel = api.panels.find(
        candidate => candidate.id === definition.id || (semantic !== undefined && registry.get(candidate.id)?.tabId === semantic.id),
      )
      if (panel === undefined) return
      if (target.replacePanelId !== undefined) registry.get(target.replacePanelId)?.beforeClose?.()
      NewViewTabs.completeSelection(api, panel.id, target)
    },
    [api, onOpenPanel, registry],
  )
  selectView.current = open

  useEffect(() => {
    if (api === null) return
    const syncOpenIds = (): void => {
      if (api.panels.length === 0 && region !== 'right') NewViewTabs.open(api)
      setOpenIds(api.panels.map(panel => panel.id))
    }
    syncOpenIds()
    const activate = api.onDidActivePanelChange(event => {
      const panel = event.panel
      const tabId = panel === undefined ? undefined : registry.get(panel.id)?.tabId
      if (event.origin !== 'user' || panel === undefined || tabId === undefined) return
      // Dockview also labels stale cross-region focus notifications as 'user'.
      // Only the target's actual body focus or its native keyboard tablist may
      // translate that notification into semantic navigation.
      const focused = panel.group.element.ownerDocument.activeElement
      const bodyOwnsFocus = focused?.closest('[data-workbench-panel-id]')?.getAttribute('data-workbench-panel-id') === panel.id
      const headerOwnsFocus = focused !== null && panel.group.element.contains(focused) && focused.closest('[role="tablist"]') !== null
      if (bodyOwnsFocus || headerOwnsFocus) workbenchTabs().actions.activate(tabId)
      else {
        // Rejecting an echo must also undo its local presentation drift. Never
        // pull the canonical tab from another region or navigate the actor.
        const activeTabId = workbenchTabs().getSnapshot().activeTabId
        const canonical = api.panels.find(candidate => registry.get(candidate.id)?.tabId === activeTabId)
        if (canonical !== undefined && api.activePanel?.id !== canonical.id) canonical.api.setActive()
      }
    })
    let userDrag: string | null = null
    const beforeDrag = api.onWillDragPanel(event => {
      userDrag = event.panel.id
    })
    const reorder = api.onDidMovePanel(event => {
      if (event.panel.id !== userDrag) return
      const channel = workbenchTabs()
      const move = semanticTabMove({
        movedPanelId: event.panel.id,
        orderedPanelIds: event.panel.group.panels.map(panel => panel.id),
        registry,
        snapshot: channel.getSnapshot(),
      })
      if (move !== null) channel.actions.move(move.tabId, move.toIndex)
    })
    const finishDrag = (): void => {
      userDrag = null
    }
    document.addEventListener('dragend', finishDrag)
    const layoutChanges = api.onDidLayoutChange(syncOpenIds)
    // Standalone legacy views consume requests locally. Composed regions have
    // one routing owner in client.tsx, so retained/hidden surfaces cannot race.
    const takeOpenRequests = (): void => {
      // Saved layouts keep stable IDs, not outdated copy. Refresh only reusable
      // template titles; never overwrite semantic/user/resource occurrence names.
      for (const panel of api.panels) {
        const definition = registry.get(NewViewTabs.sourceId(panel.toJSON().params, panel.id))
        if (
          definition !== undefined &&
          definition.tabId === undefined &&
          !definition.hiddenFromAdd &&
          definition.title.includes(': ') &&
          panel.title !== definition.title
        )
          panel.api.setTitle(definition.title)
      }
      if (region !== undefined) return
      for (const id of registry.takeOpenRequests()) open(registry.get(id) ?? { id, title: id, component: () => null })
    }
    takeOpenRequests()
    const unsubscribe = registry.subscribe(takeOpenRequests)
    return () => {
      layoutChanges.dispose()
      activate.dispose()
      beforeDrag.dispose()
      reorder.dispose()
      document.removeEventListener('dragend', finishDrag)
      unsubscribe()
    }
  }, [api, registry, region, open])

  const Tab = useMemo(() => createWorkbenchTab(registry), [registry])
  // Dockview retains header components; refs keep callbacks and menu contents current.
  const actions = useRef({ props, api, openIds })
  actions.current = { props, api, openIds }
  const GroupActions = useMemo(
    () =>
      function GroupActions(groupProps: IDockviewHeaderActionsProps): JSX.Element {
        return (
          <SurfaceAction
            label="New tab"
            icon={<PlusIcon aria-hidden />}
            iconOnly
            onPointerDown={event => event.stopPropagation()}
            onClick={event => {
              event.stopPropagation()
              NewViewTabs.open(groupProps.containerApi, groupProps.group)
            }}
          />
        )
      },
    [],
  )
  const PaneActions = useMemo(
    () =>
      function PaneActions(groupProps: IDockviewHeaderActionsProps): JSX.Element {
        const [, refresh] = useState(0)
        const groupCount = useSyncExternalStore(
          listener => {
            const subscription = groupProps.containerApi.onDidLayoutChange(listener)
            return () => subscription.dispose()
          },
          () => (permanentCentre ? MainSurfaceGuard.groups(groupProps.containerApi).length : groupProps.containerApi.groups.length),
        )
        const current = actions.current
        const canClose = permanentCentre
          ? MainSurfaceGuard.groups(groupProps.containerApi).some(group => group !== groupProps.group)
          : current.props.onClose !== undefined || groupCount > 1
        return (
          <div className="dshx-root dshx:flex dshx:items-center dshx:gap-0.5">
            <DropdownMenu
              onOpenChange={shown => {
                if (shown) {
                  groupProps.group.api.setActive()
                  refresh(version => version + 1)
                }
              }}
            >
              <DropdownMenuTrigger asChild>
                <SurfaceAction label="Pane options" icon={<EllipsisIcon aria-hidden />} iconOnly onPointerDown={event => event.stopPropagation()} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {current.props.headerActions?.({ api: current.api, openIds: current.openIds, menu: true })}
                <DropdownMenuItem onSelect={() => NewViewTabs.open(groupProps.containerApi, groupProps.group, 'right')}>Split right</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => NewViewTabs.open(groupProps.containerApi, groupProps.group, 'below')}>Split down</DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    if (current.props.onResetLayout !== undefined) current.props.onResetLayout()
                    else {
                      store.remove()
                      WorkbenchLayout.applyDefaultLayout(groupProps.containerApi, registry.list(), defaultLayout)
                      onApi.current?.(groupProps.containerApi)
                      if (groupProps.containerApi.panels.length === 0) NewViewTabs.open(groupProps.containerApi)
                      store.set(groupProps.containerApi.toJSON())
                    }
                  }}
                >
                  {t('resetLayout')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {canClose && (
              <SurfaceAction
                label="Close pane"
                icon={<XIcon aria-hidden />}
                iconOnly
                onClick={() => {
                  const neighbors = permanentCentre ? MainSurfaceGuard.groups(groupProps.containerApi) : groupProps.containerApi.groups
                  const neighbor = neighbors.find(group => group !== groupProps.group)
                  if (neighbor === undefined) {
                    if (!permanentCentre) current.props.onClose?.()
                  } else {
                    // Close a split, not its resources: merge its tabs into the neighbor.
                    for (const panel of [...groupProps.group.panels]) panel.api.moveTo({ group: neighbor, position: 'center' })
                  }
                }}
              />
            )}
          </div>
        )
      },
    [defaultLayout, registry, store, t, permanentCentre],
  )

  return (
    <SurfaceVisibility.Provider value={parentVisible && props.visible !== false}>
      <div data-workbench-region={region} className="dshx-root dshx:@container dshx:flex dshx:h-full dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:flex-col">
        <div
          className={cn('dshx:relative dshx:min-h-0 dshx:flex-1', foreignDragOver && 'dshx:ring-2 dshx:ring-ring/60 dshx:ring-inset')}
          ref={dropBoundary}
          data-workbench-surface=""
          data-workbench-window-floats={windowFloats ? '' : undefined}
          onContextMenu={event => {
            if (event.defaultPrevented || api === null) return
            const ElementClass = event.currentTarget.ownerDocument.defaultView?.Element
            if (ElementClass === undefined || !(event.target instanceof ElementClass)) return
            const row = event.target.closest('.dv-tabs-and-actions-container')
            if (row === null || row.closest('[data-workbench-surface]') !== event.currentTarget || event.target.closest('[role="tab"],button,input')) return
            const group = api.groups.find(candidate => candidate.element.contains(row))
            if (group === undefined) return
            event.preventDefault()
            event.stopPropagation()
            setRowMenu({ group, x: event.clientX, y: event.clientY })
          }}
        >
          <DockviewReact
            components={components}
            defaultTabComponent={Tab}
            leftHeaderActionsComponent={GroupActions}
            rightHeaderActionsComponent={PaneActions}
            defaultRenderer="always"
            {...(windowFloats ? { floatingGroupBounds: 'boundedWithinViewport' as const } : {})}
            theme={workbenchTheme}
            onReady={onReady}
            onDidDrop={onDidDrop}
          />
        </div>
        {api !== null && <TabRowVoidMenu api={api} target={rowMenu} dismiss={() => setRowMenu(null)} />}
      </div>
    </SurfaceVisibility.Provider>
  )
}
