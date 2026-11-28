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
 *
 * A row that draws no pill because it leads with a glyph adds `SELECTED_EDGE` beside its wash (council round 12 A1): a
 * neutral 1px inset edge, 3:1 on the wash, so the selection reads on every surface. Plain-text rows keep the pill alone.
 */
export const LEADING_GLYPH_ATTRIBUTE = { 'data-leading-glyph': '' } as const

/** The row draws no selection pill; see `LEADING_GLYPH_ATTRIBUTE`. */
export const MARKER_OPT_OUT = { 'data-marker': 'none' } as const

/** The row keeps its selection pill even when it leads with a glyph (a selected Needs-you or Failed row). */
export const MARKER_KEEP = { 'data-marker': 'pill' } as const

/**
 * The selected edge class (council round 12 A1): `cn('dshx:bg-selected-wash dshx:selected-marker', SELECTED_EDGE)` on a
 * selected glyph-leading row (the current thread row, an account row). Never on a plain-text row or a Needs-you or
 * Failed row, which keep the pill.
 */
export const SELECTED_EDGE = 'dshx:selected-edge'
