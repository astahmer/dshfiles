import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient, useSettings } from '@dshfiles/dshx/client'
import type { RightPanelMode } from '@dshfiles/frame-layout/regions'
// Type-only: the frame's right-column seat and the `shell.dock` slot it declares.
import type {} from '@dshfiles/frame-layout/regions'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@dshfiles/plugin-ui/components/ui/dialog'
import { Input } from '@dshfiles/plugin-ui/components/ui/input'
import { DropdownMenuItem, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { LayoutGridIcon, LayoutTemplateIcon, MoveIcon, PanelBottomIcon, PanelRightOpenIcon } from '@dshfiles/plugin-ui/icons'
import type { DockviewApi, DockviewDndOverlayEvent, DockviewGroupPanel } from 'dockview-react'
import dockviewSheet from 'virtual:dshfiles-workbench/dockview-css'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { z } from 'zod'
import { demoPanels } from './demo-panels.js'
import { workbenchRegions, type WorkbenchRegionId } from './dock-regions.js'
import { createLayoutStore, WorkbenchLayout, WORKBENCH_COMPONENT } from './layout-store.js'
import { WORKBENCH_LOCALE_NAMESPACE, workbenchLocale } from './locales.js'
import { workbenchPanels, NativeAsideOwners, type WORKBENCH_MAIN_PANEL_ID, type WorkbenchPanelDefinition } from './registry.js'
import { createDockPaneActions, migrateDockVisibility, rightPaneVisibility } from './right-panel-mode.js'
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots'
import { createMainPanelSources } from './panel-sources.js'
import { createTabPanelAdapter } from './tab-panels.js'
import { createSemanticPanelOpener } from './semantic-panel-opener.js'
import { createResettableAsidePlacement, WorkbenchReset } from './reset-layout.js'
import { ConversationPanels } from './conversation-panels.js'
import { semanticLayouts } from './semantic-layouts.js'
import { createWorkbenchThreadPanel, WORKBENCH_CONVERSATION_SLOT, WORKBENCH_THREAD_CHILDREN, WorkbenchThreadConversation } from './thread-panel.js'
import { WorkbenchTabDocking, workbenchTabs } from './tabs.js'
import { canMovePanelToRegion, createNestedSurfaceRegistry, type NestedSurfaceProps } from './nested-surfaces.js'
import { nestedLayoutStores, nestedSurfacePathSchema } from './layout-store.js'
import { sidebarResourcePanels } from '@dshfiles/sidebar-right/resource-panels'
import { ResourcePanelHost } from './resource-panel-host.js'
import { createWorkbenchTerminalSource } from './terminal-source.js'
import { captureLayoutArrangement, restoreLayoutArrangement } from './layout-arrangements.js'
import { SavedLayouts, savedLayouts, type SavedLayout } from './saved-layouts.js'
import { workbenchSettings } from './settings.js'
import { WorkbenchView, type WorkbenchPanelDrop } from './workbench-view.js'
import { NewViewTabs } from './new-view.js'
import { TabRows } from './tab-row-visibility.js'
import { SidebarPreviewMigration } from './sidebar-preview-migration.js'

// A literal so dshx's slot-occupancy check can read the id; `satisfies` keeps it equal to the exported contract.
const PANEL_ID = 'dshfiles-workbench' satisfies typeof WORKBENCH_MAIN_PANEL_ID
const RIGHT_PANE_ID = '@dshfiles/workbench/side-panel'
const RIGHT_PANE_KIND = 'dshfiles-workbench-side-panel'
const PANEL_ASIDE_EVENT = 'dshfiles:move-panel-aside'
const panelAsideRequestSchema = z.object({ panelId: z.string().min(1) }).strict()
const TOGGLE_COMMAND_ID = 'workbench.toggleSidePanel'
const SHEET_SELECTOR = 'style[data-dshfiles-workbench-sheet]'

/**
 * Dockview's structural CSS and our token theme, injected on first mount. Kept out of `client.css` so the shared
 * Tailwind sheet keeps the content hash every other plugin emits, and off pages that never open the workbench.
 */
const useDockviewSheet = (): void => {
  useLayoutEffect(() => {
    if (document.querySelector(SHEET_SELECTOR) !== null) return
    const sheet = document.createElement('style')
    sheet.dataset.dshfilesWorkbenchSheet = ''
    sheet.textContent = dockviewSheet
    document.head.appendChild(sheet)
  }, [])
}

export default defineClient({
  name: '@dshfiles/workbench',
  locales: [workbenchLocale],
  inject: ['slots', 'layout', 'sidebarRightTabs', 'sidebarRight', 'shortcuts', 'sessions', 'mainSurface', 'rightPanel', 'frameBottom'],
  setup(ctx, decorate) {
    const translate = ctx.locale.bind(WORKBENCH_LOCALE_NAMESPACE)
    const registry = workbenchPanels()
    const terminalSource = createWorkbenchTerminalSource(sidebarResourcePanels(), registry)
    ctx.effect(() => {
      const unregister = registry.register(terminalSource.definition)
      return () => {
        terminalSource.clear()
        unregister()
      }
    }, 'workbench: native terminal launcher')
    const nativeAside = createResettableAsidePlacement<DockviewApi>((api, panelId) => {
      const definition = registry.get(panelId)
      if (definition !== undefined) WorkbenchLayout.openPanel(api, definition)
    })
    ctx.effect(() => () => nativeAside.dispose(), 'workbench: native aside placement lifetime')
    const ThreadPanel = createWorkbenchThreadPanel(ctx.sessions)
    const store = createLayoutStore()
    const sideStore = createLayoutStore({ surface: 'side-panel' })
    const dockStore = createLayoutStore({ surface: 'dock' })
    const bottomStore = createLayoutStore({ surface: 'bottom' })
    const leftStore = createLayoutStore({ surface: 'left' })
    const sidebarPreviewMigration = SidebarPreviewMigration.create()
    let syncMainTabs: (() => void) | undefined
    let resettingLayout = false
    const dockActions = createDockPaneActions()
    ctx.effect(() => {
      // Legacy settings are decode-only compatibility data, never renderer choices.
      ctx.get('mainSurface')?.setMode('workbench')
      const disposeDock = ctx.get('rightPanel')?.registerDock?.(dockActions)
      return () => {
        disposeDock?.()
        ctx.get('mainSurface')?.setMode('native')
      }
    }, 'workbench: unified pane ownership')

    // The slot ledger erases the brand; an id is a MainPanelId exactly when `main` registers it.
    const isMainPanelId = (id: string): id is MainPanelId => ctx.slots.entriesOfSlot('main').some(entry => entry.options.key === id)

    // Settings are only readable from components, so the views that show panels hold the developer fixtures while the flag is on.
    const demos = demoPanels(translate)
    let demoHolders = 0
    let releaseDemos: (() => void) | undefined
    const useDemoPanels = (): void => {
      const enabled = useSettings(workbenchSettings).value?.demoPanels === true
      useEffect(() => {
        if (!enabled) return
        demoHolders += 1
        if (demoHolders === 1) {
          const disposers = demos.map(panel => registry.register(panel))
          releaseDemos = () => disposers.forEach(dispose => dispose())
        }
        return () => {
          demoHolders -= 1
          if (demoHolders > 0) return
          releaseDemos?.()
          releaseDemos = undefined
        }
      }, [enabled])
    }
    ctx.effect(() => () => releaseDemos?.(), 'workbench: developer panels')
    ctx.effect(() => () => document.querySelector(SHEET_SELECTOR)?.remove(), 'workbench: dockview sheet')
    ctx.effect(
      () =>
        registry.subscribe(() => {
          // Subscribed before the view mounts, so this sees a request first and brings the workbench to front. While
          // the dock owns the right column the dock's own view takes the request instead, and the main view stays put.
          if (
            registry.hasOpenRequests() &&
            ctx.get('mainSurface')?.mode() !== 'workbench' &&
            isMainPanelId(PANEL_ID) &&
            ctx.get('rightPanel')?.mode() !== 'dock'
          )
            ctx.layout.selectPanel(PANEL_ID)
        }),
      'workbench: open requests',
    )

    ctx.slots.inject('main', () =>
      ctx.slots.register(
        { name: 'main', key: PANEL_ID, locale: WORKBENCH_LOCALE_NAMESPACE },
        decorate(props => {
          useDockviewSheet()
          useDemoPanels()
          return (
            <WorkbenchView
              registry={registry}
              onResetLayout={resetLayout}
              store={store}
              region="main"
              t={props.t}
              onOpenPanel={openIn('main')}
              onDropPanel={handleDrop('main')}
              acceptDroppedPanel={acceptsForeignPanel}
              onApi={api => drainPendingOpen('main', api)}
              headerActions={context => (
                <>
                  <LayoutsMenu />
                  <MoveMenu from="main" {...context} />
                </>
              )}
            />
          )
        }),
      ),
    )

    ctx.slots.inject(WORKBENCH_CONVERSATION_SLOT, () => ctx.slots.register({ name: WORKBENCH_CONVERSATION_SLOT }, WorkbenchThreadConversation))

    // The frame is the main-slot declarer. Its occupant receives a render capability,
    // never a private component or a second copy of the slot registry.
    ctx.slots.inject('shell.main', () =>
      ctx.slots.register(
        { name: 'shell.main', locale: WORKBENCH_LOCALE_NAMESPACE, children: WORKBENCH_THREAD_CHILDREN },
        decorate(props => {
          useDockviewSheet()
          useDemoPanels()
          const { renderMain, renderSlot: renderConversationSlot, SessionProvider } = props
          const [ready, setReady] = useState(false)
          const sources = useMemo(() => createMainPanelSources(registry), [])
          const renderMainRef = useRef(props.renderMain)
          renderMainRef.current = props.renderMain
          useEffect(() => () => sources.dispose(), [sources])
          const version = useSyncExternalStore(
            listener => {
              const off = [ctx.slots.subscribe('main', listener), ctx.slots.subscribe('sidebar.panellist', listener), ctx.locale.subscribe(listener)]
              return () => off.forEach(dispose => dispose())
            },
            () => `${ctx.slots.getVersion('main')}:${ctx.slots.getVersion('sidebar.panellist')}:${ctx.locale.getLocale().revision}`,
          )
          useLayoutEffect(() => {
            const mainEntries = ctx.slots.entriesOfSlot('main')
            const navigation = ctx.slots.entriesOfSlot('sidebar.panellist')
            sources.sync(
              mainEntries.flatMap(entry => {
                const key = entry.options.key
                if (key === undefined) return []
                const nav = navigation.find(candidate => candidate.options.id === key)
                return [
                  {
                    key,
                    title: resolveSlotLabel((nav ?? entry).options.label) ?? key.replace(/^dshfiles-/u, '').replaceAll('-', ' '),
                    hiddenFromAdd: nav === undefined,
                  },
                ]
              }),
              props.renderMain,
            )
            setReady(true)
          }, [version, props.renderMain, sources])
          useLayoutEffect(() => {
            const component: WorkbenchPanelDefinition['component'] = panel => {
              const tabs = useSyncExternalStore(workbenchTabs().subscribe, workbenchTabs().getSnapshot)
              const blank = ConversationPanels.blank(tabs)
              // Legacy global-following aliases must never mount a second input
              // for a Session already owned by a fixed semantic conversation tab.
              if (tabs.enabled && (panel.panelId !== 'conversation' || !blank)) return null
              return renderMainRef.current('conversation')
            }
            const releases = [
              registry.register({ id: 'conversation', title: 'New thread', hiddenFromAdd: true, component }),
              registry.register({ id: 'current-conversation', title: 'Conversation', hiddenFromAdd: true, component }),
            ]
            return () => releases.forEach(release => release())
          }, [])
          const syncTabs = useRef<() => void>(() => undefined)
          useEffect(() => {
            const adapter = createTabPanelAdapter({
              registry,
              thread: sessionId => () => (
                <ThreadPanel
                  sessionId={sessionId}
                  SessionProvider={SessionProvider}
                  renderConversation={() => renderConversationSlot(WORKBENCH_CONVERSATION_SLOT, {})}
                />
              ),
              panel: (panelId, scope) => {
                const contributor = registry.list().find(panel => panel.mainPanelId === panelId && !panel.hiddenFromAdd)
                if (scope !== undefined && contributor?.scopedComponent !== undefined) {
                  const Panel = contributor.scopedComponent
                  return panelProps => <Panel {...panelProps} panelId={contributor.id} scope={scope} />
                }
                if (scope === undefined && contributor !== undefined) {
                  const Panel = contributor.component
                  return panelProps => <Panel {...panelProps} panelId={contributor.id} />
                }
                if (scope !== undefined)
                  return () => (
                    <p className="dshx-root dshx:p-4 dshx:text-sm dshx:text-muted-foreground">
                      This panel owner does not provide an independent renderer for this scope. Open its original main view instead.
                    </p>
                  )
                return () => renderMain(panelId)
              },
              surfaces: () => regions.entries().map(([, api]) => api),
              open: id => semanticPanelOpener.place(id),
              scopeLayouts: { capture: captureLayout, restore: applyLayout },
            })
            const sync = (): void => {
              if (resettingLayout) return
              adapter.sync()
              const snapshot = workbenchTabs().getSnapshot()
              const blank = ConversationPanels.blank(snapshot)
              ConversationPanels.reconcile({
                snapshot,
                blank: blank && ctx.layout.panelInfo.getSnapshot().activePanelId === null,
                surfaces: regions.entries().map(([, api]) => api),
                openBlank: () => openInRegion('main', 'conversation'),
              })
              if (!snapshot.enabled && registry.get('conversation') !== undefined && !regions.holds('conversation'))
                openInRegion(savedRegionOf('conversation') ?? 'main', 'conversation')
            }
            syncTabs.current = sync
            syncMainTabs = sync
            const unsubscribe = workbenchTabs().subscribe(sync)
            sync()
            return () => {
              unsubscribe()
              if (syncMainTabs === sync) syncMainTabs = undefined
              adapter.dispose()
            }
          }, [renderMain, renderConversationSlot, SessionProvider])
          useEffect(() => {
            const follow = (requested?: string | null): void => {
              const id = requested === undefined ? ctx.layout.panelInfo.getSnapshot().activePanelId : requested
              if (id === PANEL_ID) return
              const tabs = workbenchTabs().getSnapshot()
              if (tabs.enabled) {
                if (id === null && ConversationPanels.blank(tabs)) {
                  openInRegion('main', 'conversation')
                  return
                }
                const tab =
                  tabs.tabs.find(candidate => candidate.target.kind === 'panel' && candidate.target.panelId === id && candidate.id === tabs.activeTabId) ??
                  tabs.tabs.find(candidate => candidate.target.kind === 'panel' && candidate.target.panelId === id)
                const definition = tab === undefined ? undefined : registry.list().find(panel => panel.tabId === tab.id)
                if (definition !== undefined) for (const [, api] of regions.entries()) api.getPanel(definition.id)?.api.setActive()
                return
              }
              const definition = registry.list().find(panel => panel.mainPanelId === id || (id === null && panel.id === 'conversation'))
              if (definition !== undefined) {
                const owner = regions.entries().find(([, api]) => api.getPanel(definition.id) !== undefined)
                openInRegion(owner?.[0] ?? 'main', definition.id)
              }
            }
            // Restore the saved surface's active panel before accepting new navigation.
            // The native blank key at boot is not a user request to replace that selection.
            if (store.get() === null) follow()
            const seat = ctx.get('mainSurface')
            return seat?.subscribePanelRequests?.(follow) ?? ctx.layout.panelInfo.subscribe(() => follow())
          }, [])
          if (!ready) return null
          return (
            <WorkbenchView
              registry={registry}
              onResetLayout={resetLayout}
              store={store}
              region="main"
              defaultLayout="conversation"
              t={props.t}
              onOpenPanel={openIn('main')}
              onDropPanel={handleDrop('main')}
              acceptDroppedPanel={acceptsForeignPanel}
              onApi={api => {
                drainPendingOpen('main', api)
                syncTabs.current()
              }}
              onAddSurface={() => addNestedSurface('main')}
              headerActions={context => (
                <>
                  <ToggleRightPanel />
                  <ToggleBottomPanel />
                  <LayoutsMenu />
                  <MoveMenu from="main" {...context} />
                </>
              )}
            />
          )
        }),
      ),
    )

    ctx.effect(
      () =>
        ctx.sidebarRightTabs.register({
          id: RIGHT_PANE_ID,
          kind: RIGHT_PANE_KIND,
          keepMounted: true,
          title: () => translate('title'),
          guide: [
            {
              id: 'workbench',
              order: 46,
              title: () => translate('title'),
              description: () => translate('sidePanelGuide'),
              icon: (props: { readonly size?: number | undefined }) => <LayoutGridIcon aria-hidden size={props.size ?? 18} />,
            },
          ],
        }),
      'workbench: right pane tab type',
    )
    // The workbench has a main page and a per-thread side-panel tab. Moving between them is this plugin's business, so
    // it answers the strip's request and offers the reverse row on its own side-panel tab.
    ctx.effect(() => {
      const onMovePanelAside = (event: Event): void => {
        if (!(event instanceof CustomEvent) || event.defaultPrevented) return
        const request = panelAsideRequestSchema.safeParse(event.detail)
        const sessionId = ctx.sidebarRight.mounted.getSnapshot()
        if (!request.success || sessionId === undefined) return
        const native = NativeAsideOwners.request(request.data.panelId)
        if (native !== 'unowned') {
          if (native === 'accepted') event.preventDefault()
          return
        }
        const definition = registry.list().find(panel => panel.id === request.data.panelId || panel.mainPanelId === request.data.panelId)
        if (request.data.panelId !== PANEL_ID && definition === undefined) return
        event.preventDefault()
        ctx.sidebarRight.openTab(RIGHT_PANE_KIND, { revealIfOpened: true })
        // The native pane is Session-scoped, not shell.dock. A generic registry request would select main first.
        if (definition !== undefined) nativeAside.request(sessionId, definition.id)
      }
      window.addEventListener(PANEL_ASIDE_EVENT, onMovePanelAside)
      return () => window.removeEventListener(PANEL_ASIDE_EVENT, onMovePanelAside)
    }, 'workbench: move the panel into the side panel')
    ctx.effect(
      () =>
        ctx.slots.inject('sidebar.right.tab.menu.item', () =>
          ctx.slots.register(
            { name: 'sidebar.right.tab.menu.item', id: 'workbench-move-to-main', order: 10 },
            (props: PropsRuntime<'sidebar.right.tab.menu.item'>) => {
              if (props.tab.kind !== RIGHT_PANE_KIND) return null
              return (
                <button
                  type="button"
                  role="menuitem"
                  className="dshx:flex dshx:w-full dshx:cursor-pointer dshx:items-center dshx:rounded-(--dsw-radius-md) dshx:border-none dshx:bg-transparent dshx:px-[7px] dshx:py-1 dshx:text-left dshx:text-[length:calc(var(--dsh-content-font-size-secondary,13px)-1px)] dshx:text-(--dsw-alias-label-primary) dshx:hover:bg-(--dsw-alias-interactive-bg-hover)"
                  onClick={() => {
                    props.dismiss()
                    if (ctx.sidebarRight.mounted.getSnapshot() !== undefined) ctx.sidebarRight.close(props.tab.id)
                    if (isMainPanelId(PANEL_ID)) ctx.layout.selectPanel(PANEL_ID)
                  }}
                >
                  {translate('moveToMainView')}
                </button>
              )
            },
          ),
        ),
      'workbench: move the side-panel workbench to the main view',
    )
    // Every region keeps its own Dockview instance, so moving a panel between
    // them is this plugin's business: a panel lives in exactly one region, and
    // adopting it somewhere else drops the copy the source held. A drag inside
    // one instance is Dockview's own business; a drag onto another arrives as a
    // foreign PanelTransfer, which the target accepts here and then adopts.
    const regions = workbenchRegions()
    /** A panel asked for a region that is not mounted yet, consumed when its surface reports ready. */
    const pendingOpen = new Map<WorkbenchRegionId, Set<string>>()

    const closeElsewhere = (region: WorkbenchRegionId, panelId: string): void => {
      for (const [id, api] of regions.entries()) {
        if (id !== region) api.getPanel(panelId)?.api.close()
      }
    }

    /** Preserve the source renderer identity when moving a chooser or a repeatable view. */
    const panelPlacement = (panelId: string) => {
      const existing = regions
        .entries()
        .map(([, api]) => api.toJSON().panels[panelId])
        .find(panel => panel !== undefined)
      const definition = registry.get(NewViewTabs.sourceId(existing?.params, panelId))
      if (definition === undefined && !NewViewTabs.isChooser(panelId)) return undefined
      return {
        id: panelId,
        component: WORKBENCH_COMPONENT,
        title: existing?.title ?? definition?.title ?? 'New tab',
        params: existing?.params ?? {},
      }
    }

    const adoptPanel = (input: {
      readonly region: WorkbenchRegionId
      readonly api: DockviewApi
      readonly panelId: string
      readonly position?: { readonly referenceGroup: DockviewGroupPanel; readonly direction: 'within' | 'left' | 'right' | 'above' | 'below' }
    }): void => {
      const placement = panelPlacement(input.panelId)
      if (placement === undefined || !canMovePanelToRegion(input.panelId, input.region)) return
      const existing = input.api.getPanel(input.panelId)
      if (existing === undefined) {
        input.api.addPanel(input.position === undefined ? placement : { ...placement, position: input.position })
      } else existing.api.setActive()
      // A panel lives in exactly one region: the source's copy goes whether this
      // region had to add the panel or already showed it.
      closeElsewhere(input.region, input.panelId)
    }

    const handleDrop =
      (region: WorkbenchRegionId) =>
      (drop: WorkbenchPanelDrop): void => {
        const direction: 'above' | 'below' | 'left' | 'right' | 'within' =
          drop.position === 'top'
            ? 'above'
            : drop.position === 'bottom'
              ? 'below'
              : drop.position === 'left'
                ? 'left'
                : drop.position === 'right'
                  ? 'right'
                  : 'within'
        const position = drop.group === undefined ? undefined : { referenceGroup: drop.group, direction }
        adoptPanel(position === undefined ? { region, api: drop.api, panelId: drop.panelId } : { region, api: drop.api, panelId: drop.panelId, position })
      }

    const acceptsForeignPanel = (event: DockviewDndOverlayEvent): void => {
      const panelId = event.getData()?.panelId
      if (panelId !== undefined && panelId !== null && regions.holds(panelId)) event.accept()
    }

    const moveToMainView = (api: DockviewApi, panelId: string): void => {
      const target = registry.get(panelId)?.mainPanelId
      if (target === undefined || !isMainPanelId(target)) return
      api.getPanel(panelId)?.api.close()
      ctx.layout.selectPanel(target)
    }

    const savedRegionOf = (panelId: string): WorkbenchRegionId | undefined => {
      if (store.get()?.panels[panelId] !== undefined) return 'main'
      if (dockStore.get()?.panels[panelId] !== undefined) return 'right'
      if (bottomStore.get()?.panels[panelId] !== undefined) return 'bottom'
      if (leftStore.get()?.panels[panelId] !== undefined) return 'left'
      for (const [path, saved] of Object.entries(nestedLayoutStores.capture()))
        if (saved?.panels[panelId] !== undefined) return nestedSurfacePathSchema.parse(path)
      return undefined
    }
    const seatSidebarPreview = (api: DockviewApi): void => {
      const preview = registry.get(SidebarPreviewMigration.panelId)
      if (preview === undefined) return
      sidebarPreviewMigration.seat({
        alreadyPlaced: () => regions.holds(preview.id) || savedRegionOf(preview.id) !== undefined,
        place: () => {
          const active = api.activePanel
          // API insertion order is not visual order (Navigation was inserted
          // above Threads). Seat the former footer below the lowest docked group.
          const reference = api.groups.filter(group => group.api.location.type === 'grid').reduce<DockviewGroupPanel | undefined>((bottom, candidate) => {
            if (bottom === undefined) return candidate
            return candidate.element.getBoundingClientRect().bottom > bottom.element.getBoundingClientRect().bottom ? candidate : bottom
          }, undefined) ?? api.addGroup()
          api.addPanel({
            id: preview.id,
            component: WORKBENCH_COMPONENT,
            title: preview.title,
            position: { referenceGroup: reference, direction: 'below' },
            initialHeight: 76,
            minimumHeight: 32,
          })
          active?.api.setActive()
          leftStore.set(api.toJSON())
        },
      })
    }
    const drainPendingOpen = (region: WorkbenchRegionId, api: DockviewApi): void => {
      const panelIds = pendingOpen.get(region)
      if (panelIds === undefined) return
      pendingOpen.delete(region)
      for (const panelId of panelIds) adoptPanel({ region, api, panelId })
    }

    /**
     * Show a panel in `region`, switching the region's surface on when it is not
     * mounted yet: the row or the dock column opens, and its surface takes the
     * pending panel as soon as it reports ready.
     */
    const openInRegion = (region: WorkbenchRegionId, panelId: string, reveal = true): void => {
      const placement = panelPlacement(panelId)
      if (placement === undefined || !canMovePanelToRegion(panelId, region)) return
      const api = regions.get(region)
      if (api === undefined) {
        const queued = pendingOpen.get(region) ?? new Set<string>()
        queued.add(panelId)
        pendingOpen.set(region, queued)
        if (reveal && region === 'bottom') switchBottomPanel?.(true)
        else if (reveal && region === 'right') switchRightPanel('dock')
        return
      }
      adoptPanel({ region, api, panelId })
    }

    ctx.effect(
      () =>
        WorkbenchTabDocking.register(tabId => {
          if (ctx.get('mainSurface')?.mode() !== 'workbench') return undefined
          const snapshot = workbenchTabs().getSnapshot()
          if (!snapshot.enabled || !snapshot.tabs.some(tab => tab.id === tabId && tab.kind !== 'start')) return false
          const definition = registry.list().find(panel => panel.tabId === tabId)
          if (definition === undefined) return false
          // Region adoption moves only presentation; the semantic actor keeps the same
          // tab, pin, preview, unread state and Session identity. A not-yet-mounted right
          // dock queues admission while the source stays live until the dock is ready.
          dockActions.open()
          openInRegion('right', definition.id)
          return true
        }),
      'workbench: semantic tab move-aside admission',
    )

    const newSemanticPanelOpener = () =>
      createSemanticPanelOpener({
        tabs: workbenchTabs,
        registered: (id: string) => registry.get(id) !== undefined,
        savedRegionOf,
        openInRegion,
      })
    let semanticPanelOpener = newSemanticPanelOpener()

    let revealLeftPanel: (() => void) | undefined
    const movePanelTo = (from: WorkbenchRegionId, api: DockviewApi, to: WorkbenchRegionId, panelId: string): void => {
      if (to === 'left') revealLeftPanel?.()
      if (to === 'right') dockActions.open()
      if (to === 'main' && ctx.get('mainSurface')?.mode() !== 'workbench') {
        moveToMainView(api, panelId)
        return
      }
      // Destination admission transfers source params and only then removes the old presentation.
      openInRegion(to, panelId)
    }

    /** Where an "Add panel" goes: the definition moves here if another region shows it. */
    const openIn =
      (region: WorkbenchRegionId) =>
      (definition: WorkbenchPanelDefinition, api: DockviewApi, target?: { readonly group?: DockviewGroupPanel; readonly replacePanelId?: string }): void => {
        if (terminalSource.open(definition, api, target)) return
        if (
          target === undefined &&
          definition.mainPanelId !== undefined &&
          ctx.get('mainSurface')?.mode() === 'workbench' &&
          workbenchTabs().getSnapshot().enabled
        ) {
          semanticPanelOpener.request(region, definition.mainPanelId, definition.title)
          return
        }
        if (!canMovePanelToRegion(definition.id, region)) return
        closeElsewhere(region, definition.id)
        WorkbenchLayout.openPanel(api, definition)
      }

    const NestedSurface = (props: NestedSurfaceProps): JSX.Element => (
      <WorkbenchView
        {...props}
        registry={registry}
        onResetLayout={resetLayout}
        t={translate}
        defaultLayout="empty"
        onOpenPanel={openIn(props.region)}
        onDropPanel={handleDrop(props.region)}
        acceptPanel={id => canMovePanelToRegion(id, props.region)}
        acceptDroppedPanel={event => {
          const id = event.getData()?.panelId
          if (id && canMovePanelToRegion(id, props.region)) acceptsForeignPanel(event)
        }}
        onApi={api => drainPendingOpen(props.region, api)}
        onAddSurface={() => addNestedSurface(props.region)}
      />
    )
    const nestedSurfaces = createNestedSurfaceRegistry(registry, NestedSurface)
    const addNestedSurface = (parent: WorkbenchRegionId): void => {
      const definition = nestedSurfaces.add(parent, 'Nested surface')
      openInRegion(parent, definition.id)
    }
    ctx.effect(() => {
      nestedSurfaces.restore()
      return () => nestedSurfaces.dispose()
    }, 'workbench: nested surface identities')
    ctx.effect(() => {
      const resources = sidebarResourcePanels()
      const registrations = new Map<string, { dispose: () => void; revision: number }>()
      const sync = (): void => {
        const entries = resources.list()
        for (const [id, registration] of registrations) {
          if (ctx.get('mainSurface')?.mode() !== 'workbench' || entries.some(entry => entry.id === id)) continue
          for (const [, api] of regions.entries()) api.getPanel(id)?.api.close()
          registration.dispose()
          registrations.delete(id)
        }
        for (const resource of entries) {
          const previous = registrations.get(resource.id)
          if (previous?.revision === resource.navigationRevision) continue
          const dispose = registry.register({
            id: resource.id,
            title: resource.title,
            component: ResourcePanelHost,
            hiddenFromAdd: true,
            beforeClose: () => resources.close(resource.id),
          })
          previous?.dispose()
          registrations.set(resource.id, { dispose, revision: resource.navigationRevision })
          if (terminalSource.admit(resource.id)) continue
          if (ctx.get('mainSurface')?.mode() === 'workbench') {
            const owner = regions.entries().find(([, api]) => api.getPanel(resource.id) !== undefined)
            // Startup projection is passive; only the declarer's explicit
            // place/focus action reveals a closed pane after admission.
            openInRegion(owner?.[0] ?? savedRegionOf(resource.id) ?? 'right', resource.id, false)
          }
        }
      }
      const off = resources.subscribe(sync)
      const offMode = ctx.get('mainSurface')?.subscribe(sync)
      sync()
      return () => {
        off()
        offMode?.()
        for (const entry of registrations.values()) entry.dispose()
      }
    }, 'workbench: authorized resource panels')

    ctx.effect(
      () =>
        registry.subscribe(() => {
          if (!registry.hasOpenRequests()) return
          const target: WorkbenchRegionId =
            ctx.get('mainSurface')?.mode() === 'workbench' ? 'main' : ctx.get('rightPanel')?.mode() === 'dock' ? 'right' : 'main'
          for (const id of registry.takeOpenRequests()) {
            const definition = registry.get(id)
            if (definition === undefined) continue
            const api = regions.get(target)
            if (api !== undefined) openIn(target)(definition, api)
            else openInRegion(target, id)
          }
        }),
      'workbench: single open-request router',
    )

    /** The same browser-owned controller serves every toggle, including native shortcut adapters. */
    const ToggleRightPanel = (): JSX.Element | null => {
      const shown = rightPaneVisibility.useValue() === true
      return shown ? null : (
        <DropdownMenuItem onSelect={dockActions.open}>
          <PanelRightOpenIcon aria-hidden />
          Open right pane
        </DropdownMenuItem>
      )
    }

    /** Show or hide the bottom panel from a surface's own header. */
    const ToggleBottomPanel = decorate(() => {
      const settings = useSettings(workbenchSettings)
      const shown = settings.value?.bottomPanel === 'shown'
      const label = shown ? translate('hideBottomPanel') : translate('toggleBottomPanel')
      return (
        <DropdownMenuItem onSelect={() => switchBottomPanel?.(!shown)}>
          <PanelBottomIcon aria-hidden />
          {label}
        </DropdownMenuItem>
      )
    })

    const destinationLabel = (region: WorkbenchRegionId): string =>
      region === 'main'
        ? translate('moveToMainView')
        : region === 'bottom'
          ? translate('moveToBottomPanel')
          : region === 'left'
            ? translate('moveToLeft')
            : translate('moveToDock')

    /**
     * Move a panel to another region, or to its own full main-view page. The
     * header actions hand the menu the live api and the ids the surface shows:
     * this component mounts with the header, before Dockview reports ready, so a
     * captured instance would still be null on first render.
     */
    const MoveMenu = decorate((props: { readonly api: DockviewApi | null; readonly openIds: readonly string[]; readonly from: WorkbenchRegionId }) => {
      const api = props.api
      const active = api?.activePanel
      const movable =
        active === undefined ? [] : [{ definition: { title: active.title, mainPanelId: registry.get(active.id)?.mainPanelId }, panelId: active.id }]
      if (api === null || movable.length === 0) return null
      const destinations = (['left', 'right', 'bottom', 'main'] as const).filter(destination => destination !== props.from)
      // One flat list: a submenu per panel costs a hover for a choice that is
      // almost always one panel and one destination. The panel's title only
      // appears when more than one panel could move.
      const entries = destinations.flatMap(destination =>
        movable.flatMap(({ definition, panelId }) => {
          const target = definition.mainPanelId
          if (destination === 'main' && ctx.get('mainSurface')?.mode() !== 'workbench' && (target === undefined || !isMainPanelId(target))) return []
          const label = movable.length === 1 ? destinationLabel(destination) : `${definition.title}: ${destinationLabel(destination)}`
          return [{ key: `${destination}:${panelId}`, label, run: () => movePanelTo(props.from, api, destination, panelId) }]
        }),
      )
      if (entries.length === 0) return null
      return (
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <MoveIcon aria-hidden />
            Move tab to
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {entries.map(entry => (
              <DropdownMenuItem key={entry.key} onSelect={entry.run}>
                {entry.label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      )
    })

    // Named layouts: one arrangement per region, captured from the live
    // surfaces and written back through the same stores, so a region that is
    // not mounted yet still receives the layout when it opens.
    const layoutStores = { main: store, dock: dockStore, bottom: bottomStore, left: leftStore }
    const resetLayout = (): void => {
      if (resettingLayout) return
      resettingLayout = true
      sidebarPreviewMigration.reset()
      try {
        WorkbenchReset.run({
          rootStores: layoutStores,
          sideStore,
          nestedStores: nestedLayoutStores,
          regions,
          sideSurfaces: nativeAside.surfaces,
          clearScopeLayouts: () => semanticLayouts.remove(),
          discardPendingPlacements: () => {
            terminalSource.clear()
            pendingOpen.clear()
            registry.takeOpenRequests()
            nativeAside.reset()
            semanticPanelOpener = newSemanticPanelOpener()
          },
          restoreMain: () => {
            resettingLayout = false
            const main = regions.get('main')
            if (ctx.get('mainSurface')?.mode() === 'workbench') {
              const channel = workbenchTabs()
              const snapshot = channel.getSnapshot()
              const currentId = snapshot.currentSessionId
              if (
                snapshot.enabled &&
                currentId !== undefined &&
                ctx.sessions.list.getSnapshot().ids.some(id => id === currentId) &&
                !snapshot.tabs.some(tab => tab.target.kind === 'thread' && tab.target.sessionId === currentId)
              )
                channel.actions.open({ kind: 'thread', sessionId: currentId }, true)
              syncMainTabs?.()
              if (main !== undefined) {
                const tabId = WorkbenchReset.conversation(main, registry, channel.getSnapshot())
                if (tabId !== undefined) channel.actions.activate(tabId)
              } else openInRegion('main', 'conversation')
            } else if (main !== undefined) WorkbenchLayout.applyDefaultLayout(main, registry.list(), 'editor')
            // Persist before the next Dockview layout event or a remount.
            if (main !== undefined) store.set(main.toJSON())
          },
          restoreLeft: () => {
            const left = regions.get('left')
            if (left !== undefined) {
              WorkbenchLayout.applyDefaultLayout(left, registry.list(), 'threads')
              seatSidebarPreview(left)
              leftStore.set(left.toJSON())
            }
            // The frame can reveal a not-yet-mounted left view idempotently.
            // Older client bundles retain the declaring sidebar's guarded toggle.
            const sidebar = ctx.get('frameSidebar')
            if (sidebar !== undefined) sidebar.show()
            else revealLeftPanel?.()
          },
        })
      } finally {
        resettingLayout = false
      }
    }
    const captureLayout = (): SavedLayout =>
      captureLayoutArrangement({
        rootStores: layoutStores,
        nestedStores: nestedLayoutStores,
        regions,
        presentation: { bottomShown: (ctx.get('frameBottom')?.height() ?? 0) > 0, rightMode: ctx.get('rightPanel')?.mode() ?? 'native' },
      })
    const applyLayout = (layout: SavedLayout): void => {
      restoreLayoutArrangement(layout, {
        rootStores: layoutStores,
        nestedStores: nestedLayoutStores,
        regions,
        setBottomShown: shown => switchBottomPanel?.(shown),
        setRightMode: mode => switchRightPanel?.(mode),
      })
      // Named and scope-restored layouts can still carry retired global aliases.
      // Reconcile through the same canonical tab owner used at startup.
      syncMainTabs?.()
    }

    const LayoutRow = decorate((props: { readonly name: string; readonly onApplied: () => void }) => {
      const [editing, setEditing] = useState(false)
      const [draft, setDraft] = useState(props.name)
      const layouts = savedLayouts.useValue()
      const confirmRename = (): void => {
        const next = draft.trim()
        if (next.length === 0) return
        savedLayouts.set(SavedLayouts.renamed(layouts, props.name, next))
        setEditing(false)
      }
      return (
        <div className="dshx:flex dshx:items-center dshx:justify-between dshx:gap-2 dshx:py-1">
          {editing ? (
            <>
              <Input aria-label={translate('renameLayout')} value={draft} onChange={event => setDraft(event.target.value)} />
              <div className="dshx:flex dshx:items-center dshx:gap-1">
                <Button size="sm" variant="ghost" onClick={confirmRename}>
                  {translate('renameLayout')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  {translate('cancel')}
                </Button>
              </div>
            </>
          ) : (
            <>
              <span className="dshx:truncate dshx:text-sm">{props.name}</span>
              <div className="dshx:flex dshx:items-center dshx:gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`${translate('applyLayout')} ${props.name}`}
                  onClick={() => {
                    const layout = savedLayouts.get()[props.name]
                    if (layout === undefined) return
                    applyLayout(layout)
                    props.onApplied()
                  }}
                >
                  {translate('applyLayout')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`${translate('renameLayout')} ${props.name}`}
                  onClick={() => {
                    setDraft(props.name)
                    setEditing(true)
                  }}
                >
                  {translate('renameLayout')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`${translate('deleteLayout')} ${props.name}`}
                  onClick={() => savedLayouts.set(SavedLayouts.without(savedLayouts.get(), props.name))}
                >
                  {translate('deleteLayout')}
                </Button>
              </div>
            </>
          )}
        </div>
      )
    })

    let showLayouts: (() => void) | undefined
    const LayoutsMenu = (): JSX.Element => (
      <DropdownMenuItem onSelect={() => showLayouts?.()}>
        <LayoutTemplateIcon aria-hidden />
        {translate('layouts')}
      </DropdownMenuItem>
    )
    // The dialog outlives dropdown content. Opening it must not unmount its state
    // when the menu dismisses in response to the modal's focus transfer.
    const LayoutsDialog = decorate(() => {
      const [open, setOpen] = useState(false)
      useEffect(() => {
        showLayouts = () => setOpen(true)
        return () => {
          showLayouts = undefined
        }
      }, [])
      const [draft, setDraft] = useState('')
      const layouts = savedLayouts.useValue()
      const save = (): void => {
        const name = draft.trim()
        if (name.length === 0) return
        savedLayouts.set(SavedLayouts.with(layouts, name, captureLayout()))
        setDraft('')
      }
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{translate('layoutsTitle')}</DialogTitle>
              <DialogDescription>{translate('layoutsHint')}</DialogDescription>
            </DialogHeader>
            <div className="dshx:flex dshx:flex-col dshx:gap-1">
              {SavedLayouts.names(layouts).map(name => (
                <LayoutRow key={name} name={name} onApplied={() => setOpen(false)} />
              ))}
              {SavedLayouts.names(layouts).length === 0 && <p className="dshx:text-sm dshx:text-muted-foreground">{translate('layoutEmpty')}</p>}
            </div>
            <DialogFooter>
              <Input
                aria-label={translate('layoutName')}
                placeholder={translate('layoutName')}
                value={draft}
                onChange={event => setDraft(event.target.value)}
              />
              <Button size="sm" disabled={draft.trim().length === 0} onClick={save}>
                {translate('saveLayout')}
              </Button>
              <DialogClose asChild>
                <Button size="sm" variant="ghost">
                  {translate('done')}
                </Button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )
    })

    ctx.slots.inject('sidebar.right.pane.tab', () =>
      ctx.slots.register(
        { name: 'sidebar.right.pane.tab', key: RIGHT_PANE_ID, locale: WORKBENCH_LOCALE_NAMESPACE },
        decorate(props => {
          useDockviewSheet()
          useDemoPanels()
          const [api, setApi] = useState<DockviewApi | null>(null)
          useLayoutEffect(() => {
            if (api !== null) return nativeAside.attach(props.sessionId, api)
          }, [api, props.sessionId])
          return (
            <WorkbenchView
              registry={registry}
              onResetLayout={resetLayout}
              store={sideStore}
              t={props.t}
              onApi={setApi}
              headerActions={context => <MoveMenu from="right" {...context} />}
            />
          )
        }),
      ),
    )

    // Keep the left Dockview mounted while its frame seat is collapsed. Its
    // navigation/thread panels can be moved like any other presentation panel.
    ctx.slots.inject('shell.left', () =>
      ctx.slots.register(
        { name: 'shell.left', locale: WORKBENCH_LOCALE_NAMESPACE },
        decorate(props => {
          useDockviewSheet()
          useDemoPanels()
          useLayoutEffect(() => {
            revealLeftPanel = () => {
              const sidebar = ctx.get('frameSidebar')
              if (sidebar !== undefined) sidebar.show()
              else if (props.collapsed) ctx.layout.toggleSidebar()
            }
            return () => {
              revealLeftPanel = undefined
            }
          }, [props.collapsed])
          const panels = useSyncExternalStore(registry.subscribe, registry.list, registry.list)
          // Sidebar registration is effect-owned; do not persist an empty first
          // layout before its two independent renderers have registered.
          if (
            !panels.some(panel => panel.id === 'dshfiles-thread-sidebar.workbench-threads') ||
            !panels.some(panel => panel.id === 'dshfiles-thread-sidebar.workbench-navigation') ||
            !panels.some(panel => panel.id === SidebarPreviewMigration.panelId)
          )
            return null
          return (
            <div style={props.collapsed ? { display: 'none' } : { display: 'flex', flex: 1, minHeight: 0, minWidth: 0 }}>
              <WorkbenchView
                registry={registry}
                onResetLayout={resetLayout}
                store={leftStore}
                region="left"
                surface="left"
                visible={!props.collapsed}
                defaultLayout="threads"
                t={props.t}
                heading="Sidebar"
                onOpenPanel={openIn('left')}
                onDropPanel={handleDrop('left')}
                acceptDroppedPanel={acceptsForeignPanel}
                onApi={api => {
                  drainPendingOpen('left', api)
                  seatSidebarPreview(api)
                }}
                onAddSurface={() => addNestedSurface('left')}
                headerActions={context => <MoveMenu from="left" {...context} />}
              />
            </div>
          )
        }),
      ),
    )

    // The global dock: one surface in the frame's right column whose panel set
    // and layout belong to the browser, not to a thread, so it survives every
    // thread switch. The frame renders it only while `rightPanel` asks for it.
    ctx.slots.inject('shell.dock', () =>
      ctx.slots.register(
        { name: 'shell.dock', locale: WORKBENCH_LOCALE_NAMESPACE },
        decorate(props => {
          useDockviewSheet()
          useDemoPanels()
          // The column reserves a track only while its occupant reports itself
          // shown, exactly as the native right sidebar does.
          const shown = props.shown !== false
          useLayoutEffect(() => {
            if (shown) ctx.layout.openRightbar(true, false)
            else ctx.layout.closeRightbar()
            return () => ctx.layout.closeRightbar()
          }, [shown])
          return (
            <WorkbenchView
              registry={registry}
              onResetLayout={resetLayout}
              store={dockStore}
              region="right"
              surface="dock"
              defaultLayout="empty"
              visible={shown}
              onClose={dockActions.close}
              t={props.t}
              heading={props.t('dockHeading')}
              onOpenPanel={openIn('right')}
              onDropPanel={handleDrop('right')}
              acceptDroppedPanel={acceptsForeignPanel}
              onApi={api => drainPendingOpen('right', api)}
              headerActions={context => (
                <>
                  <ToggleBottomPanel />
                  <LayoutsMenu />
                  <MoveMenu from="right" {...context} />
                </>
              )}
            />
          )
        }),
      ),
    )

    // The bottom panel: the same panels in the frame's full-width row, opened
    // and closed through the frame's seat so its height belongs to the frame.
    ctx.slots.inject('shell.bottom', () =>
      ctx.slots.register(
        { name: 'shell.bottom', locale: WORKBENCH_LOCALE_NAMESPACE },
        decorate(props => {
          useDockviewSheet()
          useDemoPanels()
          const bottomSettings = useSettings(workbenchSettings)
          // The surface exists only while the setting asks for it and the owned
          // frame carries the row: the stock frame renders this seat
          // unconditionally, and a surface there would duplicate the panels the
          // main workbench already shows.
          if (bottomSettings.value?.bottomPanel !== 'shown' || ctx.get('frameBottom') === undefined) return null
          return (
            <WorkbenchView
              registry={registry}
              onResetLayout={resetLayout}
              store={bottomStore}
              region="bottom"
              surface="bottom"
              t={props.t}
              heading={props.t('bottomHeading')}
              onOpenPanel={openIn('bottom')}
              onDropPanel={handleDrop('bottom')}
              acceptDroppedPanel={acceptsForeignPanel}
              onApi={api => drainPendingOpen('bottom', api)}
              onClose={() => switchBottomPanel?.(false)}
              headerActions={context => (
                <>
                  <LayoutsMenu />
                  <MoveMenu from="bottom" {...context} />
                </>
              )}
            />
          )
        }),
      ),
    )

    // The frame renders one owned dock; native is only the private closed-state
    // compatibility token. It never selects alternate right-pane chrome.
    const switchRightPanel = (mode: RightPanelMode): void => {
      if (mode === 'dock') dockActions.open()
      else dockActions.close()
    }
    const RightPanelModeReporter = decorate(() => {
      const settings = useSettings(workbenchSettings)
      const shown = rightPaneVisibility.useValue() === true
      useLayoutEffect(() => {
        if (settings.value !== undefined || settings.status !== 'loading') migrateDockVisibility(settings.value?.rightPanel === 'dock' ? 'dock' : 'native')
      }, [settings.value, settings.status])
      useLayoutEffect(() => {
        ctx.get('rightPanel')?.setMode(shown ? 'dock' : 'native')
      }, [shown])
      useEffect(() => () => ctx.get('rightPanel')?.setMode('native'), [])
      return null
    })
    // The row's presence lives outside the seat: the frame renders `shell.bottom`
    // only while the row is open, so the component that opens it must be mounted
    // regardless. `set` is what the header action and the command call.
    let switchBottomPanel: ((shown: boolean) => void) | undefined
    const BottomPanelPresence = decorate(() => {
      const settings = useSettings(workbenchSettings)
      const shown = settings.value?.bottomPanel === 'shown'
      useEffect(() => {
        switchBottomPanel = next => void settings.set('bottomPanel', next ? 'shown' : 'hidden')
        return () => {
          switchBottomPanel = undefined
        }
      }, [settings])
      useEffect(() => {
        const seat = ctx.get('frameBottom')
        if (shown) seat?.open()
        else seat?.close()
      }, [shown])
      useEffect(
        () => () => {
          ctx.get('frameBottom')?.close()
        },
        [],
      )
      return null
    })
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register({ name: 'shell.overlay', id: 'dshfiles-workbench-right-panel', order: 44 }, RightPanelModeReporter),
    )
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register({ name: 'shell.overlay', id: 'dshfiles-workbench-bottom-panel', order: 45 }, BottomPanelPresence),
    )
    ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'dshfiles-workbench-layout-dialog', order: 46 }, LayoutsDialog))

    const toggleRightPanel = dockActions.toggle

    const BOTTOM_COMMAND_ID = 'workbench.toggleBottomPanel'
    const RESET_COMMAND_ID = 'workbench.resetLayout'
    const SHOW_TAB_ROWS_COMMAND_ID = 'workbench.showTabRows'
    const isShortcutCommandId = (value: string): value is ShortcutCommandId => /^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/u.test(value)
    if (isShortcutCommandId(SHOW_TAB_ROWS_COMMAND_ID)) {
      ctx.effect(
        () =>
          ctx.shortcuts.register({
            id: SHOW_TAB_ROWS_COMMAND_ID,
            label: () => 'Workbench: Show tab rows',
            aliases: ['show', 'hidden tabs', 'tab row', 'tab bar', 'restore tabs'],
            defaults: {},
            regions: ['page', 'editable'],
            modals: [],
            resolve: () => ({
              status: 'handled',
              run: () => {
                for (const [, api] of regions.entries()) TabRows.showAll(api)
              },
            }),
          }),
        'workbench: reveal hidden tab rows',
      )
    }
    if (isShortcutCommandId(RESET_COMMAND_ID)) {
      ctx.effect(
        () =>
          ctx.shortcuts.register({
            id: RESET_COMMAND_ID,
            label: () => `${translate('title')}: ${translate('resetLayout')}`,
            aliases: ['workbench', 'reset', 'layout', 'recover', 'conversation', 'composer', 'tabs'],
            // The palette/shortcut command lives outside every Dockview surface, so
            // it remains available when no main panel or header survived the layout.
            defaults: {},
            regions: ['page', 'editable'],
            modals: [],
            resolve: () => ({ status: 'handled', run: resetLayout }),
          }),
        'workbench: global layout recovery command',
      )
    }
    if (isShortcutCommandId(BOTTOM_COMMAND_ID)) {
      ctx.effect(() => {
        try {
          return ctx.shortcuts.register({
            id: BOTTOM_COMMAND_ID,
            label: () => translate('toggleBottomPanel'),
            aliases: ['workbench', 'dock', 'panel', 'bottom panel'],
            defaults: {},
            regions: ['page', 'editable'],
            modals: [],
            resolve: () => ({ status: 'handled', run: () => switchBottomPanel?.(ctx.get('frameBottom')?.height() === 0) }),
          })
        } catch (error) {
          console.warn('workbench: the bottom panel toggle command could not be registered', error)
          return () => undefined
        }
      }, 'workbench: bottom panel toggle command')
    }
    if (isShortcutCommandId(TOGGLE_COMMAND_ID)) {
      // No default chord: listed under Settings › Shortcuts and in the command palette for the user to bind.
      ctx.effect(() => {
        try {
          return ctx.shortcuts.register({
            id: TOGGLE_COMMAND_ID,
            label: () => translate('toggleRightPanel'),
            aliases: ['workbench', 'dock', 'panels', 'side panel', 'global dock'],
            defaults: {},
            regions: ['page', 'editable'],
            modals: [],
            resolve: () => ({ status: 'handled', run: toggleRightPanel }),
          })
        } catch (error) {
          console.warn('workbench: the right panel toggle command could not be registered', error)
          return () => undefined
        }
      }, 'workbench: right panel toggle command')
    }
  },
})
