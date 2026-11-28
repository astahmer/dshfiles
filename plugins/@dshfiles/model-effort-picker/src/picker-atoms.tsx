import { useState, type ReactElement } from 'react'
import { CircleHelpIcon } from '@dshfiles/plugin-ui/icons'
import { ModelMark, modelFamily } from '@dshfiles/plugin-ui/components/model-mark'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { BRAND_MARKS, type BrandKey } from './brand-marks.js'
import { EFFORT_BAR_COUNT, EFFORT_BAR_HEIGHTS, type EffortGlyph } from './effort-levels.js'

const TONE_FILL = {
  muted: 'dshx:bg-muted-foreground/60',
  success: 'dshx:bg-success',
  warning: 'dshx:bg-warning',
} as const

/**
 * Council round 18 C3: a family the kit draws takes the kit's 16 px mark in its brand colour, deepened in light as
 * RouteModel does on the dock and list rows (3:1 on every row fill, plugin-ui tests/route-model), so the composer's
 * model reads the same there; the picker's label stays neutral. Follow-up (lane A): let `ModelMark` take that tone.
 */
const KIT_MARK_TONE = 'dshx:brightness-85 dshx:dark:brightness-100'

/**
 * The model family's mark: the kit's ModelMark for the families it draws, else vendored brand artwork, or its initial
 * when the family is unknown. The kit mark is always 16 px; `className` sizes the picker's own artwork.
 */
export const BrandMark = ({ brand, name, className }: { readonly brand: BrandKey | undefined; readonly name: string; readonly className?: string }) => {
  // Round 4 T2: the kit mark is always 16 px, so `className` places a box around it (it was dropped, and the details
  // header's alignment offset never landed).
  if (brand !== undefined && modelFamily(brand) !== undefined)
    return (
      <span className={cn('dshx:flex dshx:size-4 dshx:shrink-0 dshx:items-center dshx:justify-center', className)} data-model-brand-box>
        <ModelMark modelId={brand} className={KIT_MARK_TONE} />
      </span>
    )
  if (brand === undefined)
    return (
      <span
        aria-hidden="true"
        className={cn(
          'dshx:flex dshx:size-[18px] dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:bg-muted dshx:text-2xs dshx:font-semibold dshx:text-muted-foreground',
          className,
        )}
      >
        {name.slice(0, 1)}
      </span>
    )
  const mark = BRAND_MARKS[brand]
  return (
    <svg aria-hidden="true" className={cn('dshx:size-[18px] dshx:shrink-0', className)} data-brand={brand} style={{ color: mark.color }} viewBox="0 0 24 24">
      {mark.paths.map((path, index) => (
        <path d={path.d} fill={path.fill ?? 'currentColor'} fillRule="evenodd" key={index} />
      ))}
    </svg>
  )
}

/** Whether a text element is cut short by its ellipsis. */
export const isTruncated = (element: { readonly scrollWidth: number; readonly clientWidth: number } | null): boolean =>
  element !== null && element.scrollWidth > element.clientWidth + 1

/**
 * Council picker round 1, N3: a tooltip only when it adds something. It opens (after the provider's 500 ms) only when
 * the text it wraps is truncated, below the text, so it never covers the search above the list or the row itself.
 */
export const TruncatedTooltip = ({
  children,
  content,
  shortened = false,
}: {
  readonly children: ReactElement
  readonly content: string
  /** The text was shortened before it was drawn (a middle cut, round 4 T5), so the tooltip has something to add. */
  readonly shortened?: boolean
}) => {
  const [open, setOpen] = useState(false)
  return (
    <Tooltip
      onOpenChange={next => {
        if (!next) setOpen(false)
      }}
      open={open}
    >
      <TooltipTrigger
        asChild
        onFocus={event => setOpen(shortened || isTruncated(event.currentTarget))}
        onPointerEnter={event => setOpen(shortened || isTruncated(event.currentTarget))}
        onPointerLeave={() => setOpen(false)}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent align="start" data-model-truncated-tooltip side="bottom">
        {content}
      </TooltipContent>
    </Tooltip>
  )
}

/** The service name a route is offered through, shown after the model name. */
export const ProviderLabel = ({ label, className }: { readonly label: string; readonly className?: string }) => (
  <TruncatedTooltip content={label}>
    <span className={cn('dshx:min-w-0 dshx:truncate dshx:text-xs dshx:leading-none dshx:text-muted-foreground', className)} data-model-provider-label>
      {label}
    </span>
  </TruncatedTooltip>
)

/** The model's effort glyph: six bars fill in as effort rises, with the hue shifting from neutral to amber. */
export const EffortBars = ({ glyph, className }: { readonly glyph: EffortGlyph; readonly className?: string }) => (
  <span aria-hidden="true" className={cn('dshx:flex dshx:h-3.5 dshx:w-3.5 dshx:items-end dshx:justify-center dshx:gap-[1px]', className)}>
    {Array.from({ length: EFFORT_BAR_COUNT }, (_, index) => (
      <i
        className={cn('dshx:block dshx:w-[1.5px] dshx:rounded-xs', index < glyph.filled ? TONE_FILL[glyph.tone] : 'dshx:bg-muted-foreground/25')}
        key={index}
        style={{ height: `${EFFORT_BAR_HEIGHTS[index] ?? EFFORT_BAR_HEIGHTS[0]}px` }}
      />
    ))}
  </span>
)

/** The account a route belongs to: its colour dot, a compact label, and the full name on hover. */
export const AccountBadge = ({
  name,
  label = name,
  color,
  className,
}: {
  readonly name: string
  readonly label?: string | undefined
  readonly color: string
  readonly className?: string
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span
        className={cn(
          'dshx:flex dshx:h-[17px] dshx:max-w-[5.5rem] dshx:min-w-0 dshx:items-center dshx:gap-1 dshx:rounded-full dshx:bg-muted dshx:px-1.5 dshx:text-2xs dshx:leading-none dshx:text-muted-foreground',
          className,
        )}
        data-model-account-badge
      >
        <i aria-hidden="true" className="dshx:size-1.5 dshx:shrink-0 dshx:rounded-full" style={{ backgroundColor: color }} />
        <span className="dshx:min-w-0 dshx:truncate">{label}</span>
      </span>
    </TooltipTrigger>
    <TooltipContent side="top">{name}</TooltipContent>
  </Tooltip>
)

/**
 * The quota convention every surface shares (ai-accounts `quotaTone`): secondary ink while healthy, amber at 15% left or
 * less, red once spent. Round 3 R5: no opacity on the healthy ink, which at 60 % fell under 4.5:1 on the rows.
 */
export const quotaTone = (percent: number): string =>
  Math.round(percent) <= 0 ? 'dshx:text-destructive' : percent <= 15 ? 'dshx:text-warning' : 'dshx:text-muted-foreground'

/** Remaining quota as a bare number, for a control that already has its own tooltip (the detail panel's account chips). */
export const QuotaPercent = ({ percent, onReserve, className }: { readonly percent: number; readonly onReserve: boolean; readonly className?: string }) => (
  <span className={cn('dshx:text-2xs dshx:tabular-nums', quotaTone(percent), className)} data-model-quota-percent>
    {onReserve ? '☾ ' : ''}
    {Math.round(percent)}%
  </span>
)

/** Remaining quota, muted while healthy; amber near the limit and red once it is reached. */
export const QuotaText = ({
  percent,
  label,
  onReserve,
  className,
}: {
  readonly percent: number
  readonly label: string
  readonly onReserve: boolean
  readonly className?: string
}) => {
  const rounded = Math.round(percent)
  const text = (
    <span className={cn('dshx:text-2xs dshx:tabular-nums', quotaTone(percent), className)}>
      {onReserve ? '☾ ' : ''}
      {rounded}%
    </span>
  )
  return (
    <Tooltip>
      <TooltipTrigger asChild>{text}</TooltipTrigger>
      <TooltipContent side="top">
        {label}: {rounded}% left
      </TooltipContent>
    </Tooltip>
  )
}

/** A "?" that explains a control in place, never as inline helper text; `label` names it ("About reasoning effort"). */
export const InfoHint = ({ description, label, className }: { readonly description: string; readonly label?: string; readonly className?: string }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        aria-label={label ?? description}
        className={cn(
          'dshx:flex dshx:size-4 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:pointer-coarse:hidden dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring',
          className,
        )}
        type="button"
      >
        <CircleHelpIcon aria-hidden="true" className="dshx:size-3.5" />
      </button>
    </TooltipTrigger>
    <TooltipContent className="dshx:max-w-56 dshx:text-pretty" side="top">
      {description}
    </TooltipContent>
  </Tooltip>
)
