import { cn } from '@dshfiles/plugin-ui/lib/utils'
import { BRAND_MARKS, brandOfModel, type BrandKey } from './brand-marks.js'

export { brandOfModel, type BrandKey }

/** The model family's mark: vendored brand artwork, or its initial when the family is unknown. */
export const BrandMark = ({ brand, name, className }: { readonly brand: BrandKey | undefined; readonly name: string; readonly className?: string }) => {
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
