import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { ShortcutCommandId } from '@deepseek-ai/dsh-client-shortcuts/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { defineClient, useSettings } from '@dshfiles/dshx/client'
import type { RightPanelMode } from '@dshfiles/frame-layout/right-panel'
// Type-only: the frame's right-column seat and the `shell.dock` slot it declares.
import type {} from '@dshfiles/frame-layout/right-panel'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { LayoutGridIcon } from '@dshfiles/plugin-ui/icons'
import type { DockviewApi } from 'dockview-react'
import dockviewSheet from 'virtual:dshfiles-workbench/dockview-css'
import { useEffect, useLayoutEffect, useSyncExternalStore } from 'react'
import { demoPanels } from './demo-panels.js'
import { createLayoutStore, WorkbenchLayout } from './layout-store.js'
import { WORKBENCH_LOCALE_NAMESPACE, workbenchLocale } from './locales.js'
import { workbenchPanels, type WORKBENCH_MAIN_PANEL_ID } from './registry.js'
import { effectiveRightPanelMode } from './right-panel-mode.js'
import { workbenchSettings } from './settings.js'
import { WorkbenchView } from './workbench-view.js'

// A literal so dshx's slot-occupancy check can read the id; `satisfies` keeps it equal to the exported contract.
const PANEL_ID = 'dshfiles-workbench' satisfies typeof WORKBENCH_MAIN_PANEL_ID
const RIGHT_PANE_ID = '@dshfiles/workbench/side-panel'
const RIGHT_PANE_KIND = 'dshfiles-workbench-side-panel'
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
  inject: ['slots', 'layout', 'sidebarRightTabs', 'sidebarRight', 'shortcuts'],
  setup(ctx, decorate) {
    const translate = ctx.locale.bind(WORKBENCH_LOCALE_NAMESPACE)
    const registry = workbenchPanels()
    const store = createLayoutStore()
    const sideStore = createLayoutStore({ surface: 'side-panel' })
    const dockStore = createLayoutStore({ surface: 'dock' })

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
          if (registry.hasOpenRequests() && isMainPanelId(PANEL_ID) && ctx.get('rightPanel')?.mode() !== 'dock') ctx.layout.selectPanel(PANEL_ID)
        }),
      'workbench: open requests',
    )

    ctx.slots.inject('sidebar.panellist', () =>
      ctx.slots.register(
        { name: 'sidebar.panellist', id: PANEL_ID, order: 3, label: () => translate('title'), locale: WORKBENCH_LOCALE_NAMESPACE },
        (props: { readonly size?: number | undefined }) => <LayoutGridIcon aria-hidden size={props.size ?? 18} />,
      ),
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
              store={store}
              t={props.t}
              headerActions={context => <MainMoveToDock {...context} />}
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
    // The two docking surfaces keep their own Dockview instances, so moving a
    // panel between them is this plugin's business: close it in the source, then
    // select the feature's own main panel (or open the panel in the dock) and the
    // other surface shows it.
    let dockApi: DockviewApi | null = null
    let pendingDockOpen: string | null = null

    const moveToMainView = (api: DockviewApi, panelId: string): void => {
      const target = registry.get(panelId)?.mainPanelId
      if (target === undefined || !isMainPanelId(target)) return
      api.getPanel(panelId)?.api.close()
      ctx.layout.selectPanel(target)
    }

    const openInDock = (panelId: string): void => {
      const definition = registry.get(panelId)
      if (definition === undefined) return
      if (dockApi === null) {
        pendingDockOpen = panelId
        switchRightPanel?.('dock')
        return
      }
      WorkbenchLayout.openPanel(dockApi, definition)
    }

    const moveToDock = (api: DockviewApi, panelId: string): void => {
      api.getPanel(panelId)?.api.close()
      openInDock(panelId)
    }

    /**
     * The dock's move menu. The header actions hand it the live api and the ids
     * the surface shows: this component mounts with the header, before Dockview
     * reports ready, so a captured instance would still be null on first render.
     */
    const DockMoveToMain = decorate((props: { readonly api: DockviewApi | null; readonly openIds: readonly string[] }) => {
      const api = props.api
      const movable = props.openIds.filter(id => {
        const target = registry.get(id)?.mainPanelId
        return target !== undefined && isMainPanelId(target)
      })
      if (api === null || movable.length === 0) return null
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost">
              {translate('moveToMainView')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {movable.map(id => (
              <DropdownMenuItem key={id} onSelect={() => moveToMainView(api, id)}>
                {registry.get(id)?.title ?? id}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    })

    /** The main workbench's move menu: everything it shows can go back to the dock. */
    const MainMoveToDock = decorate((props: { readonly api: DockviewApi | null; readonly openIds: readonly string[] }) => {
      const api = props.api
      if (api === null || props.openIds.length === 0) return null
      return (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost">
              {translate('moveToDock')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {props.openIds.map(id => (
              <DropdownMenuItem key={id} onSelect={() => moveToDock(api, id)}>
                {registry.get(id)?.title ?? id}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )
    })

    ctx.slots.inject('sidebar.right.pane.tab', () =>
      ctx.slots.register(
        { name: 'sidebar.right.pane.tab', key: RIGHT_PANE_ID, locale: WORKBENCH_LOCALE_NAMESPACE },
        decorate(props => {
          useDockviewSheet()
          useDemoPanels()
          return <WorkbenchView registry={registry} store={sideStore} t={props.t} />
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
          useLayoutEffect(() => {
            ctx.layout.openRightbar(true, false)
            return () => ctx.layout.closeRightbar()
          }, [])
          return (
            <WorkbenchView
              registry={registry}
              store={dockStore}
              surface="dock"
              t={props.t}
              heading={props.t('dockHeading')}
              onApi={api => {
                dockApi = api
                if (pendingDockOpen === null) return
                const definition = registry.get(pendingDockOpen)
                pendingDockOpen = null
                if (definition !== undefined) WorkbenchLayout.openPanel(api, definition)
              }}
              headerActions={context => <DockMoveToMain {...context} />}
            />
          )
        }),
      ),
    )

    // Reports which surface fills the right column. The setting decides; the
    // native surface takes the column back while the on-screen Session has a tab
    // open, because only it can render the resources other plugins send there.
    // A component owns the report because settings are readable from components,
    // and `ctx.get` keeps the workbench loadable on a frame with no such seat
    // (the stock layout), where the report lands nowhere.
    let switchRightPanel: ((mode: RightPanelMode) => void) | undefined
    const RightPanelModeReporter = decorate(() => {
      const settings = useSettings(workbenchSettings)
      const setting = settings.value?.rightPanel ?? 'native'
      const mounted = useSyncExternalStore(ctx.sidebarRight.mounted.subscribe, ctx.sidebarRight.mounted.getSnapshot, ctx.sidebarRight.mounted.getSnapshot)
      const openTabs = useSyncExternalStore(ctx.sidebarRight.openTabs.subscribe, ctx.sidebarRight.openTabs.getSnapshot, ctx.sidebarRight.openTabs.getSnapshot)
      const mode = effectiveRightPanelMode({
        setting,
        nativeTabsOnScreen: mounted !== undefined && openTabs.some(tab => tab.sessionId === mounted),
      })
      useEffect(() => {
        switchRightPanel = next => void settings.set('rightPanel', next)
        return () => {
          switchRightPanel = undefined
        }
      }, [settings])
      useEffect(() => {
        ctx.get('rightPanel')?.setMode(mode)
      }, [mode])
      useEffect(
        () => () => {
          ctx.get('rightPanel')?.setMode('native')
        },
        [],
      )
      return null
    })
    ctx.slots.inject('shell.overlay', () =>
      ctx.slots.register({ name: 'shell.overlay', id: 'dshfiles-workbench-right-panel', order: 44 }, RightPanelModeReporter),
    )

    // Same shape as the Jujutsu toggle: close the side panel when it already shows the workbench, otherwise show it.
    const toggleSidePanel = (): void => {
      const sidebar = ctx.sidebarRight
      if (sidebar.isExpanded() && sidebar.active()?.kind === RIGHT_PANE_KIND) {
        sidebar.toggleExpanded()
        return
      }
      sidebar.openTab(RIGHT_PANE_KIND, { revealIfOpened: true })
    }

    // The column's global surface when the setting asks for it; otherwise the
    // per-thread tab type above, which is what the header button and the command
    // fall back to on a frame that offers no seat.
    const toggleRightPanel = (): void => {
      if (switchRightPanel === undefined) {
        toggleSidePanel()
        return
      }
      switchRightPanel(ctx.get('rightPanel')?.mode() === 'dock' ? 'native' : 'dock')
    }

    const HeaderToggle = decorate(() => {
      const settings = useSettings(workbenchSettings)
      // Absent until a DSH restart registers the namespace; the toggle stays on by default.
      if (settings.value?.headerToggle === false) return null
      const label = translate('toggleRightPanel')
      return (
        <Button
          aria-label={label}
          className="dshx-root dshx:text-muted-foreground"
          onClick={toggleRightPanel}
          size="icon-sm"
          title={label}
          type="button"
          variant="ghost"
        >
          <LayoutGridIcon aria-hidden size={16} />
        </Button>
      )
    })
    ctx.slots.inject('conversation.session.header.utilities', () =>
      ctx.slots.register({ name: 'conversation.session.header.utilities', id: 'dshfiles-workbench-toggle', order: 41 }, HeaderToggle),
    )

    const isShortcutCommandId = (value: string): value is ShortcutCommandId => /^[a-z][a-zA-Z0-9-]*(?:\.[a-zA-Z][a-zA-Z0-9-]*)+$/u.test(value)
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
