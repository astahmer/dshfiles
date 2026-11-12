import type { SidebarPanelMetadata, SidebarRootInjected } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { HostObservable, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchPanelDefinition, WorkbenchPanelProps, WorkbenchPanelRegistry } from '@dshfiles/workbench/registry'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { TooltipProvider } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { useLayoutEffect, useRef, useSyncExternalStore, type ComponentProps, type ReactNode } from 'react'
import { NavigationIconRow } from './navigation-icon-row.js'
import { SidebarSettingsButton } from './sidebar-customization.js'
import { SidebarStateProvider, useSidebarState } from './sidebar-state.js'
import { SidebarOrganization } from './organization.js'
import { SidebarDockHost } from './sidebar-dock-host.js'
import { SIDEBAR_PANE_ID } from '@dshfiles/workbench/shell-merge'
import type { sidebarChildren } from './sidebar-contract.js'

type SidebarRenderSlot = PropsRenderSlots<keyof typeof sidebarChildren>['renderSlot']
type FooterSlot = 'sidebar.footer.above' | 'sidebar.footer.action'

/** A legacy "Plugin: View" label shows as its view name: pane titles never carry plugin names (DESIGN.md). */
const withoutPluginPrefix = (label: string): string => {
  const separator = label.indexOf(': ')
  return separator > 0 && label.slice(separator + 2).trim() !== '' ? label.slice(separator + 2).trim() : label.trim()
}

/**
 * A footer aggregate takes its sole contributor's own label; several contributors, or an unlabeled one, read as the
 * generic seat name rather than a guessed owner.
 */
const footerTitle = (slot: FooterSlot, labels: readonly string[]): string => {
  const fallback = slot === 'sidebar.footer.above' ? 'Sidebar previews' : 'Sidebar controls'
  const only = labels.length === 1 ? withoutPluginPrefix(labels[0] ?? '') : ''
  return only === '' || only.endsWith(':') ? fallback : only
}

/** Supplied only by the sidebar root declaring these seats; never a second slot registration. */
interface SidebarWorkbenchSources {
  readonly renderSlot: SidebarRenderSlot
  /** Preserve an empty label for an unlabeled entry, so mixed aggregates never claim its display prefix. */
  readonly footerTitles: (slot: FooterSlot) => readonly string[]
  readonly subscribeFooterTitles: (listener: () => void) => () => void
  readonly panels: HostObservable<readonly SidebarPanelMetadata[]>
  readonly panelInfo: HostObservable<PanelInfo>
  readonly selectPanel: SidebarRootInjected['selectPanel']
  readonly expandSidebar: () => void
  readonly startSession: () => void
  readonly searchThreads: () => void
  readonly newThreadLabel: string
  readonly searchThreadsLabel: string
  readonly sidebarSettingsLabel: string
  readonly navigationLabels: ComponentProps<typeof NavigationIconRow>['labels']
  /** Whether the Host renders a settings root; the Navigation ⋮ menu offers Settings only then. */
  readonly hasSettings: HostObservable<boolean>
  readonly settingsLabel: string
  readonly openSettings: () => void
  readonly customizeSidebar: () => void
  /** A visible Threads occurrence lends its own content seat, not a native or another plugin's DOM. */
  readonly registerCustomizationHost: (host: HTMLElement) => () => void
  readonly decorate: (component: WorkbenchPanelDefinition['component']) => WorkbenchPanelDefinition['component']
}

/** One adapter lifetime follows the root declarer's mount, including HMR teardown. */
export const registerSidebarWorkbenchPanels = (
  registry: Pick<WorkbenchPanelRegistry, 'register' | 'list' | 'subscribe'>,
  sources: SidebarWorkbenchSources,
): (() => void) => {
  const Navigation = (): JSX.Element => {
    const panels = useSyncExternalStore(sources.panels.subscribe, sources.panels.getSnapshot)
    const definitions = useSyncExternalStore(registry.subscribe, registry.list)
    const info = useSyncExternalStore(sources.panelInfo.subscribe, sources.panelInfo.getSnapshot)
    const hasSettings = useSyncExternalStore(sources.hasSettings.subscribe, sources.hasSettings.getSnapshot)
    const { preferences, updatePreferences } = useSidebarState()
    const orderedEntries = SidebarOrganization.orderSidebarEntries(
      [
        { id: 'new-thread', order: -2 },
        { id: 'search', order: -1 },
        ...panels.map(panel => ({ id: `panel:${panel.id}`, order: panel.order, panelId: panel.id, label: panel.label })),
      ],
      preferences.headerOrder,
    )
    const visiblePanels = orderedEntries.flatMap(entry => ('panelId' in entry && !preferences.hiddenHeaderIds.includes(entry.id) ? [entry] : []))
    const items = visiblePanels.map(panel => ({
      id: panel.id,
      label:
        definitions.find(definition => definition.mainPanelId === panel.panelId && definition.tabId === undefined && !definition.hiddenFromAdd)?.title ??
        panel.label,
      icon: sources.renderSlot('sidebar.panellist', { size: 16, active: info.activePanelId === panel.panelId }, { only: panel.panelId }),
      active: info.activePanelId === panel.panelId,
      run: () => sources.selectPanel(panel.panelId),
    }))
    return (
      <nav aria-label="Navigation">
        <TooltipProvider>
          <NavigationIconRow
            items={items}
            overflow={preferences.navigationOverflow}
            labels={sources.navigationLabels}
            settings={hasSettings ? { label: sources.settingsLabel, open: sources.openSettings } : null}
            onCustomize={sources.customizeSidebar}
            onReorder={(fromIndex, toIndex) =>
              updatePreferences({
                headerOrder: SidebarOrganization.reorderVisibleEntry({
                  orderedIds: orderedEntries.map(entry => entry.id),
                  visibleIds: visiblePanels.map(entry => entry.id),
                  fromVisible: fromIndex,
                  toVisible: toIndex,
                }),
              })
            }
          />
        </TooltipProvider>
      </nav>
    )
  }
  const Threads = ({ visible = true }: WorkbenchPanelProps): JSX.Element => {
    const { preferences } = useSidebarState()
    const host = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => {
      if (!visible || host.current === null) return
      return sources.registerCustomizationHost(host.current)
    }, [visible])
    return (
      <div ref={host} className="dshx:relative dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col">
        <div className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1 dshx:pb-2">
          {/* Keep the shared top-right Show tab row affordance clear when this panel is content-only. */}
          <SidebarSettingsButton label={sources.sidebarSettingsLabel} onClick={sources.customizeSidebar} />
          {preferences.hiddenHeaderIds.includes('new-thread') ? null : (
            <Button size="sm" variant="outline" className="dshx:min-w-0 dshx:flex-1" onClick={sources.startSession}>
              {sources.newThreadLabel}
            </Button>
          )}
          {preferences.hiddenHeaderIds.includes('search') ? null : (
            <Button size="sm" variant="ghost" className="dshx:min-w-0 dshx:flex-1" onClick={sources.searchThreads}>
              {sources.searchThreadsLabel}
            </Button>
          )}
        </div>
        {sources.renderSlot('sidebar.workspaces', { wide: true, expandSidebar: sources.expandSidebar })}
      </div>
    )
  }
  /** The rail and its list (b:952m): the root portals them into the element the visible occurrence lends. */
  const Sidebar = ({ visible = true }: WorkbenchPanelProps): JSX.Element => {
    const host = useRef<HTMLDivElement>(null)
    useLayoutEffect(() => {
      if (!visible || host.current === null) return
      return SidebarDockHost.attach(host.current)
    }, [visible])
    return <div ref={host} data-sidebar-dock-host="" className="dshx:flex dshx:h-full dshx:min-h-0 dshx:min-w-0 dshx:flex-1" />
  }
  const definitions: readonly {
    readonly id: string
    readonly title: () => string
    readonly component: (props: WorkbenchPanelProps) => ReactNode
    readonly padding: string
    readonly beforeClose?: () => void
  }[] = [
    // Registered first, so a Workbench that sees Navigation and Threads also sees the pane its left default is made of.
    {
      id: SIDEBAR_PANE_ID,
      title: () => 'Sidebar',
      component: Sidebar,
      padding: '',
      // The rail is how every page is reached: it moves, splits and floats, but Reset layout is its only way out.
      beforeClose: () => {
        throw new Error('The sidebar pane stays open. Move it elsewhere, or use Reset layout to put it back.')
      },
    },
    { id: 'dshfiles-thread-sidebar.workbench-threads', title: () => 'Threads', component: Threads, padding: 'dshx:p-3' },
    {
      id: 'dshfiles-thread-sidebar.workbench-status',
      title: () => footerTitle('sidebar.footer.above', sources.footerTitles('sidebar.footer.above')),
      component: () => sources.renderSlot('sidebar.footer.above', {}),
      padding: 'dshx:px-3 dshx:py-1',
    },
    {
      id: 'dshfiles-thread-sidebar.workbench-actions',
      title: () => footerTitle('sidebar.footer.action', sources.footerTitles('sidebar.footer.action')),
      component: () => sources.renderSlot('sidebar.footer.action', { wide: true }),
      padding: 'dshx:p-3',
    },
    { id: 'dshfiles-thread-sidebar.workbench-navigation', title: () => 'Navigation', component: Navigation, padding: 'dshx:px-1' },
  ]
  const registrations = definitions.map(definition => {
    const Content = definition.component
    const Panel = sources.decorate(props => {
      const title = useSyncExternalStore(sources.subscribeFooterTitles, definition.title)
      return (
        <PluginQueryProvider>
          <SidebarStateProvider>
            <section
              aria-label={definition.id === 'dshfiles-thread-sidebar.workbench-threads' ? undefined : title}
              data-sidebar-workbench-source={definition.id}
              className={cn(
                'dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col',
                definition.id === SIDEBAR_PANE_ID ? 'dshx:overflow-hidden' : 'dshx:overflow-y-auto',
                definition.padding,
              )}
            >
              <Content {...props} />
            </section>
          </SidebarStateProvider>
        </PluginQueryProvider>
      )
    })
    let registeredTitle: string | undefined
    let dispose = (): void => undefined
    return {
      sync: (): void => {
        const title = definition.title()
        if (registeredTitle === title) return
        // oxlint-disable-next-line antislop/no-passthrough-variable -- Snapshot the old disposer before publishing its replacement; only the old registration may be released below.
        const previous = dispose
        const registration: WorkbenchPanelDefinition = { id: definition.id, title, component: Panel }
        dispose = registry.register(definition.beforeClose === undefined ? registration : { ...registration, beforeClose: definition.beforeClose })
        registeredTitle = title
        previous()
      },
      dispose: (): void => dispose(),
    }
  })
  let disposed = false
  const sync = (): void => {
    if (!disposed) registrations.forEach(registration => registration.sync())
  }
  const unsubscribe = sources.subscribeFooterTitles(sync)
  sync()
  return () => {
    if (disposed) return
    disposed = true
    unsubscribe()
    registrations.forEach(registration => registration.dispose())
  }
}
