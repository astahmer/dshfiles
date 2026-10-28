import type { SidebarPanelMetadata, SidebarRootInjected } from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { HostObservable, PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchPanelDefinition, WorkbenchPanelProps, WorkbenchPanelRegistry } from '@dshfiles/workbench/registry'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { PluginQueryProvider } from '@dshfiles/plugin-ui/query'
import { useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { SidebarSettingsButton } from './sidebar-customization.js'
import { SidebarStateProvider, useSidebarState } from './sidebar-state.js'
import { SidebarOrganization } from './organization.js'
import type { sidebarChildren } from './sidebar-contract.js'

type SidebarRenderSlot = PropsRenderSlots<keyof typeof sidebarChildren>['renderSlot']
type FooterSlot = 'sidebar.footer.above' | 'sidebar.footer.action'

/** Group only explicitly qualified display labels; a prefix is not framework ownership provenance. */
const footerTitle = (slot: FooterSlot, labels: readonly string[]): string => {
  const noun = slot === 'sidebar.footer.above' ? 'Previews' : 'Controls'
  const fallback = `Thread Sidebar: Plugin ${noun.toLowerCase()}`
  if (labels.length === 0) return fallback
  const prefixes = labels.map(label => {
    const separator = label.indexOf(':')
    const prefix = label.slice(0, separator).trim()
    return separator > 0 && prefix !== '' && label.slice(separator + 1).trim() !== '' ? prefix : undefined
  })
  const prefix = prefixes[0]
  if (prefix === undefined || prefixes.some(candidate => candidate !== prefix)) return fallback
  return slot === 'sidebar.footer.above' && labels.length === 1 ? (labels[0] ?? fallback) : `${prefix}: ${noun}`
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
    const { preferences } = useSidebarState()
    const visiblePanels = SidebarOrganization.orderSidebarEntries(
      panels.map(panel => ({ ...panel, id: `panel:${panel.id}`, panelId: panel.id })),
      preferences.headerOrder,
    ).filter(panel => !preferences.hiddenHeaderIds.includes(panel.id))
    return (
      <nav aria-label="Navigation" className="dshx:flex dshx:flex-col dshx:gap-1">
        {visiblePanels.map(panel => (
          <Button
            key={panel.id}
            variant="ghost"
            className="dshx:min-w-0 dshx:justify-start dshx:gap-2"
            aria-current={info.activePanelId === panel.panelId ? 'page' : undefined}
            onClick={() => sources.selectPanel(panel.panelId)}
          >
            <span className="dshx:shrink-0">
              {sources.renderSlot('sidebar.panellist', { size: 18, active: info.activePanelId === panel.panelId }, { only: panel.panelId })}
            </span>
            <span className="dshx:min-w-0 dshx:truncate">
              {definitions.find(definition => definition.mainPanelId === panel.panelId && definition.tabId === undefined && !definition.hiddenFromAdd)?.title ??
                panel.label}
            </span>
          </Button>
        ))}
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
  const definitions = [
    { id: 'dshfiles-thread-sidebar.workbench-threads', title: () => 'Thread Sidebar: Threads', component: Threads },
    {
      id: 'dshfiles-thread-sidebar.workbench-status',
      title: () => footerTitle('sidebar.footer.above', sources.footerTitles('sidebar.footer.above')),
      component: () => sources.renderSlot('sidebar.footer.above', {}),
    },
    {
      id: 'dshfiles-thread-sidebar.workbench-actions',
      title: () => footerTitle('sidebar.footer.action', sources.footerTitles('sidebar.footer.action')),
      component: () => sources.renderSlot('sidebar.footer.action', { wide: true }),
    },
    { id: 'dshfiles-thread-sidebar.workbench-navigation', title: () => 'Thread Sidebar: Navigation', component: Navigation },
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
                'dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col dshx:overflow-y-auto',
                definition.id === 'dshfiles-thread-sidebar.workbench-status' ? 'dshx:px-3 dshx:py-1' : 'dshx:p-3',
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
        dispose = registry.register({ id: definition.id, title, component: Panel })
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
