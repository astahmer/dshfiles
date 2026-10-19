import type { ReactNode } from 'react'

/**
 * The composer dock's thread-level notices (settled, archived) share one presentation: a card that hugs its content
 * and centres in the dock. Stretched to the dock's width, the same notice reads as another band of composer chrome,
 * and the empty middle between its label and its actions is what makes it look broken.
 */
export const DockNotice = (props: {
  readonly label: string
  readonly icon: ReactNode
  readonly meta?: ReactNode
  readonly actions: ReactNode
}): JSX.Element => (
  <div
    role="status"
    aria-label={props.label}
    className="dshx-root dshx:mx-auto dshx:my-2 dshx:flex dshx:w-fit dshx:max-w-lg dshx:flex-wrap dshx:items-center dshx:gap-x-2 dshx:gap-y-1.5 dshx:rounded-md dshx:border dshx:bg-muted/40 dshx:px-3 dshx:py-1.5 dshx:text-sm dshx:text-muted-foreground"
  >
    {props.icon}
    <span className="dshx:min-w-0">{props.label}</span>
    {props.meta === undefined ? null : <span className="dshx:flex dshx:items-center dshx:gap-2 dshx:text-xs dshx:tabular-nums">{props.meta}</span>}
    <span className="dshx:ml-1 dshx:flex dshx:items-center dshx:gap-1.5">{props.actions}</span>
  </div>
)
