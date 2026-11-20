import { cn } from '@dshfiles/plugin-ui/lib/utils'
import type { ReactNode } from 'react'

/** The detail pane is the one bordered card; everything inside it separates by hairlines, never by another card. */
export const DETAIL_PANE_CLASS = 'dshx:@container dshx:flex dshx:min-w-0 dshx:flex-col dshx:rounded-lg dshx:border dshx:bg-card'

/**
 * One header row for an account or a built-in provider: mark, name, what the provider reported (nothing when it
 * reported nothing), one muted line of state, then the controls.
 */
export const DetailHeader = (props: {
  readonly mark: ReactNode
  readonly title: ReactNode
  readonly detail?: string
  readonly state?: { readonly text: string; readonly tone: 'muted' | 'warning' } | null
  readonly children?: ReactNode
}): JSX.Element => (
  <header className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-x-3 dshx:gap-y-2 dshx:border-b dshx:px-4 dshx:py-3">
    {/* In a phone-width pane the name takes its own line, so the controls never squeeze it to one letter. */}
    <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-2 dshx:@max-pane-narrow:basis-full">
      {props.mark}
      {props.title}
      {props.detail === undefined || props.detail === '' ? null : (
        <span className="dshx:min-w-0 dshx:truncate dshx:text-xs dshx:text-muted-foreground">{props.detail}</span>
      )}
    </div>
    <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-2">
      {props.state === undefined || props.state === null ? null : (
        <span className={cn('dshx:text-xs', props.state.tone === 'warning' ? 'dshx:text-warning' : 'dshx:text-muted-foreground')} role="status">
          {props.state.text}
        </span>
      )}
      {props.children}
    </div>
  </header>
)
