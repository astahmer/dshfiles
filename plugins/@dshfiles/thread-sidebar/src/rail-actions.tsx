import { EntityList, EntityRow } from '@dshfiles/plugin-ui/components/entity-row'
import { Popover, PopoverAnchor, PopoverContent } from '@dshfiles/plugin-ui/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { useRef, useState, type ReactNode, type RefObject } from 'react'

/**
 * One DSH action on the rail (b:kgcc): Restart DSH, a pending page reload, Copy DSH URL for agents, Pair a phone. They
 * are verbs, not panels, so they sit in a small group above Settings instead of in the folder model; on a phone the
 * More tab lists them under "DSH". The sidebar shell decides which are available; this file only draws them.
 */
export interface RailAction {
  readonly id: 'restart' | 'reload' | 'copy-url' | 'pair-phone'
  /** The accessible name and the tooltip. */
  readonly label: string
  readonly icon: ReactNode
  /**
   * Amber for a pending restart or page reload, the one signal the group carries (DESIGN.md allows amber for a pending
   * restart); every other action stays muted. `pulse` adds the restart button's slow pulse.
   */
  readonly tone?: 'muted' | 'warning'
  readonly pulse?: boolean
  /** Shown in the tooltip (and announced) for a moment after the action ran, such as "Copied". */
  readonly feedback?: string | null
  /** The icon while the feedback shows (a check mark after Copy). */
  readonly feedbackIcon?: ReactNode
  readonly onSelect?: () => void
  /** A popover the action opens instead of running `onSelect` (the pending page reload's plugin list). */
  readonly popover?: { readonly label: string; readonly content: ReactNode; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }
}

const toneClass = (action: RailAction): string =>
  action.tone === 'warning' ? cn('dshx:text-warning', action.pulse === true && 'dshx:animate-pulse') : 'dshx:text-muted-foreground dshx:hover:text-foreground'

/** The action's popover, anchored to its control; a click on that control toggles it rather than closing and reopening. */
const ActionPopover = (props: {
  readonly popover: NonNullable<RailAction['popover']>
  readonly anchor: RefObject<HTMLElement | null>
  readonly side: 'right' | 'top'
  readonly children: ReactNode
}): JSX.Element => (
  <Popover open={props.popover.open} onOpenChange={props.popover.onOpenChange}>
    {props.children}
    <PopoverContent
      side={props.side}
      align={props.side === 'right' ? 'end' : 'start'}
      className="dshx-root dshx:flex dshx:w-72 dshx:max-w-[calc(100vw-16px)] dshx:flex-col dshx:gap-3"
      aria-label={props.popover.label}
      onInteractOutside={event => {
        if (event.target instanceof Node && props.anchor.current?.contains(event.target) === true) event.preventDefault()
      }}
    >
      {props.popover.content}
    </PopoverContent>
  </Popover>
)

const RailActionButton = (props: { readonly action: RailAction }): JSX.Element => {
  const { action } = props
  const [hovered, setHovered] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const feedback = action.feedback ?? null
  const button = (
    <button
      ref={anchor}
      type="button"
      data-rail-action={action.id}
      aria-label={action.label}
      aria-expanded={action.popover === undefined ? undefined : action.popover.open}
      onClick={() => (action.popover === undefined ? action.onSelect?.() : action.popover.onOpenChange(!action.popover.open))}
      // Same size and hover as the rail's + New folder (b:kgcc).
      className={cn(
        'dshx:flex dshx:w-full dshx:shrink-0 dshx:flex-col dshx:items-center dshx:gap-0.5 dshx:rounded-md dshx:py-1.5 dshx:outline-none dshx:transition-colors dshx:hover:bg-accent dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring',
        toneClass(action),
      )}
    >
      <span className="dshx:inline-flex dshx:size-5 dshx:items-center dshx:justify-center dshx:[&_svg]:size-4" aria-hidden="true">
        {feedback !== null && action.feedbackIcon !== undefined ? action.feedbackIcon : action.icon}
      </span>
    </button>
  )
  // Controlled so "Copied" stays up after the click that closes an uncontrolled tooltip.
  const tooltip = (trigger: ReactNode): JSX.Element => (
    <Tooltip open={hovered || feedback !== null} onOpenChange={setHovered}>
      <TooltipTrigger asChild>{trigger}</TooltipTrigger>
      <TooltipContent side="right">{feedback ?? action.label}</TooltipContent>
    </Tooltip>
  )
  if (action.popover === undefined) return tooltip(button)
  return (
    <ActionPopover popover={action.popover} anchor={anchor} side="right">
      {tooltip(<PopoverAnchor asChild>{button}</PopoverAnchor>)}
    </ActionPopover>
  )
}

/** The rail group, directly above Settings (expanded and collapsed alike). Renders nothing without an action. */
export const RailActionGroup = (props: { readonly actions: readonly RailAction[] }): JSX.Element | null => {
  if (props.actions.length === 0) return null
  return (
    <div role="group" aria-label="DSH actions" data-rail-actions="" className="dshx:flex dshx:flex-col dshx:gap-0.5">
      {props.actions.map(action => (
        <RailActionButton key={action.id} action={action} />
      ))}
      {/* The Copied feedback is announced, not only drawn in a tooltip. */}
      <span role="status" className="dshx:sr-only">
        {props.actions.find(action => (action.feedback ?? null) !== null)?.feedback ?? ''}
      </span>
    </div>
  )
}

const PhoneActionRow = (props: { readonly action: RailAction }): JSX.Element => {
  const { action } = props
  const anchor = useRef<HTMLDivElement>(null)
  const feedback = action.feedback ?? null
  const row = (
    <EntityRow
      ref={anchor}
      role="listitem"
      data-rail-action={action.id}
      // 44pt targets on a phone whatever the pointer reports (b:kgcc).
      className="dshx:[&_button]:min-h-11 dshx:[&_button]:items-center dshx:[&>div]:items-center"
      leading={
        <span className={cn('dshx:inline-flex dshx:size-5 dshx:items-center dshx:justify-center dshx:[&_svg]:size-5', toneClass(action))} aria-hidden="true">
          {feedback !== null && action.feedbackIcon !== undefined ? action.feedbackIcon : action.icon}
        </span>
      }
      heading={<span className={cn(action.tone === 'warning' && 'dshx:text-warning')}>{feedback ?? action.label}</span>}
      onSelect={() => (action.popover === undefined ? action.onSelect?.() : action.popover.onOpenChange(!action.popover.open))}
    />
  )
  if (action.popover === undefined) return row
  return (
    <ActionPopover popover={action.popover} anchor={anchor} side="top">
      <PopoverAnchor asChild>{row}</PopoverAnchor>
    </ActionPopover>
  )
}

/** Phone More tab: the same actions as rows in a "DSH" section at the end. Renders nothing without an action. */
export const PhoneRailActions = (props: { readonly actions: readonly RailAction[] }): JSX.Element | null => {
  if (props.actions.length === 0) return null
  return (
    <section aria-labelledby="phone-dsh-actions" data-phone-dsh-actions="" className="dshx:flex dshx:flex-col dshx:gap-1.5 dshx:pt-4">
      <h2 id="phone-dsh-actions" className="dshx:px-1 dshx:text-xs dshx:font-medium dshx:text-muted-foreground">
        DSH
      </h2>
      <EntityList aria-label="DSH actions">
        {props.actions.map(action => (
          <PhoneActionRow key={action.id} action={action} />
        ))}
      </EntityList>
      <span role="status" className="dshx:sr-only">
        {props.actions.find(action => (action.feedback ?? null) !== null)?.feedback ?? ''}
      </span>
    </section>
  )
}
