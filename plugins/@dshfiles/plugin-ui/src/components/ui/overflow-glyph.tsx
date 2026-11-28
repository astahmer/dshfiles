import { EllipsisIcon, type LucideProps } from 'lucide-react'
import * as React from 'react'
import { cn } from '../../lib/utils.js'

/**
 * The one overflow glyph (council round 15 A2; DESIGN.md › Components): a horizontal ⋯ at 16px with a 2px stroke in every
 * overflow trigger, whatever the trigger's size (an `icon-xs` button would draw an unsized icon at 12px). Decorative:
 * the trigger carries the name ("More actions"). Colour comes from the trigger; the size and stroke do not change.
 */
export const OverflowGlyph = React.forwardRef<SVGSVGElement, Omit<LucideProps, 'size' | 'strokeWidth' | 'absoluteStrokeWidth'>>(function OverflowGlyph(
  { className, ...props },
  ref,
) {
  return <EllipsisIcon ref={ref} aria-hidden="true" data-slot="overflow-glyph" {...props} size={16} strokeWidth={2} className={cn(className, 'dshx:size-4')} />
})
