import type { ReactNode } from 'react'
import { joinClassNames } from './field.js'
import styles from './chart.module.css'

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
  <figure className={joinClassNames(styles.frame, props.className)}>
    {(props.title !== undefined || props.description !== undefined) && (
      <figcaption className={styles.caption}>
        {props.title !== undefined && <span className={styles.title}>{props.title}</span>}
        {props.description !== undefined && <span className={styles.description}>{props.description}</span>}
      </figcaption>
    )}
    {props.children}
  </figure>
)
