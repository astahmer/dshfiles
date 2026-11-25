import type { ReactNode } from 'react'
import { cn } from './lib/utils.js'

export * from '@tanstack/charts'
export { Chart } from '@tanstack/charts/react'
export { scaleBand } from '@tanstack/charts/scales/band'
export { scaleLinear } from '@tanstack/charts/scales/linear'
export { scaleOrdinal } from '@tanstack/charts/scales/ordinal'
export { scalePoint } from '@tanstack/charts/scales/point'
export { tooltip } from '@tanstack/charts/tooltip'

export interface ChartFrameProps {
  readonly title?: ReactNode
  readonly description?: ReactNode
  readonly className?: string
  readonly children: ReactNode
}

/**
 * Figure around a TanStack chart. Charts paint with `currentColor` and the
 * `--ts-chart-*` palette, so this maps both onto DSH tokens and the chart
 * follows the active theme without rebuilding its definition. The palette is
 * the data ramp (`--dshx-data-1..6`, DESIGN.md › Colour roles 8): a status hue
 * appears only where a series is that status, named explicitly in its scale.
 * Axis ticks and legend labels read at full secondary ink, 12px and tabular
 * (`.dshx-chart-frame` in color-roles.css, round five A5).
 */
export const ChartFrame = (props: ChartFrameProps): JSX.Element => (
  <figure
    className={cn(
      'dshx-chart-frame dshx:m-0 dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2 dshx:text-2xs dshx:text-muted-foreground',
      'dshx:[--ts-chart-1:var(--dshx-data-1)] dshx:[--ts-chart-2:var(--dshx-data-2)] dshx:[--ts-chart-3:var(--dshx-data-3)]',
      'dshx:[--ts-chart-4:var(--dshx-data-4)] dshx:[--ts-chart-5:var(--dshx-data-5)] dshx:[--ts-chart-6:var(--dshx-data-6)]',
      props.className,
    )}
  >
    {(props.title !== undefined || props.description !== undefined) && (
      <figcaption className="dshx:flex dshx:flex-col dshx:gap-0.5">
        {props.title !== undefined && <span className="dshx:text-sm dshx:font-semibold dshx:text-foreground">{props.title}</span>}
        {props.description !== undefined && <span className="dshx:text-xs">{props.description}</span>}
      </figcaption>
    )}
    {props.children}
  </figure>
)
