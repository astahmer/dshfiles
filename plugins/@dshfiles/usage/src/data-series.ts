/**
 * Chart series colours (DESIGN.md › Colour roles 8). Categorical series take `data-1..6` in order: the accent, then
 * the identity teal, orange, violet, pink and olive. The kit's `dshx:*-data-*` utilities inline these values and emit
 * no CSS variable, so a plot spec names the same sources. The kit's ChartFrame still maps the default `--ts-chart-*`
 * palette onto status hues, so every categorical scale here passes `range` explicitly.
 */
export const DATA_SERIES = [
  'var(--dsw-alias-state-business-primary)',
  'var(--dshx-identity-1)',
  'var(--dshx-identity-3)',
  'var(--dshx-identity-2)',
  'var(--dshx-identity-4)',
  'var(--dshx-identity-6)',
] as const

/** The one series that is a status: failed requests. */
export const FAILED_SERIES = 'var(--dsw-alias-state-error-primary)'
