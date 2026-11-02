import { CircleHelpIcon } from '@dshfiles/plugin-ui/icons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@dshfiles/plugin-ui/components/ui/tooltip'
import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { BRAND_MARKS, type BrandKey } from './brand-marks.js'
import { EFFORT_BAR_COUNT, EFFORT_BAR_HEIGHTS, type EffortGlyph } from './effort-levels.js'

const TONE_FILL = {
  muted: 'dshx:bg-muted-foreground/60',
  success: 'dshx:bg-success',
  warning: 'dshx:bg-warning',
} as const

/** The model family's mark: vendored brand artwork, or its initial when the family is unknown. */
export const BrandMark = ({ brand, name, className }: { readonly brand: BrandKey | undefined; readonly name: string; readonly className?: string }) => {
  if (brand === undefined)
    return (
      <span
        aria-hidden="true"
        className={cn(
          'dshx:flex dshx:size-[18px] dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:bg-muted dshx:text-[9px] dshx:font-semibold dshx:text-muted-foreground',
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

/** The service name a route is offered through, shown after the model name. */
export const ProviderLabel = ({ label, className }: { readonly label: string; readonly className?: string }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <span className={cn('dshx:min-w-0 dshx:truncate dshx:text-[10px] dshx:leading-none dshx:text-muted-foreground/80', className)} data-model-provider-label>
        {label}
      </span>
    </TooltipTrigger>
    <TooltipContent side="top">{label}</TooltipContent>
  </Tooltip>
)

/** The model's effort glyph: six bars fill in as effort rises, with the hue shifting from neutral to amber. */
export const EffortBars = ({ glyph, className }: { readonly glyph: EffortGlyph; readonly className?: string }) => (
  <span aria-hidden="true" className={cn('dshx:flex dshx:h-3.5 dshx:w-3.5 dshx:items-end dshx:justify-center dshx:gap-[1px]', className)}>
    {Array.from({ length: EFFORT_BAR_COUNT }, (_, index) => (
      <i
        className={cn('dshx:block dshx:w-[1.5px] dshx:rounded-[1px]', index < glyph.filled ? TONE_FILL[glyph.tone] : 'dshx:bg-muted-foreground/25')}
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
          'dshx:flex dshx:h-[17px] dshx:max-w-[5.5rem] dshx:min-w-0 dshx:items-center dshx:gap-1 dshx:rounded-full dshx:bg-muted dshx:px-1.5 dshx:text-[9.5px] dshx:leading-none dshx:text-muted-foreground',
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

const quotaTone = (percent: number): string => (percent >= 50 ? 'dshx:text-muted-foreground/60' : percent >= 20 ? 'dshx:text-warning' : 'dshx:text-destructive')

/** Remaining quota, muted while healthy and stronger as it runs out. */
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
    <span className={cn('dshx:text-[10px] dshx:tabular-nums', quotaTone(percent), className)}>
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

/** A "?" that explains a control in place, never as inline helper text. */
export const InfoHint = ({ description, className }: { readonly description: string; readonly className?: string }) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <button
        aria-label={description}
        className={cn(
          'dshx:flex dshx:size-4 dshx:shrink-0 dshx:items-center dshx:justify-center dshx:rounded-full dshx:text-muted-foreground dshx:outline-none dshx:hover:text-foreground dshx:focus-visible:ring-2 dshx:focus-visible:ring-ring',
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
