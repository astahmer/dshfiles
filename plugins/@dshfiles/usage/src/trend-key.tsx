/**
 * With one series the chart's legend under the bars says nothing the header cannot: the header names it instead, a
 * swatch in the series colour and its label after the caption (council round 10, D1).
 */
export const TrendKey = (props: { readonly label: string; readonly color: string }): JSX.Element => (
  <span className="dshx:inline-flex dshx:min-w-0 dshx:items-center dshx:gap-1.5" data-usage-trend-key>
    <span aria-hidden="true" className="dshx:size-2 dshx:shrink-0 dshx:rounded-full" style={{ backgroundColor: props.color }} />
    <span className="dshx:min-w-0 dshx:truncate">{props.label}</span>
  </span>
)
