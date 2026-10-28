import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@dshfiles/frame-layout/regions'
import type { ReactNode } from 'react'
import type {} from './sidebar-contract.js'

/** The sidebar alone owns this outlet; plugin panels never receive its other slot capabilities. */
export const SidebarContentSeat = ({
  renderSlot,
  collapsed,
  children,
}: PropsRenderSlots<'shell.left'> & {
  readonly collapsed: boolean
  readonly children: ReactNode
}): JSX.Element => (
  <div data-sidebar-content-seat="" className="dshx:flex dshx:w-full dshx:min-h-0 dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:overflow-hidden">
    {renderSlot('shell.left', { collapsed }, { fallback: children })}
  </div>
)

/** Standalone sidebar compatibility only: Workbench's real left override owns its regular preview view. */
export const SidebarPreviewFallback = ({
  renderSlot,
  contentOverridden,
}: PropsRenderSlots<'sidebar.footer.above'> & {
  readonly contentOverridden: boolean
}): JSX.Element | null => (contentOverridden ? null : <>{renderSlot('sidebar.footer.above', {})}</>)
