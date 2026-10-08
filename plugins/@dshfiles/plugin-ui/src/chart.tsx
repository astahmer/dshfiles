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
 * follows the active theme without rebuilding its definition.
 */
export const ChartFrame = (props: ChartFrameProps): JSX.Element => (
  <figure
    className={cn(
      'dshx:m-0 dshx:flex dshx:min-w-0 dshx:flex-col dshx:gap-2 dshx:text-[11px] dshx:text-muted-foreground',
      'dshx:[--ts-chart-1:var(--dsw-alias-state-business-primary)] dshx:[--ts-chart-2:var(--dsw-alias-state-success-primary)] dshx:[--ts-chart-3:var(--dsw-alias-state-warn-primary)]',
      'dshx:[--ts-chart-4:var(--dsw-alias-state-error-primary)] dshx:[--ts-chart-5:var(--dsw-alias-brand-primary)] dshx:[--ts-chart-6:var(--dsw-alias-label-tertiary)]',
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
