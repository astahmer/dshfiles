import type { JSX, ReactNode } from 'react'
import { PageTitleCount, PageTitleMark, type PageStatusCounts, type PageTitleMarkProps } from '../page.js'

export interface PageHeaderProps extends PageTitleMarkProps {
  readonly heading: ReactNode
  readonly description?: ReactNode
  /** A plain count after the title, in tertiary ink. */
  readonly count?: number | string
  /** Instead of `count`: one `StatusCount` per status present, attention first. */
  readonly statusCounts?: PageStatusCounts
  /** The header actions, on the trailing edge of the header's own container. */
  readonly children?: ReactNode
}

/**
 * A page header for a page that owns its layout (Settings, a split view); everything else uses `Page` from
 * `components/page`, which draws this same anatomy (council round 3 A5): one `h1` at 22px/650, an optional count or
 * `StatusCount`s, an optional destination glyph before the title (`mark`, `markTone`), a description of at most 72ch, and the actions on the trailing edge of the container it sits in, so
 * put it inside the same frame as the content: `PAGE_FRAME_CLASS.lane` (880px of content, 960px on a pane of 1280px or more; lists and forms) or
 * `PAGE_FRAME_CLASS.wide` (min(100%, 1200px), data) from `components/page`.
 */
export const PageHeader = (props: PageHeaderProps): JSX.Element => (
  <header data-slot="page-header" className="dshx:flex dshx:min-w-0 dshx:items-start dshx:justify-between dshx:gap-3">
    <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-1">
      <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-x-2 dshx:gap-y-1">
        <PageTitleMark mark={props.mark} {...(props.markTone === undefined ? {} : { markTone: props.markTone })} />
        <h1 className="dshx:min-w-0 dshx:text-title dshx:font-title dshx:break-words">{props.heading}</h1>
        <PageTitleCount count={props.count} statusCounts={props.statusCounts} />
      </div>
      {props.description === undefined || props.description === null ? null : (
        <p className="dshx:max-w-[72ch] dshx:text-sm dshx:text-muted-foreground">{props.description}</p>
      )}
    </div>
    {props.children === undefined || props.children === null ? null : (
      <div data-slot="page-actions" className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-2">
        {props.children}
      </div>
    )}
  </header>
)
