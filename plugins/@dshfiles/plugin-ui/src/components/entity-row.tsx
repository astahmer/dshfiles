import * as React from 'react'
import { cn } from '../lib/utils.js'
import { StatusGlyph, WorkStatusModel, type WorkStatus } from './work-status.js'

export interface EntityRowProps extends Omit<React.ComponentPropsWithoutRef<'div'>, 'title' | 'onSelect'> {
  /** Omit only for rows that are not work items; give every row of a list the same choice so the titles align. */
  readonly status?: WorkStatus
  /** Translated accessible name for the glyph. */
  readonly statusLabel?: string
  /** Hide the glyph from assistive technology when the row names its state in text (a badge, a status line). */
  readonly statusDecorative?: boolean
  readonly heading: React.ReactNode
  /** Muted chips after the title (agent, project, host, elapsed, cost); they wrap under the title in narrow panes. */
  readonly meta?: React.ReactNode
  /** Muted lines under the title; a plain string is one truncated line, nodes stack (give long ones `truncate`). */
  readonly description?: React.ReactNode
  /** Controls before the glyph: a selection checkbox, a disclosure chevron. */
  readonly leading?: React.ReactNode
  /** The row's inline verb (Answer, Approve, Land, Retry, Resume, Stop…) or a short action cluster. */
  readonly trailing?: React.ReactNode
  readonly selected?: boolean
  /** Makes the glyph, heading, meta and description one button; `leading` and `trailing` stay separate controls. */
  readonly onSelect?: () => void
  /** Full-width content under the row line, such as an expanded output pane. */
  readonly children?: React.ReactNode
}

/**
 * One list row for every entity: status glyph · title · muted meta chips · trailing inline verb. Dark cockpit: the
 * title is bold only when the status is `ready`, muted when `done`, and colour lives in the glyph alone.
 */
export const EntityRow = React.forwardRef<HTMLDivElement, EntityRowProps>(function EntityRow(
  { status, statusLabel, statusDecorative = false, heading, meta, description, leading, trailing, selected = false, onSelect, children, className, ...props },
  ref,
) {
  const body = (
    <>
      {status === undefined ? null : (
        <StatusGlyph status={status} decorative={statusDecorative} className="dshx:mt-px" {...(statusLabel === undefined ? {} : { label: statusLabel })} />
      )}
      <span className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:flex-col dshx:gap-0.5">
        <span className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-x-2 dshx:gap-y-1">
          <span
            data-slot="entity-row-title"
            className={cn(
              'dshx:min-w-0 dshx:text-sm dshx:break-words',
              status !== undefined && WorkStatusModel.isEmphasized(status) && 'dshx:font-semibold',
              status !== undefined && WorkStatusModel.isMuted(status) && 'dshx:text-muted-foreground',
            )}
          >
            {heading}
          </span>
          {meta === undefined || meta === null ? null : (
            <span
              data-slot="entity-row-meta"
              className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-center dshx:gap-x-2 dshx:gap-y-1 dshx:text-xs dshx:text-muted-foreground"
            >
              {meta}
            </span>
          )}
        </span>
        {description === undefined || description === null ? null : (
          <span
            data-slot="entity-row-description"
            className={cn(
              'dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-0.5 dshx:text-xs dshx:text-muted-foreground',
              typeof description === 'string' && 'dshx:block dshx:truncate',
            )}
          >
            {description}
          </span>
        )}
      </span>
    </>
  )
  return (
    <div
      ref={ref}
      data-slot="entity-row"
      data-status={status}
      data-selected={selected ? '' : undefined}
      className={cn(
        'dshx:flex dshx:min-w-0 dshx:flex-col dshx:rounded-md dshx:transition-colors',
        onSelect !== undefined && 'dshx:hover:bg-accent/60',
        selected && 'dshx:bg-accent',
        className,
      )}
      {...props}
    >
      <div className="dshx:flex dshx:min-w-0 dshx:flex-wrap dshx:items-start dshx:gap-x-2 dshx:gap-y-1.5 dshx:px-3 dshx:py-2">
        {leading === undefined || leading === null ? null : (
          <span data-slot="entity-row-leading" className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1">
            {leading}
          </span>
        )}
        {onSelect === undefined ? (
          <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-start dshx:gap-2">{body}</div>
        ) : (
          <button
            type="button"
            aria-current={selected ? 'true' : undefined}
            onClick={onSelect}
            className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-start dshx:gap-2 dshx:rounded-sm dshx:text-left dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/60"
          >
            {body}
          </button>
        )}
        {trailing === undefined || trailing === null ? null : (
          <div
            data-slot="entity-row-trailing"
            className="dshx:flex dshx:shrink-0 dshx:flex-wrap dshx:items-center dshx:justify-end dshx:gap-1 dshx:@max-pane-narrow:w-full dshx:@max-pane-narrow:justify-start"
          >
            {trailing}
          </div>
        )}
      </div>
      {children}
    </div>
  )
})

/** A bordered list of `EntityRow`s with hairline separators; one list shape for every page. */
export const EntityList = React.forwardRef<HTMLDivElement, React.ComponentPropsWithoutRef<'div'>>(function EntityList({ className, ...props }, ref) {
  return (
    <div
      ref={ref}
      role="list"
      data-slot="entity-list"
      className={cn(
        'dshx:flex dshx:min-w-0 dshx:flex-col dshx:divide-y dshx:divide-border dshx:rounded-lg dshx:border dshx:border-border dshx:bg-card dshx:[&>[data-slot=entity-row]]:rounded-none dshx:[&>[data-slot=entity-row]:first-child]:rounded-t-lg dshx:[&>[data-slot=entity-row]:last-child]:rounded-b-lg',
        className,
      )}
      {...props}
    />
  )
})
