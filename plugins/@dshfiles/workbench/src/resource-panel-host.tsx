import { useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { sidebarResourcePanels } from '@dshfiles/sidebar-right/resource-panels'
import type { WorkbenchPanelProps } from './registry.js'

/** The sidebar declarer portals genuine scoped slots into this element; no renderer authority crosses here. */
export const ResourcePanelHost = (props: WorkbenchPanelProps): JSX.Element => {
  const target = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = target.current
    if (element === null) return
    return sidebarResourcePanels().attach(props.panelId, element)
  }, [props.panelId])
  useLayoutEffect(() => {
    const element = target.current
    if (element !== null) sidebarResourcePanels().setVisible(props.panelId, element, props.visible ?? true)
  }, [props.panelId, props.visible])
  return <div ref={target} className="dshx-root dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col" />
}

/**
 * A native page that shows its body only while `shows` says its thread is on screen; otherwise the panel keeps its
 * place and tab and reads as no thread, the way Choose a view greys its thread panels out.
 */
export const createResourcePanelHost = (presence: {
  readonly subscribe: (listener: () => void) => () => void
  readonly shows: (panelId: string) => boolean
}) => {
  const PresentResourcePanel = (props: WorkbenchPanelProps): JSX.Element => {
    const shown = useSyncExternalStore(presence.subscribe, () => presence.shows(props.panelId))
    if (shown) return <ResourcePanelHost {...props} />
    return (
      <p className="dshx-root dshx:p-4 dshx:text-sm dshx:text-muted-foreground" role="status">
        Open a thread to show its panels here.
      </p>
    )
  }
  return PresentResourcePanel
}
