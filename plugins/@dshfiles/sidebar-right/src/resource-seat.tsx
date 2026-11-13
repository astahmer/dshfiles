import { useLayoutEffect, useMemo, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { MoreHorizontalIcon } from '@dshfiles/plugin-ui/icons'
import type { HostObservable, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { ContextMenuTarget, MenuPoint } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import { findTabPane, type TabRecord } from '@deepseek-ai/dsh-client-ui-dockkit'
import { RightbarSeat, TabSlot, type RightbarSeatProps } from './native/client/shell/SidebarRight.tsx'
import { SidebarResourcePanelModel, type SidebarResourceTarget } from './resource-panels.js'

export interface ResourceSeatInjected {
  readonly hooks: {
    readonly workbenchMode: HostObservable<boolean>
    readonly resourceTargets: HostObservable<readonly SidebarResourceTarget[]>
  }
  /** Open the shared context menu for a tab from its header button. */
  readonly openTabMenu: (target: ContextMenuTarget, point: MenuPoint) => void
}

type ResourceSeatProps = RightbarSeatProps & InjectFace<ResourceSeatInjected>

/** Records remain in their original session store; only their presentation travels through a portal. */
function AddressableTab({ props, tab }: { readonly props: ResourceSeatProps; readonly tab: TabRecord }): ReactNode {
  const targetId = SidebarResourcePanelModel.id(props.sessionId, tab.id)
  const target = props.useResourceTargets(targets => targets.find(value => value.id === targetId))
  const occurrence = props.occurrence(tab)
  const { retainTab } = props
  useLayoutEffect(() => retainTab(tab.id, occurrence.signal), [retainTab, tab.id, occurrence.signal])
  const shortcuts = props.useShortcuts(entries => entries)
  const { getTriggerProps } = props.useContextMenu()
  const layout = props.useStore(state => state.bySession[props.sessionId]?.layout)
  if (target === undefined || layout === undefined) return null
  const pane = findTabPane(layout, tab.id)
  const menuTarget: ContextMenuTarget = { kind: 'tab', value: { sessionId: props.sessionId, paneId: pane.id, tab } }
  const shared = {
    renderSlot: props.renderSlot,
    occurrence: props.occurrence,
    sessionId: props.sessionId,
    useTabTypes: props.useTabTypes,
    useTabNavigation: props.useTabNavigation,
    useStore: props.useStore,
    fullscreen: false,
    active: target.visible,
    retainTab: props.retainTab,
    shortcuts,
    tab,
    embedded: true,
  }
  return createPortal(
    <section
      className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col"
      data-sidebar-right-session={props.sessionId}
      data-sidebar-resource-panel={target.id}
      data-sidebar-right-open
      aria-hidden={!target.visible || undefined}
      data-dockkit-pane={pane.id}
      data-sidebar-right-tab={tab.id}
      data-sidebar-right-occurrence={occurrence.id}
      tabIndex={-1}
    >
      {/* The phone sheet already names the page in its tab strip; this second title row only cost content height there. */}
      <header className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-2 dshx:border-b dshx:border-border dshx:px-2 dshx:max-sm:hidden">
        <div className="dshx:min-w-0 dshx:flex-1 dshx:truncate">
          <TabSlot {...shared} seat="sidebar.right.pane.tab.title" fallback={tab.title} />
        </div>
        <Button
          variant="ghost"
          size="icon"
          aria-label={tab.title}
          aria-haspopup="menu"
          {...getTriggerProps(menuTarget)}
          onClick={event => {
            const rect = event.currentTarget.getBoundingClientRect()
            props.openTabMenu(menuTarget, { x: rect.left, y: rect.bottom })
          }}
        >
          <MoreHorizontalIcon />
        </Button>
      </header>
      <div className="dshx:min-h-0 dshx:flex-1 dshx:overflow-hidden">
        <TabSlot {...shared} seat="sidebar.right.pane.tab" fallback={<p>{props.t('tab.unavailable')}</p>} />
      </div>
    </section>,
    target.element,
    occurrence.id,
  )
}

/** The declaring entry remains mounted in the frame's hidden carrier, owning the real session bindings. */
function AddressableSeat(props: ResourceSeatProps): ReactNode {
  const surface = props.useStore(state => state.bySession[props.sessionId])
  const tabs = useMemo(
    () => Object.values(surface?.layout.tabs ?? {}).filter(tab => tab.kind !== 'guide' && tab.kind !== 'dshfiles-workbench-side-panel'),
    [surface],
  )
  useLayoutEffect(() => {
    if (surface === undefined) props.actions.open(props.sessionId)
  }, [surface, props.actions, props.sessionId])
  return (
    <>
      {tabs.map(tab => (
        <AddressableTab key={tab.id} props={props} tab={tab} />
      ))}
    </>
  )
}

/** No native chrome or frame report is mounted in workbench mode; native mode uses the original seat unchanged. */
export function ResourceSeat(props: ResourceSeatProps): ReactNode {
  const workbench = props.useWorkbenchMode(value => value)
  // Claim this seat's store for its Session on mount: `open` only materializes the surface, and the owner re-adopts a
  // cached store whose earlier seat had released it (native/client/index.ts).
  const { actions, sessionId } = props
  useLayoutEffect(() => actions.open(sessionId), [actions, sessionId])
  return workbench ? <AddressableSeat {...props} /> : <RightbarSeat {...props} />
}
