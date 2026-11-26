/**
 * Hooks for the selection marker (council round 11 A1; DESIGN.md › Selection). A selected row whose first visual is a
 * glyph, tile or mark draws no `selected-marker` pill: the wash and the 550 title carry the selection. The kit
 * recognises its own leading glyphs on its own (`StatusGlyph`, `ProjectMark`, `PlaceGlyph`/`place-seat`, `ModelMark`,
 * `NativeProviderMark` as the row's first element, up to four wrappers deep). A plugin row reaches the rule with:
 *
 * - `LEADING_GLYPH_ATTRIBUTE` on its own leading glyph (a provider glyph, an icon seat), found anywhere in the row;
 * - `MARKER_OPT_OUT` on the row itself (the element that carries `selected-marker`) when its leading glyph is too deep
 *   or sits after an overlay element;
 * - `MARKER_KEEP` on the row itself to keep the pill whatever leads it: a selected Needs-you or Failed row shows its
 *   attention wash instead of the selection wash, so the pill is its only selection cue besides the 550 title.
 *
 * Spread them: `<span {...LEADING_GLYPH_ATTRIBUTE}>…</span>`, `<div {...MARKER_OPT_OUT} className="… dshx:selected-marker">`.
 */
export const LEADING_GLYPH_ATTRIBUTE = { 'data-leading-glyph': '' } as const

/** The row draws no selection pill; see `LEADING_GLYPH_ATTRIBUTE`. */
export const MARKER_OPT_OUT = { 'data-marker': 'none' } as const

/** The row keeps its selection pill even when it leads with a glyph (a selected Needs-you or Failed row). */
export const MARKER_KEEP = { 'data-marker': 'pill' } as const
