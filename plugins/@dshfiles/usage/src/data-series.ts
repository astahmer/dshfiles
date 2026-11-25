/**
 * Chart series colours (DESIGN.md › Colour roles 8). Categorical series take the kit's data ramp `data-1..6` in order:
 * teal, violet, copper, magenta, olive, cyan, at a chart step clear of every status hue. The accent stays the colour of
 * interaction, never the first series (round five K5). The kit's ChartFrame maps `--ts-chart-*` onto the same ramp, and
 * every categorical scale here still passes `range` explicitly.
 */
export const DATA_SERIES = [
  'var(--dshx-data-1)',
  'var(--dshx-data-2)',
  'var(--dshx-data-3)',
  'var(--dshx-data-4)',
  'var(--dshx-data-5)',
  'var(--dshx-data-6)',
] as const

/** The one series that is a status: failed requests. */
export const FAILED_SERIES = 'var(--dsw-alias-state-error-primary)'
