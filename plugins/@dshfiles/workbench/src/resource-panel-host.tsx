import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button } from '@dshfiles/plugin-ui/components/ui/button'
import { sidebarResourcePanels } from '@dshfiles/sidebar-right/resource-panels'
import type { WorkbenchPanelProps } from './registry.js'

/**
 * How long an attached resource panel may stay empty before the shell says so. The declarer portals a tab body into
 * the element on its own render pass, so an empty child list at attach time is normal; a panel that never receives one
 * would otherwise stay a blank tab with only its title.
 */
const NO_VIEW_DELAY_MS = 800

/** The sidebar declarer portals genuine scoped slots into this element; no renderer authority crosses here. */
export const ResourcePanelHost = (props: WorkbenchPanelProps): JSX.Element => {
  const target = useRef<HTMLDivElement>(null)
  const [empty, setEmpty] = useState(false)
  useLayoutEffect(() => {
    const element = target.current
    if (element === null) return
    return sidebarResourcePanels().attach(props.panelId, element)
  }, [props.panelId])
  useLayoutEffect(() => {
    const element = target.current
    if (element !== null) sidebarResourcePanels().setVisible(props.panelId, element, props.visible ?? true)
  }, [props.panelId, props.visible])
  useEffect(() => {
    const element = target.current
    if (element === null) return
    const review = (): void => setEmpty(element.childElementCount === 0)
    const observer = new MutationObserver(review)
    observer.observe(element, { childList: true })
    const timer = globalThis.setTimeout(review, NO_VIEW_DELAY_MS)
    return () => {
      observer.disconnect()
      globalThis.clearTimeout(timer)
    }
  }, [props.panelId])
  return (
    <div className="dshx-root dshx:relative dshx:h-full dshx:min-h-0">
      <div ref={target} className="dshx:flex dshx:h-full dshx:min-h-0 dshx:flex-col" />
      {empty ? (
        <div className="dshx:absolute dshx:inset-0 dshx:flex dshx:flex-col dshx:items-center dshx:justify-center dshx:gap-3 dshx:p-4 dshx:text-center">
          <p className="dshx:text-sm dshx:text-muted-foreground" role="status">
            This panel has no view to show.
          </p>
          <Button size="sm" variant="outline" onClick={() => props.onClose?.() ?? sidebarResourcePanels().close(props.panelId)}>
            Close panel
          </Button>
        </div>
      ) : null}
    </div>
  )
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
