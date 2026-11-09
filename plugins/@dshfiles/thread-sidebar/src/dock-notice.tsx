import type { ReactNode } from 'react'

/**
 * The composer dock's thread-level notices (settled, archived) share one presentation: a one-line status strip that
 * hugs its content and centres in the dock. The state title carries the emphasis, any timing stays quiet beside it,
 * and the actions a settled or archived thread still allows sit at the end; only a pane too narrow for one line wraps.
 */
export const DockNotice = (props: {
  readonly label: string
  readonly heading: ReactNode
  readonly icon: ReactNode
  readonly meta?: ReactNode
  readonly actions: ReactNode
  readonly actionLabel: string
}): JSX.Element => (
  <div
    role="status"
    aria-label={props.label}
    className="dshx-root dshx:mx-auto dshx:my-2 dshx:flex dshx:w-fit dshx:max-w-lg dshx:flex-wrap dshx:items-center dshx:gap-x-2 dshx:gap-y-1 dshx:rounded-lg dshx:border dshx:bg-muted/40 dshx:py-1 dshx:pl-2.5 dshx:pr-1 dshx:text-sm dshx:text-muted-foreground"
  >
    {props.icon}
    <span className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-baseline dshx:gap-x-1.5 dshx:gap-y-0.5">
      <span className="dshx:font-medium dshx:text-foreground">{props.heading}</span>
      {props.meta === undefined ? null : <span className="dshx:flex dshx:items-center dshx:gap-1.5 dshx:text-xs dshx:tabular-nums">{props.meta}</span>}
    </span>
    <span aria-label={props.actionLabel} role="group" className="dshx:ml-auto dshx:flex dshx:items-center dshx:gap-1 dshx:pl-1">
      {props.actions}
    </span>
  </div>
)
