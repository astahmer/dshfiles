import { useLayoutEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { MoreHorizontalIcon } from '@dshfiles/plugin-ui/icons'
import type { HostObservable, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { findTabPane, type TabRecord } from '@deepseek-ai/dsh-client-ui-dockkit'
import { RightbarSeat, TabSlot, type RightbarSeatProps } from './native/client/shell/SidebarRight.tsx'
import { SidebarResourcePanelModel, type SidebarResourceTarget } from './resource-panels.js'

export interface ResourceSeatInjected {
  readonly hooks: {
    readonly workbenchMode: HostObservable<boolean>
    readonly resourceTargets: HostObservable<readonly SidebarResourceTarget[]>
  }
}

type ResourceSeatProps = RightbarSeatProps & InjectFace<ResourceSeatInjected>

/** Records remain in their original session store; only their presentation travels through a portal. */
function AddressableTab({ props, tab, target }: {
  readonly props: ResourceSeatProps
  readonly tab: TabRecord
  readonly target: SidebarResourceTarget | undefined
}): ReactNode {
  const occurrence = props.occurrence(tab)
  const { retainTab } = props
  useLayoutEffect(() => retainTab(tab.id, occurrence.signal), [retainTab, tab.id, occurrence.signal])
  const shortcuts = props.useShortcuts(entries => entries)
  const [menuOpen, setMenuOpen] = useState(false)
  const layout = props.useStore(state => state.bySession[props.sessionId]?.layout)
  if (target === undefined || layout === undefined) return null
  const pane = findTabPane(layout, tab.id)
  const shared = {
    renderSlot: props.renderSlot, occurrence: props.occurrence, useTabTypes: props.useTabTypes,
    useTabNavigation: props.useTabNavigation, useStore: props.useStore, fullscreen: false,
    active: target.visible, retainTab: props.retainTab, shortcuts, tab, embedded: true,
  }
  return createPortal(
    <section className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col" data-sidebar-right-session={props.sessionId} data-sidebar-resource-panel={target.id}
      data-sidebar-right-open aria-hidden={!target.visible || undefined} data-dockkit-pane={pane.id} data-sidebar-right-tab={tab.id}
      data-sidebar-right-occurrence={occurrence.id} tabIndex={-1}>
      <header className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:px-2">
        <div className="dshx:min-w-0 dshx:flex-1 dshx:truncate"><TabSlot {...shared} seat="sidebar.right.pane.tab.title" fallback={tab.title} /></div>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" aria-label={tab.title}><MoreHorizontalIcon /></Button></DropdownMenuTrigger>
          <DropdownMenuContent>{props.renderSlot('sidebar.right.tab.menu.item', { tab, dismiss: () => setMenuOpen(false) })}</DropdownMenuContent>
        </DropdownMenu>
      </header>
      <div className="dshx:min-h-0 dshx:flex-1 dshx:overflow-hidden">
        <TabSlot {...shared} seat="sidebar.right.pane.tab" fallback={<p>{props.t('tab.unavailable')}</p>} />
      </div>
    </section>, target.element, occurrence.id,
  )
}

/** The declaring entry remains mounted in the frame's hidden carrier, owning the real session bindings. */
function AddressableSeat(props: ResourceSeatProps): ReactNode {
  const surface = props.useStore(state => state.bySession[props.sessionId])
  const targets = props.useResourceTargets(value => value)
  const tabs = useMemo(() => Object.values(surface?.layout.tabs ?? {}).filter(tab => tab.kind !== 'guide' && tab.kind !== 'dshfiles-workbench-side-panel'), [surface])
  useLayoutEffect(() => {
    if (surface === undefined) props.actions.open(props.sessionId)
  }, [surface, props.actions, props.sessionId])
  return <>{tabs.map(tab => <AddressableTab key={tab.id} props={props} tab={tab} target={targets.find(target => target.id === SidebarResourcePanelModel.id(props.sessionId, tab.id))} />)}</>
}

/** No native chrome or frame report is mounted in workbench mode; native mode uses the original seat unchanged. */
export function ResourceSeat(props: ResourceSeatProps): ReactNode {
  const workbench = props.useWorkbenchMode(value => value)
  return workbench ? <AddressableSeat {...props} /> : <RightbarSeat {...props} />
}
