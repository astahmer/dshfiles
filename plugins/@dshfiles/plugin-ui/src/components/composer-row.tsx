import * as React from 'react'
import { cn } from '../lib/utils.js'

/**
 * One state row in the stack above the composer.
 *
 * Every owner draws the same row shape: a leading icon, one primary label,
 * muted meta and trailing actions, at one height and one density. Without it
 * each plugin brought its own height, padding, border, icon position and action
 * layout, so stacked rows read as unrelated bars.
 */
export interface ComposerRowProps extends Omit<React.ComponentPropsWithoutRef<'div'>, 'title'> {
  /** Leading glyph; it sits in the same 16px box on every row. */
  readonly icon?: React.ReactNode | undefined
  /** The row's primary text: a state name, a count, a file total. */
  readonly label: React.ReactNode
  /** Muted detail after the label (status, counts, an objective); truncates first. */
  readonly meta?: React.ReactNode | undefined
  /** Trailing controls; they stay separate from the `onSelect` button. */
  readonly actions?: React.ReactNode | undefined
  /** Makes the icon, label and meta one button, e.g. a disclosure header. */
  readonly onSelect?: (() => void) | undefined
  /** Accessible name for that button when the visible label alone is not the whole action. */
  readonly selectLabel?: string | undefined
  /** id of the region the `onSelect` button expands. */
  readonly selectControls?: string | undefined
  /** Sets `aria-expanded` on the `onSelect` button. */
  readonly expanded?: boolean | undefined
  /**
   * `card` is the standalone row drawn above the composer. `plain` drops the
   * frame for a row already inside another panel, such as the queue dock.
   */
  readonly variant?: 'card' | 'plain'
  /** Full-width content under the row line, such as an expanded output or list. */
  readonly children?: React.ReactNode | undefined
}

export const ComposerRow = React.forwardRef<HTMLDivElement, ComposerRowProps>(function ComposerRow(
  { icon, label, meta, actions, onSelect, selectLabel, selectControls, expanded, variant = 'card', children, className, ...props },
  ref,
) {
  const body = (
    <>
      {icon === undefined || icon === null ? null : (
        <span
          data-slot="composer-row-icon"
          aria-hidden
          className="dshx:grid dshx:size-4 dshx:flex-none dshx:place-items-center dshx:text-muted-foreground dshx:[&_svg]:size-3.5"
        >
          {icon}
        </span>
      )}
      <span
        data-slot="composer-row-label"
        className="dshx:min-w-0 dshx:max-w-[60%] dshx:shrink dshx:truncate dshx:text-sm dshx:font-medium dshx:text-foreground"
      >
        {label}
      </span>
      {meta === undefined || meta === null ? (
        <span className="dshx:flex-1" />
      ) : (
        <span
          data-slot="composer-row-meta"
          className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-1.5 dshx:overflow-hidden dshx:text-xs dshx:text-muted-foreground"
        >
          {meta}
        </span>
      )}
    </>
  )
  return (
    <div
      ref={ref}
      data-slot="composer-row"
      data-variant={variant}
      data-expanded={expanded === true ? '' : undefined}
      className={cn(
        'dshx-root dshx:flex dshx:min-w-0 dshx:flex-col dshx:text-sm',
        variant === 'card' &&
          'dshx:mx-auto dshx:w-[calc(100%_-_var(--dsh-composer-side-clearance,0px)*2_-_var(--dsh-composer-dock-inset,0px)*4)] dshx:max-w-[calc(var(--dsh-composer-card-max-width)_-_var(--dsh-composer-dock-inset,0px)*4)] dshx:flex-none dshx:overflow-hidden dshx:rounded-lg dshx:border dshx:border-border dshx:bg-popover',
        className,
      )}
      {...props}
    >
      <div className="dshx:flex dshx:h-9 dshx:min-h-9 dshx:items-center dshx:gap-2 dshx:px-2.5">
        {onSelect === undefined ? (
          <div className="dshx:flex dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-2">{body}</div>
        ) : (
          <button
            type="button"
            aria-label={selectLabel}
            aria-controls={selectControls}
            aria-expanded={expanded}
            onClick={onSelect}
            className="dshx:flex dshx:h-full dshx:min-w-0 dshx:flex-1 dshx:items-center dshx:gap-2 dshx:rounded-sm dshx:text-left dshx:outline-none dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring/60"
          >
            {body}
          </button>
        )}
        {actions === undefined || actions === null ? null : (
          <div data-slot="composer-row-actions" className="dshx:flex dshx:shrink-0 dshx:items-center dshx:gap-1">
            {actions}
          </div>
        )}
      </div>
      {children}
    </div>
  )
})
