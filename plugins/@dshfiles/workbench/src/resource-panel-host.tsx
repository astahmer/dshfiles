import { useLayoutEffect, useRef } from 'react'
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
