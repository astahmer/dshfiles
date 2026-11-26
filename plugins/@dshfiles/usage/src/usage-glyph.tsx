/**
 * Usage's own glyph, a bar chart on a baseline: the left column's entry, the thread Cost facet and the page title mark
 * draw this one shape, so the page reads as the entry that opened it (council round 18, D2). Sized by `size`, or by the
 * container (the page title mark sets 18 px on its svg).
 */
export const UsageGlyph = (props: { readonly size?: number | undefined }): JSX.Element => (
  <svg
    aria-hidden
    data-usage-glyph=""
    width={props.size ?? 18}
    height={props.size ?? 18}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
  >
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
)
