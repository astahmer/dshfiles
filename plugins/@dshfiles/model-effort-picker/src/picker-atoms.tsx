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

/** Four bars whose fill and hue name the selected effort level. */
export const EffortBars = ({ glyph, className }: { readonly glyph: EffortGlyph; readonly className?: string }) => (
  <span aria-hidden="true" className={cn('dshx:flex dshx:h-3.5 dshx:w-3.5 dshx:items-end dshx:justify-center dshx:gap-[2px]', className)}>
    {Array.from({ length: EFFORT_BAR_COUNT }, (_, index) => (
      <i
        className={cn('dshx:block dshx:w-[2px] dshx:rounded-[1px]', index < glyph.filled ? TONE_FILL[glyph.tone] : 'dshx:bg-muted-foreground/25')}
        key={index}
        style={{ height: `${EFFORT_BAR_HEIGHTS[index] ?? EFFORT_BAR_HEIGHTS[0]}px` }}
      />
    ))}
  </span>
)

/** The account a route belongs to: its colour dot, its name, and the full name on hover. */
export const AccountBadge = ({ name, color, className }: { readonly name: string; readonly color: string; readonly className?: string }) => (
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
        <span className="dshx:min-w-0 dshx:truncate">{name}</span>
      </span>
    </TooltipTrigger>
    <TooltipContent side="top">{name}</TooltipContent>
  </Tooltip>
)

const quotaTone = (percent: number): string => (percent >= 50 ? 'dshx:text-success' : percent >= 20 ? 'dshx:text-warning' : 'dshx:text-destructive')

/** Remaining quota as a small arc gauge, the way the fallback rows show it. */
export const QuotaRing = ({ percent, className }: { readonly percent: number; readonly className?: string }) => {
  const clamped = Math.min(100, Math.max(0, percent))
  const circumference = 2 * Math.PI * 6.25
  return (
    <svg aria-hidden="true" className={cn('dshx:size-3.5 dshx:shrink-0', quotaTone(clamped), className)} viewBox="0 0 16 16">
      <circle cx="8" cy="8" fill="none" r="6.25" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.75" />
      <circle
        cx="8"
        cy="8"
        fill="none"
        r="6.25"
        stroke="currentColor"
        strokeDasharray={`${(circumference * clamped) / 100} ${circumference}`}
        strokeLinecap="round"
        strokeWidth="1.75"
        transform="rotate(-90 8 8)"
      />
    </svg>
  )
}

export const QuotaText = ({ percent, className }: { readonly percent: number; readonly className?: string }) => (
  <span className={cn('dshx:text-[10px] dshx:tabular-nums', quotaTone(percent), className)}>{Math.round(percent)}%</span>
)

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
